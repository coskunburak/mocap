import type { CaptureVideo } from "../../domain/types";
import type {
  MultiViewReconstructionArtifact,
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

type CameraModel = {
  camera: ProcessedCamera;
  angleDeg: number;
  projection: ProjectionMatrix;
  intrinsicsSource: "metadata" | "fallback_fov";
  calibrationClipId: string | null;
  placementScore: number;
  placementFeedback: string[];
};

type Observation = {
  camera: CameraModel;
  frame: PoseFrameArtifactFrame;
  timeDeltaMs: number;
};

const MIN_CONFIDENCE = 0.25;
const MAX_REPROJECTION_PX = 82;
const DEFAULT_FOV_DEG = 62;
const ROLE_ANGLE: Record<string, number> = {
  front: 0,
  primary: 0,
  host: 0,
  right: 70,
  secondary: 70,
  guest: 70,
  back: 180,
  left: -70,
};
const EXPECTED_PRO_ANGLES = [0, 70, 180, -70];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalMetadataString(metadata: unknown, key: string) {
  const value = asRecord(metadata)?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function weightedBlend(landmarks: Array<PoseLandmark | undefined>): PoseLandmark {
  let total = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const landmark of landmarks) {
    const c = confidence(landmark);
    if (!landmark || c <= 0) continue;
    total += c;
    x += landmark.x * c;
    y += landmark.y * c;
    z += landmark.z * c;
  }
  if (total <= 0) {
    return { x: 0, y: 0, z: 0, visibility: 0, presence: 0 };
  }
  const c = clamp(total / landmarks.length, 0, 1);
  return { x: x / total, y: y / total, z: z / total, visibility: c, presence: c };
}

function fallbackWorld(observations: readonly Observation[], landmarkIndex: number) {
  return weightedBlend(
    observations.map((observation) => {
      const frame = observation.frame;
      return frame.worldLandmarks?.[landmarkIndex] ?? frame.landmarks[landmarkIndex];
    }),
  );
}

function fovIntrinsic(fovDeg: number) {
  const fovRad = (fovDeg * Math.PI) / 180;
  const f = 0.5 / Math.tan(fovRad / 2);
  return [f, 0, 0.5, 0, f, 0.5, 0, 0, 1];
}

function metadataIntrinsic(metadata: unknown, probe: VideoProbe): {
  k: number[];
  source: "metadata" | "fallback_fov";
} {
  const camera = asRecord(asRecord(metadata)?.camera);
  const intrinsics = asRecord(camera?.intrinsics);
  const fx = finite(intrinsics?.fx, NaN);
  const fy = finite(intrinsics?.fy, NaN);
  const cx = finite(intrinsics?.cx, NaN);
  const cy = finite(intrinsics?.cy, NaN);
  const width = finite(intrinsics?.width, probe.width || 1) || 1;
  const height = finite(intrinsics?.height, probe.height || 1) || 1;
  if ([fx, fy, cx, cy].every(Number.isFinite) && fx > 0 && fy > 0) {
    return {
      source: "metadata",
      k: [
        fx > 4 ? fx / width : fx,
        0,
        cx > 2 ? cx / width : cx,
        0,
        fy > 4 ? fy / height : fy,
        cy > 2 ? cy / height : cy,
        0,
        0,
        1,
      ],
    };
  }
  return { k: fovIntrinsic(DEFAULT_FOV_DEG), source: "fallback_fov" };
}

function yawRotation(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function buildProjectionMatrix(
  k: readonly number[],
  r: readonly number[],
  t: readonly number[],
): ProjectionMatrix {
  const rt = [
    r[0], r[1], r[2], t[0],
    r[3], r[4], r[5], t[1],
    r[6], r[7], r[8], t[2],
  ];
  const out = new Array<number>(12).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row * 4 + col] =
        k[row * 3] * rt[col] +
        k[row * 3 + 1] * rt[4 + col] +
        k[row * 3 + 2] * rt[8 + col];
    }
  }
  return out as ProjectionMatrix;
}

function projectionError(
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
  p: ProjectionMatrix,
) {
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
  a: PoseLandmark,
  b: PoseLandmark,
  p1: ProjectionMatrix,
  p2: ProjectionMatrix,
) {
  const matrix = [
    [a.x * p1[8] - p1[0], a.x * p1[9] - p1[1], a.x * p1[10] - p1[2], a.x * p1[11] - p1[3]],
    [a.y * p1[8] - p1[4], a.y * p1[9] - p1[5], a.y * p1[10] - p1[6], a.y * p1[11] - p1[7]],
    [b.x * p2[8] - p2[0], b.x * p2[9] - p2[1], b.x * p2[10] - p2[2], b.x * p2[11] - p2[3]],
    [b.y * p2[8] - p2[4], b.y * p2[9] - p2[5], b.y * p2[10] - p2[6], b.y * p2[11] - p2[7]],
  ];
  const normal = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  for (let row = 0; row < 4; row += 1) {
    for (let col = row; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += matrix[k][row] * matrix[k][col];
      normal[row][col] = sum;
      normal[col][row] = sum;
    }
  }
  const x = smallestEigenvector4x4(normal);
  const invW = Math.abs(x[3]) > 1e-10 ? 1 / x[3] : 0;
  const point: Vec3 = [x[0] * invW, x[1] * invW, x[2] * invW];
  const error =
    (projectionError(point[0], point[1], point[2], a.x, a.y, p1) +
      projectionError(point[0], point[1], point[2], b.x, b.y, p2)) /
    2;
  return { point, error };
}

function metadataAngle(camera: ProcessedCamera) {
  const metadata = asRecord(camera.video.captureMetadata);
  const raw = finite(metadata?.approxCameraAngle, NaN);
  if (Number.isFinite(raw)) return raw;
  return ROLE_ANGLE[camera.video.deviceRole] ?? EXPECTED_PRO_ANGLES[camera.video.deviceIndex] ?? 0;
}

function angleDistance(a: number, b: number) {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

function buildCameraModels(cameras: readonly ProcessedCamera[]) {
  return cameras.map((camera, index): CameraModel => {
    const angleDeg = metadataAngle(camera);
    const intrinsics = metadataIntrinsic(camera.video.captureMetadata, camera.probe);
    const calibrationClipId = optionalMetadataString(camera.video.captureMetadata, "calibrationClipId");
    const nearestExpected = EXPECTED_PRO_ANGLES.reduce((best, expected) =>
      angleDistance(angleDeg, expected) < angleDistance(angleDeg, best) ? expected : best,
    );
    const angleError = angleDistance(angleDeg, nearestExpected);
    const placementScore = clamp(1 - angleError / 55, 0.25, 1);
    const radians = (angleDeg * Math.PI) / 180;
    const radius = 1.3;
    const translation = [Math.sin(radians) * radius, 0, Math.cos(radians) * radius];
    const projection = buildProjectionMatrix(
      intrinsics.k,
      yawRotation(-angleDeg),
      translation,
    );
    const placementFeedback: string[] = [];
    if (placementScore < 0.72) {
      placementFeedback.push(
        `Camera ${camera.video.deviceIndex} angle is ${Math.round(angleError)}deg away from the nearest pro slot.`,
      );
    }
    if (intrinsics.source === "fallback_fov") {
      placementFeedback.push(`Camera ${camera.video.deviceIndex} intrinsics missing; fallback FOV was used.`);
    }
    if (!calibrationClipId) {
      placementFeedback.push(`Camera ${camera.video.deviceIndex} calibration clip id is missing.`);
    }
    if (index === 0 && Math.abs(angleDeg) > 25) {
      placementFeedback.push("Reference camera should be near the front angle.");
    }
    return {
      camera,
      angleDeg,
      projection,
      intrinsicsSource: intrinsics.source,
      calibrationClipId,
      placementScore,
      placementFeedback,
    };
  });
}

function findNearestFrame(
  frames: readonly PoseFrameArtifactFrame[],
  timestampMs: number,
  offsetMs: number,
  toleranceMs: number,
) {
  let best: PoseFrameArtifactFrame | null = null;
  let bestDelta = Infinity;
  for (const frame of frames) {
    const delta = Math.abs(frame.timestampMs - offsetMs - timestampMs);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
    if (frame.timestampMs - offsetMs > timestampMs + toleranceMs) break;
  }
  return best && bestDelta <= toleranceMs ? { frame: best, timeDeltaMs: bestDelta } : null;
}

function percentile(values: readonly number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * p);
  return sorted[clamp(index, 0, sorted.length - 1)];
}

function singleCameraBaselineScore(pose: PoseFramesArtifact) {
  const detectedRatio =
    pose.quality.frameCount > 0 ? pose.quality.detectedFrameCount / pose.quality.frameCount : 0;
  return Math.round(
    clamp(pose.quality.averagePoseConfidence * 58 + detectedRatio * 34 + 4, 0, 92),
  );
}

function bestTriangulatedLandmark(
  observations: readonly Observation[],
  landmarkIndex: number,
  maxDimension: number,
) {
  let best:
    | {
        landmark: PoseLandmark;
        errorPx: number;
      }
    | null = null;
  for (let i = 0; i < observations.length; i += 1) {
    for (let j = i + 1; j < observations.length; j += 1) {
      const a = observations[i].frame.landmarks[landmarkIndex];
      const b = observations[j].frame.landmarks[landmarkIndex];
      const ca = confidence(a);
      const cb = confidence(b);
      if (ca < MIN_CONFIDENCE || cb < MIN_CONFIDENCE) continue;
      const triangulated = triangulatePoint(
        a,
        b,
        observations[i].camera.projection,
        observations[j].camera.projection,
      );
      const errorPx = triangulated.error * maxDimension;
      if (
        !Number.isFinite(errorPx) ||
        errorPx > MAX_REPROJECTION_PX ||
        !triangulated.point.every(Number.isFinite)
      ) {
        continue;
      }
      if (!best || errorPx < best.errorPx) {
        const c = clamp((ca + cb) / 2, 0, 1);
        best = {
          errorPx,
          landmark: {
            x: triangulated.point[0],
            y: triangulated.point[1],
            z: triangulated.point[2],
            visibility: c,
            presence: c,
          },
        };
      }
    }
  }
  return best;
}

export async function reconstructMultiViewPose(input: {
  takeId: string;
  jobId: string;
  cameras: readonly ProcessedCamera[];
  outputDir: string;
}): Promise<{
  poseArtifact: PoseFramesArtifact;
  reconstruction: MultiViewReconstructionArtifact;
}> {
  const sorted = [...input.cameras].sort((a, b) => a.video.deviceIndex - b.video.deviceIndex);
  const reference = sorted[0];
  const otherCameras = sorted.slice(1);
  const syncOffsets = await Promise.all(
    otherCameras.map(async (camera) => {
      const estimate = await estimateDualCameraSync({
        primaryVideoPath: reference.inputPath,
        secondaryVideoPath: camera.inputPath,
        primaryMetadata: asRecord(reference.video.captureMetadata),
        secondaryMetadata: asRecord(camera.video.captureMetadata),
        outputDir: `${input.outputDir}/sync_${camera.video.deviceIndex}`,
      });
      return { deviceIndex: camera.video.deviceIndex, ...estimate };
    }),
  );
  const offsetByDevice = new Map(syncOffsets.map((sync) => [sync.deviceIndex, sync.offsetMs]));
  const fps = reference.pose.sourceVideo.fps || 30;
  const toleranceMs = Math.max(18, Math.round((1000 / fps) * 0.85));
  const cameraModels = buildCameraModels(sorted);
  const modelByDevice = new Map(cameraModels.map((model) => [model.camera.video.deviceIndex, model]));
  const referenceModel = modelByDevice.get(reference.video.deviceIndex) ?? cameraModels[0];
  const maxDimension = Math.max(...sorted.flatMap((camera) => [camera.probe.width, camera.probe.height]), 1);

  const outputFrames: PoseFrameArtifactFrame[] = [];
  const artifactFrames: MultiViewReconstructionArtifact["frames"] = [];
  const reprojectionErrors: number[] = [];
  let droppedFrameCount = 0;
  let triangulatedLandmarks = 0;
  let fallbackLandmarks = 0;
  let recoveredLandmarks = 0;
  let temporalHoldCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let viewCountSum = 0;
  let timeDeltaSum = 0;
  const previousWorld: PoseLandmark[] = [];

  reference.pose.frames.forEach((referenceFrame, outputFrameIndex) => {
    const observations: Observation[] = [
      {
        camera: referenceModel,
        frame: referenceFrame,
        timeDeltaMs: 0,
      },
    ];
    for (const camera of otherCameras) {
      const offsetMs = offsetByDevice.get(camera.video.deviceIndex) ?? 0;
      const matched = findNearestFrame(
        camera.pose.frames,
        referenceFrame.timestampMs,
        offsetMs,
        toleranceMs,
      );
      if (!matched) {
        droppedFrameCount += 1;
        continue;
      }
      const model = modelByDevice.get(camera.video.deviceIndex);
      if (!model) continue;
      observations.push({
        camera: model,
        frame: matched.frame,
        timeDeltaMs: matched.timeDeltaMs,
      });
      timeDeltaSum += matched.timeDeltaMs;
    }
    if (observations.length < 2) return;
    viewCountSum += observations.length;

    const landmarkCount = Math.min(...observations.map((observation) => observation.frame.landmarks.length));
    const landmarks = Array.from({ length: landmarkCount }, (_unused, index) =>
      weightedBlend(observations.map((observation) => observation.frame.landmarks[index])),
    );
    const worldLandmarks: PoseLandmark[] = [];
    const frameErrors: number[] = [];
    let frameTriangulated = 0;
    let frameRecovered = 0;

    for (let landmarkIndex = 0; landmarkIndex < landmarkCount; landmarkIndex += 1) {
      const validViews = observations.filter(
        (observation) => confidence(observation.frame.landmarks[landmarkIndex]) >= MIN_CONFIDENCE,
      );
      const best = bestTriangulatedLandmark(observations, landmarkIndex, maxDimension);
      if (best) {
        worldLandmarks.push(best.landmark);
        reprojectionErrors.push(best.errorPx);
        frameErrors.push(best.errorPx);
        triangulatedLandmarks += 1;
        frameTriangulated += 1;
      } else if (validViews.length > 0 && previousWorld[landmarkIndex]) {
        const fallback = fallbackWorld(validViews, landmarkIndex);
        const previous = previousWorld[landmarkIndex];
        worldLandmarks.push({
          x: previous.x * 0.68 + fallback.x * 0.32,
          y: previous.y * 0.68 + fallback.y * 0.32,
          z: previous.z * 0.68 + fallback.z * 0.32,
          visibility: Math.max(0.18, fallback.visibility * 0.72),
          presence: Math.max(0.18, fallback.presence ?? fallback.visibility * 0.72),
        });
        recoveredLandmarks += 1;
        temporalHoldCount += 1;
        frameRecovered += 1;
      } else {
        worldLandmarks.push(fallbackWorld(observations, landmarkIndex));
        fallbackLandmarks += 1;
      }
      confidenceSum += confidence(worldLandmarks[landmarkIndex]);
      confidenceCount += 1;
      previousWorld[landmarkIndex] = worldLandmarks[landmarkIndex];
    }

    const poseConfidence =
      worldLandmarks.length > 0
        ? worldLandmarks.reduce((acc, landmark) => acc + confidence(landmark), 0) /
          worldLandmarks.length
        : 0;
    const averageReprojectionErrorPx =
      frameErrors.length > 0
        ? frameErrors.reduce((acc, value) => acc + value, 0) / frameErrors.length
        : MAX_REPROJECTION_PX;
    const timestampMs = referenceFrame.timestampMs;
    outputFrames.push({
      frameIndex: outputFrames.length,
      timestampMs,
      landmarks,
      worldLandmarks,
      poseConfidence,
      detectorVersion: "multi_view_reconstruction_v1",
    });
    artifactFrames.push({
      frameIndex: outputFrames.length - 1,
      timestampMs,
      sourceFrames: observations.map((observation) => ({
        deviceIndex: observation.camera.camera.video.deviceIndex,
        frameIndex: observation.frame.frameIndex,
        timeDeltaMs: observation.timeDeltaMs,
      })),
      averageReprojectionErrorPx,
      triangulatedLandmarkCount: frameTriangulated,
      recoveredLandmarkCount: frameRecovered,
      viewCount: observations.length,
      landmarks: worldLandmarks,
    });
  });

  const totalLandmarks = triangulatedLandmarks + fallbackLandmarks + recoveredLandmarks;
  const triangulatedLandmarkRatio =
    totalLandmarks > 0 ? triangulatedLandmarks / totalLandmarks : 0;
  const recoveryRatio = totalLandmarks > 0 ? recoveredLandmarks / totalLandmarks : 0;
  const averageReprojectionErrorPx =
    reprojectionErrors.length > 0
      ? reprojectionErrors.reduce((acc, value) => acc + value, 0) / reprojectionErrors.length
      : MAX_REPROJECTION_PX;
  const matchedFrameCount = outputFrames.length;
  const placementQualityScore =
    cameraModels.reduce((acc, model) => acc + model.placementScore, 0) / cameraModels.length;
  const observedAngles = cameraModels.map((model) => model.angleDeg);
  const uniqueSlotCoverage =
    new Set(
      observedAngles.map((angle) =>
        EXPECTED_PRO_ANGLES.reduce((best, expected) =>
          angleDistance(angle, expected) < angleDistance(angle, best) ? expected : best,
        ),
      ),
    ).size / EXPECTED_PRO_ANGLES.length;
  const calibrationClipCoverage =
    cameraModels.filter((model) => Boolean(model.calibrationClipId)).length / cameraModels.length;
  const intrinsicsCoverage =
    cameraModels.filter((model) => model.intrinsicsSource === "metadata").length / cameraModels.length;
  const calibrationQualityScore = clamp(
    placementQualityScore * 0.54 + uniqueSlotCoverage * 0.18 + calibrationClipCoverage * 0.16 +
      intrinsicsCoverage * 0.12,
    0,
    1,
  );
  const averageViewCount = matchedFrameCount > 0 ? viewCountSum / matchedFrameCount : 0;
  const matchedViewCoverage = clamp(averageViewCount / Math.max(1, sorted.length), 0, 1);
  const averageTimeDeltaMs =
    matchedFrameCount > 0 && averageViewCount > 1
      ? timeDeltaSum / (matchedFrameCount * (averageViewCount - 1))
      : toleranceMs;
  const syncScore = clamp(1 - averageTimeDeltaMs / Math.max(toleranceMs, 1), 0, 1);
  const reprojectionScore = clamp(1 - averageReprojectionErrorPx / MAX_REPROJECTION_PX, 0, 1);
  const baselineScore = singleCameraBaselineScore(reference.pose);
  const multiViewQualityScore = Math.round(
    clamp(
      baselineScore +
        triangulatedLandmarkRatio * 10 +
        matchedViewCoverage * 8 +
        reprojectionScore * 7 +
        placementQualityScore * 5 +
        calibrationQualityScore * 4 +
        uniqueSlotCoverage * 4 +
        syncScore * 4 +
        recoveryRatio * 3 -
        (1 - matchedViewCoverage) * 8,
      0,
      99,
    ),
  );
  const warnings = [
    ...cameraModels.flatMap((model) => model.placementFeedback),
    ...syncOffsets.flatMap((sync) => sync.warnings),
  ];
  if (matchedViewCoverage < 0.7) {
    warnings.push("Average matched camera coverage is below pro threshold.");
  }
  if (placementQualityScore < 0.72) {
    warnings.push("Camera placement quality is low; use front/back/left/right spacing.");
  }
  if (averageReprojectionErrorPx > 42) {
    warnings.push("Multi-view reprojection error is high; calibration capture should be repeated.");
  }
  if (calibrationClipCoverage < 1) {
    warnings.push("Calibration clip coverage is incomplete for the pro 4-camera take.");
  }

  const reconstruction: MultiViewReconstructionArtifact = {
    schema: "mocap.multi_view_reconstruction.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: "multi_view",
    cameraCount: sorted.length,
    cameras: cameraModels.map((model) => ({
      deviceIndex: model.camera.video.deviceIndex,
      deviceRole: model.camera.video.deviceRole,
      deviceId: model.camera.video.deviceId,
      captureSessionId: model.camera.video.captureSessionId,
      approxAngleDeg: model.angleDeg,
      calibrationClipId: model.calibrationClipId,
      intrinsicsSource: model.intrinsicsSource,
      placementScore: model.placementScore,
      placementFeedback: model.placementFeedback,
      videoStorageKey: model.camera.video.videoStorageKey,
      metadataStorageKey: model.camera.video.metadataStorageKey,
      normalizedStorageKey: model.camera.normalizedStorageKey,
      fps: model.camera.probe.fps,
      width: model.camera.probe.width,
      height: model.camera.probe.height,
      durationMs: model.camera.probe.durationMs,
      poseFrameCount: model.camera.pose.frames.length,
    })),
    sync: {
      method: "multi_audio_waveform_v1",
      referenceDeviceIndex: reference.video.deviceIndex,
      toleranceMs,
      offsets: [
        {
          deviceIndex: reference.video.deviceIndex,
          method: "none",
          offsetMs: 0,
          confidence: 1,
          warnings: [],
        },
        ...syncOffsets.map((sync) => ({
          deviceIndex: sync.deviceIndex,
          method: sync.method,
          offsetMs: Math.round(sync.offsetMs),
          confidence: sync.confidence,
          warnings: sync.warnings,
        })),
      ],
      matchedFrameCount,
      droppedFrameCount,
      averageTimeDeltaMs,
    },
    calibration: {
      method:
        calibrationClipCoverage >= 1
          ? "metadata_intrinsics_calibration_clip_multiview_v1"
          : "metadata_intrinsics_multiview_v1",
      calibrationReady: calibrationClipCoverage >= 1 && uniqueSlotCoverage >= 1,
      calibrationQualityScore,
      calibrationClipIds: cameraModels
        .map((model) => model.calibrationClipId)
        .filter((value): value is string => Boolean(value)),
      placementQualityScore,
      coverageScore: uniqueSlotCoverage,
      expectedAnglesDeg: EXPECTED_PRO_ANGLES,
      observedAnglesDeg: observedAngles,
      warnings: cameraModels.flatMap((model) => model.placementFeedback),
    },
    occlusionRecovery: {
      strategy: "best_pair_triangulation_temporal_hold",
      recoveredLandmarkCount: recoveredLandmarks,
      temporalHoldCount,
      fallbackLandmarkCount: fallbackLandmarks,
      recoveryRatio,
    },
    quality: {
      singleCameraBaselineScore: baselineScore,
      multiViewQualityScore,
      qualityGain: multiViewQualityScore - baselineScore,
      averageReprojectionErrorPx,
      reprojectionP95Px: percentile(reprojectionErrors, 0.95),
      triangulatedLandmarkRatio,
      averageViewCount,
      matchedViewCoverage,
      placementQualityScore,
      occlusionRecoveryRatio: recoveryRatio,
      averageConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    },
    frames: artifactFrames,
    warnings,
  };

  const poseArtifact: PoseFramesArtifact = {
    schema: "mocap.pose_frames.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    sourceVideo: {
      storageKey: reference.video.videoStorageKey,
      normalizedStorageKey: reference.normalizedStorageKey,
      fps,
      width: reference.probe.width,
      height: reference.probe.height,
      durationMs: Math.min(...sorted.map((camera) => camera.probe.durationMs)),
    },
    detector: {
      name: "multi_view_reconstruction",
      version: "multi_view_reconstruction_v1",
    },
    frames: outputFrames,
    quality: {
      frameCount: reference.pose.quality.frameCount,
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
