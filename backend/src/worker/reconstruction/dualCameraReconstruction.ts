import type { CaptureVideo } from "../../domain/types";
import type {
  DualCameraReconstructionArtifact,
  PoseFrameArtifactFrame,
  PoseFramesArtifact,
  PoseLandmark,
} from "../types";
import type { VideoProbe } from "../video/videoPipeline";
import { estimateDualCameraSync } from "./audioSync";

type ProjectionMatrix = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

type Vec3 = [number, number, number];

type ProcessedCamera = {
  video: CaptureVideo;
  inputPath: string;
  normalizedStorageKey: string;
  probe: VideoProbe;
  pose: PoseFramesArtifact;
};

type MatchedPair = {
  primary: PoseFrameArtifactFrame;
  secondary: PoseFrameArtifactFrame;
  timeDeltaMs: number;
  timestampMs: number;
};

const DEFAULT_FOV_DEG = 62;
const DEFAULT_BASELINE = 1;
const DEFAULT_CONVERGENCE_DEG = 35;
const MIN_CONFIDENCE = 0.28;
const MAX_REPROJECTION_PX = 90;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function confidence(landmark: PoseLandmark | undefined) {
  if (!landmark) return 0;
  const visibility = finite(landmark.visibility, 0);
  const presence = finite(landmark.presence, visibility);
  return clamp((visibility + presence) / 2, 0, 1);
}

function blendLandmark(a: PoseLandmark | undefined, b: PoseLandmark | undefined): PoseLandmark {
  const ca = confidence(a);
  const cb = confidence(b);
  const total = ca + cb || 1;
  return {
    x: ((a?.x ?? b?.x ?? 0) * ca + (b?.x ?? a?.x ?? 0) * cb) / total,
    y: ((a?.y ?? b?.y ?? 0) * ca + (b?.y ?? a?.y ?? 0) * cb) / total,
    z: ((a?.z ?? b?.z ?? 0) * ca + (b?.z ?? a?.z ?? 0) * cb) / total,
    visibility: clamp((ca + cb) / 2, 0, 1),
    presence: clamp((ca + cb) / 2, 0, 1),
  };
}

function fallbackWorldLandmark(
  primary: PoseFrameArtifactFrame,
  secondary: PoseFrameArtifactFrame,
  index: number,
): PoseLandmark {
  const a = primary.worldLandmarks?.[index] ?? primary.landmarks[index];
  const b = secondary.worldLandmarks?.[index] ?? secondary.landmarks[index];
  return blendLandmark(a, b);
}

function fovIntrinsic(fovDeg: number) {
  const fovRad = (fovDeg * Math.PI) / 180;
  const f = 0.5 / Math.tan(fovRad / 2);
  return [f, 0, 0.5, 0, f, 0.5, 0, 0, 1];
}

function metadataIntrinsic(metadata: unknown, probe: VideoProbe) {
  const camera = asRecord(asRecord(metadata)?.camera);
  const intrinsics = asRecord(camera?.intrinsics);
  const fx = finite(intrinsics?.fx, NaN);
  const fy = finite(intrinsics?.fy, NaN);
  const cx = finite(intrinsics?.cx, NaN);
  const cy = finite(intrinsics?.cy, NaN);
  const width = finite(intrinsics?.width, probe.width || 1) || 1;
  const height = finite(intrinsics?.height, probe.height || 1) || 1;
  if ([fx, fy, cx, cy].every(Number.isFinite) && fx > 0 && fy > 0) {
    return [
      fx > 4 ? fx / width : fx,
      0,
      cx > 2 ? cx / width : cx,
      0,
      fy > 4 ? fy / height : fy,
      cy > 2 ? cy / height : cy,
      0,
      0,
      1,
    ];
  }
  return fovIntrinsic(DEFAULT_FOV_DEG);
}

function yawRotation(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function buildProjectionMatrix(
  K: readonly number[],
  R: readonly number[],
  t: readonly number[],
): ProjectionMatrix {
  const rt = [
    R[0], R[1], R[2], t[0],
    R[3], R[4], R[5], t[1],
    R[6], R[7], R[8], t[2],
  ];
  const out = new Array<number>(12).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row * 4 + col] =
        K[row * 3] * rt[col] +
        K[row * 3 + 1] * rt[4 + col] +
        K[row * 3 + 2] * rt[8 + col];
    }
  }
  return out as ProjectionMatrix;
}

function projectionError(x: number, y: number, z: number, u: number, v: number, p: ProjectionMatrix) {
  const w = p[8] * x + p[9] * y + p[10] * z + p[11];
  if (Math.abs(w) < 1e-10) return Infinity;
  const projectedU = (p[0] * x + p[1] * y + p[2] * z + p[3]) / w;
  const projectedV = (p[4] * x + p[5] * y + p[6] * z + p[7]) / w;
  return Math.hypot(projectedU - u, projectedV - v);
}

function smallestEigenvector4x4(matrix: number[][]): [number, number, number, number] {
  const size = 4;
  const a = matrix.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_unused, col) => (row === col ? 1 : 0)),
  );

  for (let iter = 0; iter < 80; iter += 1) {
    let max = 0;
    let p = 0;
    let q = 1;
    for (let row = 0; row < size; row += 1) {
      for (let col = row + 1; col < size; col += 1) {
        const value = Math.abs(a[row][col]);
        if (value > max) {
          max = value;
          p = row;
          q = col;
        }
      }
    }
    if (max < 1e-12) break;

    const theta =
      Math.abs(a[p][p] - a[q][q]) < 1e-12
        ? Math.PI / 4
        : 0.5 * Math.atan2(2 * a[p][q], a[p][p] - a[q][q]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (let row = 0; row < size; row += 1) {
      const aip = a[row][p];
      const aiq = a[row][q];
      a[row][p] = c * aip + s * aiq;
      a[row][q] = -s * aip + c * aiq;
    }
    for (let col = 0; col < size; col += 1) {
      const apj = a[p][col];
      const aqj = a[q][col];
      a[p][col] = c * apj + s * aqj;
      a[q][col] = -s * apj + c * aqj;
    }
    for (let row = 0; row < size; row += 1) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = c * vip + s * viq;
      vectors[row][q] = -s * vip + c * viq;
    }
  }

  let minIndex = 0;
  for (let index = 1; index < size; index += 1) {
    if (a[index][index] < a[minIndex][minIndex]) minIndex = index;
  }
  return [
    vectors[0][minIndex],
    vectors[1][minIndex],
    vectors[2][minIndex],
    vectors[3][minIndex],
  ];
}

function triangulatePoint(
  xA: number,
  yA: number,
  xB: number,
  yB: number,
  p1: ProjectionMatrix,
  p2: ProjectionMatrix,
) {
  const a = [
    [xA * p1[8] - p1[0], xA * p1[9] - p1[1], xA * p1[10] - p1[2], xA * p1[11] - p1[3]],
    [yA * p1[8] - p1[4], yA * p1[9] - p1[5], yA * p1[10] - p1[6], yA * p1[11] - p1[7]],
    [xB * p2[8] - p2[0], xB * p2[9] - p2[1], xB * p2[10] - p2[2], xB * p2[11] - p2[3]],
    [yB * p2[8] - p2[4], yB * p2[9] - p2[5], yB * p2[10] - p2[6], yB * p2[11] - p2[7]],
  ];
  const normal = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  for (let row = 0; row < 4; row += 1) {
    for (let col = row; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k][row] * a[k][col];
      normal[row][col] = sum;
      normal[col][row] = sum;
    }
  }
  const x = smallestEigenvector4x4(normal);
  const invW = Math.abs(x[3]) > 1e-10 ? 1 / x[3] : 0;
  const point: Vec3 = [x[0] * invW, x[1] * invW, x[2] * invW];
  const error =
    (projectionError(point[0], point[1], point[2], xA, yA, p1) +
      projectionError(point[0], point[1], point[2], xB, yB, p2)) /
    2;
  return { point, error };
}

function cameraAngle(metadata: unknown, fallback: number) {
  const raw = finite(asRecord(metadata)?.approxCameraAngle, NaN);
  return Number.isFinite(raw) ? raw : fallback;
}

function buildCalibration(primary: ProcessedCamera, secondary: ProcessedCamera) {
  const primaryMetadata = primary.video.captureMetadata;
  const secondaryMetadata = secondary.video.captureMetadata;
  const angleA = cameraAngle(primaryMetadata, 0);
  const angleB = cameraAngle(secondaryMetadata, DEFAULT_CONVERGENCE_DEG);
  const convergenceAngleDeg = clamp(Math.abs(angleB - angleA) || DEFAULT_CONVERGENCE_DEG, 8, 85);
  const baseline = DEFAULT_BASELINE;
  const intrinsicA = metadataIntrinsic(primaryMetadata, primary.probe);
  const intrinsicB = metadataIntrinsic(secondaryMetadata, secondary.probe);
  const projectionA = buildProjectionMatrix(intrinsicA, yawRotation(0), [0, 0, 0]);
  const projectionB = buildProjectionMatrix(
    intrinsicB,
    yawRotation(-convergenceAngleDeg),
    [baseline, 0, 0],
  );
  const warnings: string[] = [];
  if (!asRecord(asRecord(primaryMetadata)?.camera)?.intrinsics) {
    warnings.push("Primary camera intrinsics missing; default FOV model was used.");
  }
  if (!asRecord(asRecord(secondaryMetadata)?.camera)?.intrinsics) {
    warnings.push("Secondary camera intrinsics missing; default FOV model was used.");
  }
  const angleQuality = clamp(1 - Math.abs(convergenceAngleDeg - 38) / 55, 0.2, 1);
  const qualityScore = Math.round(angleQuality * 100) / 100;
  return {
    method: "metadata_intrinsics_stereo_v1" as const,
    baseline,
    convergenceAngleDeg,
    projectionA,
    projectionB,
    qualityScore,
    warnings,
  };
}

function matchFrames(
  primary: readonly PoseFrameArtifactFrame[],
  secondary: readonly PoseFrameArtifactFrame[],
  offsetMs: number,
  toleranceMs: number,
) {
  const pairs: MatchedPair[] = [];
  let dropped = 0;
  let j = 0;
  for (const frameA of primary) {
    while (
      j < secondary.length &&
      secondary[j].timestampMs - offsetMs < frameA.timestampMs - toleranceMs
    ) {
      dropped += 1;
      j += 1;
    }
    const candidates = [secondary[j], secondary[j + 1]].filter(Boolean);
    let best: PoseFrameArtifactFrame | null = null;
    let bestDelta = Infinity;
    for (const frameB of candidates) {
      const adjusted = frameB.timestampMs - offsetMs;
      const delta = Math.abs(adjusted - frameA.timestampMs);
      if (delta < bestDelta) {
        best = frameB;
        bestDelta = delta;
      }
    }
    if (!best || bestDelta > toleranceMs) continue;
    pairs.push({
      primary: frameA,
      secondary: best,
      timeDeltaMs: bestDelta,
      timestampMs: Math.round((frameA.timestampMs + (best.timestampMs - offsetMs)) / 2),
    });
    while (j < secondary.length && secondary[j].frameIndex <= best.frameIndex) j += 1;
  }
  dropped += Math.max(0, secondary.length - j);
  return { pairs, dropped };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.ceil((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[index];
}

function singleCameraBaselineScore(pose: PoseFramesArtifact) {
  const detectedRatio =
    pose.quality.frameCount > 0 ? pose.quality.detectedFrameCount / pose.quality.frameCount : 0;
  return Math.round(
    clamp(pose.quality.averagePoseConfidence * 58 + detectedRatio * 34 + 4, 0, 92),
  );
}

export async function reconstructDualCameraPose(input: {
  takeId: string;
  jobId: string;
  primary: ProcessedCamera;
  secondary: ProcessedCamera;
  outputDir: string;
}): Promise<{
  poseArtifact: PoseFramesArtifact;
  reconstruction: DualCameraReconstructionArtifact;
}> {
  const syncEstimate = await estimateDualCameraSync({
    primaryVideoPath: input.primary.inputPath,
    secondaryVideoPath: input.secondary.inputPath,
    primaryMetadata: asRecord(input.primary.video.captureMetadata),
    secondaryMetadata: asRecord(input.secondary.video.captureMetadata),
    outputDir: input.outputDir,
  });
  const fps = input.primary.pose.sourceVideo.fps || input.secondary.pose.sourceVideo.fps || 30;
  const toleranceMs = Math.max(18, Math.round((1000 / fps) * 0.75));
  const matched = matchFrames(
    input.primary.pose.frames,
    input.secondary.pose.frames,
    syncEstimate.offsetMs,
    toleranceMs,
  );
  const calibration = buildCalibration(input.primary, input.secondary);
  const maxDimension = Math.max(
    input.primary.probe.width,
    input.primary.probe.height,
    input.secondary.probe.width,
    input.secondary.probe.height,
    1,
  );

  const outputFrames: PoseFrameArtifactFrame[] = [];
  const reconstructionFrames: DualCameraReconstructionArtifact["frames"] = [];
  const reprojectionErrors: number[] = [];
  let triangulatedLandmarks = 0;
  let fallbackLandmarks = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  matched.pairs.forEach((pair, frameIndex) => {
    const landmarkCount = Math.min(
      pair.primary.landmarks.length,
      pair.secondary.landmarks.length,
    );
    const blendedLandmarks: PoseLandmark[] = [];
    const worldLandmarks: PoseLandmark[] = [];
    const frameErrors: number[] = [];
    let frameTriangulated = 0;

    for (let index = 0; index < landmarkCount; index += 1) {
      const a = pair.primary.landmarks[index];
      const b = pair.secondary.landmarks[index];
      const confA = confidence(a);
      const confB = confidence(b);
      const avgConfidence = (confA + confB) / 2;
      confidenceSum += avgConfidence;
      confidenceCount += 1;
      blendedLandmarks.push(blendLandmark(a, b));

      if (confA >= MIN_CONFIDENCE && confB >= MIN_CONFIDENCE) {
        const triangulated = triangulatePoint(
          a.x,
          a.y,
          b.x,
          b.y,
          calibration.projectionA,
          calibration.projectionB,
        );
        const errorPx = triangulated.error * maxDimension;
        if (
          Number.isFinite(errorPx) &&
          errorPx <= MAX_REPROJECTION_PX &&
          triangulated.point.every(Number.isFinite)
        ) {
          worldLandmarks.push({
            x: triangulated.point[0],
            y: triangulated.point[1],
            z: triangulated.point[2],
            visibility: avgConfidence,
            presence: avgConfidence,
          });
          frameErrors.push(errorPx);
          reprojectionErrors.push(errorPx);
          triangulatedLandmarks += 1;
          frameTriangulated += 1;
          continue;
        }
      }

      worldLandmarks.push(fallbackWorldLandmark(pair.primary, pair.secondary, index));
      fallbackLandmarks += 1;
    }

    const poseConfidence =
      landmarkCount > 0
        ? blendedLandmarks.reduce((acc, landmark) => acc + confidence(landmark), 0) /
          landmarkCount
        : 0;
    const averageReprojectionErrorPx =
      frameErrors.length > 0
        ? frameErrors.reduce((acc, value) => acc + value, 0) / frameErrors.length
        : MAX_REPROJECTION_PX;

    outputFrames.push({
      frameIndex,
      timestampMs: pair.timestampMs,
      landmarks: blendedLandmarks,
      worldLandmarks,
      poseConfidence,
      detectorVersion: "dual_camera_reconstruction_v1",
    });
    reconstructionFrames.push({
      frameIndex,
      timestampMs: pair.timestampMs,
      sourceFrameA: pair.primary.frameIndex,
      sourceFrameB: pair.secondary.frameIndex,
      timeDeltaMs: pair.timeDeltaMs,
      averageReprojectionErrorPx,
      triangulatedLandmarkCount: frameTriangulated,
      landmarks: worldLandmarks,
    });
  });

  const totalLandmarks = triangulatedLandmarks + fallbackLandmarks;
  const triangulatedLandmarkRatio =
    totalLandmarks > 0 ? triangulatedLandmarks / totalLandmarks : 0;
  const fallbackLandmarkRatio = totalLandmarks > 0 ? fallbackLandmarks / totalLandmarks : 1;
  const averageReprojectionErrorPx =
    reprojectionErrors.length > 0
      ? reprojectionErrors.reduce((acc, value) => acc + value, 0) / reprojectionErrors.length
      : MAX_REPROJECTION_PX;
  const averageTimeDeltaMs =
    matched.pairs.length > 0
      ? matched.pairs.reduce((acc, pair) => acc + pair.timeDeltaMs, 0) / matched.pairs.length
      : toleranceMs;
  const baselineScore = singleCameraBaselineScore(input.primary.pose);
  const reprojectionScore = clamp(1 - averageReprojectionErrorPx / MAX_REPROJECTION_PX, 0, 1);
  const syncScore = clamp(1 - averageTimeDeltaMs / Math.max(toleranceMs, 1), 0, 1);
  const dualQualityScore = Math.round(
    clamp(
      baselineScore +
        triangulatedLandmarkRatio * 9 +
        reprojectionScore * 7 +
        syncScore * 4 +
        calibration.qualityScore * 3 -
        fallbackLandmarkRatio * 8,
      0,
      99,
    ),
  );
  const warnings = [
    ...syncEstimate.warnings,
    ...calibration.warnings,
  ];
  if (matched.pairs.length < Math.max(2, input.primary.pose.frames.length * 0.4)) {
    warnings.push("Less than 40% of primary frames matched a secondary camera frame.");
  }
  if (averageReprojectionErrorPx > 45) {
    warnings.push("Dual-camera reprojection error is high; calibration should be reviewed.");
  }
  if (triangulatedLandmarkRatio < 0.55) {
    warnings.push("Many landmarks fell back to per-camera world estimates.");
  }

  const reconstruction: DualCameraReconstructionArtifact = {
    schema: "mocap.dual_reconstruction.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: "dual_camera",
    cameras: [input.primary, input.secondary].map((camera) => ({
      deviceIndex: camera.video.deviceIndex,
      deviceRole: camera.video.deviceRole,
      deviceId: camera.video.deviceId,
      captureSessionId: camera.video.captureSessionId,
      videoStorageKey: camera.video.videoStorageKey,
      metadataStorageKey: camera.video.metadataStorageKey,
      normalizedStorageKey: camera.normalizedStorageKey,
      fps: camera.probe.fps,
      width: camera.probe.width,
      height: camera.probe.height,
      durationMs: camera.probe.durationMs,
      poseFrameCount: camera.pose.frames.length,
    })),
    sync: {
      method: syncEstimate.method,
      offsetMs: Math.round(syncEstimate.offsetMs),
      confidence: syncEstimate.confidence,
      toleranceMs,
      matchedFrameCount: matched.pairs.length,
      droppedFrameCount: matched.dropped,
      averageTimeDeltaMs,
      warnings: syncEstimate.warnings,
    },
    calibration: {
      ...calibration,
      projectionA: Array.from(calibration.projectionA),
      projectionB: Array.from(calibration.projectionB),
    },
    quality: {
      singleCameraBaselineScore: baselineScore,
      dualQualityScore,
      qualityGain: dualQualityScore - baselineScore,
      averageReprojectionErrorPx,
      reprojectionP95Px: percentile(reprojectionErrors, 0.95),
      triangulatedLandmarkRatio,
      fallbackLandmarkRatio,
      triangulatedFrameCount: outputFrames.length,
      averageConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    },
    frames: reconstructionFrames,
    warnings,
  };

  const poseArtifact: PoseFramesArtifact = {
    schema: "mocap.pose_frames.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    sourceVideo: {
      storageKey: input.primary.video.videoStorageKey,
      normalizedStorageKey: input.primary.normalizedStorageKey,
      fps,
      width: input.primary.probe.width,
      height: input.primary.probe.height,
      durationMs: Math.min(input.primary.probe.durationMs, input.secondary.probe.durationMs),
    },
    detector: {
      name: "dual_camera_reconstruction",
      version: "dual_camera_reconstruction_v1",
    },
    frames: outputFrames,
    quality: {
      frameCount: input.primary.pose.quality.frameCount,
      detectedFrameCount: outputFrames.length,
      lowConfidenceFrameCount: outputFrames.filter((frame) => frame.poseConfidence < 0.45).length,
      averagePoseConfidence:
        outputFrames.length > 0
          ? outputFrames.reduce((acc, frame) => acc + frame.poseConfidence, 0) /
            outputFrames.length
          : 0,
    },
  };

  return { poseArtifact, reconstruction };
}
