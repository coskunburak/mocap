import { lmAt } from "../../models/Landmark";
import { MP33, mp33ToJointPose } from "../../models/BodyPose33";
import type { PoseFrame } from "../../models/PoseFrame";
import type { TakePostProcess } from "../../models/Take";
import { clamp } from "../../models/Skeleton";
import { PoseSmoother } from "../filter/PoseSmoother";

type BufferKey =
  | "landmarks"
  | "worldLandmarks"
  | "faceLandmarks"
  | "leftHandLandmarks"
  | "leftHandWorldLandmarks"
  | "rightHandLandmarks"
  | "rightHandWorldLandmarks";

type MutableFrame = {
  ts: number;
  landmarks: Float32Array;
  worldLandmarks?: Float32Array;
  faceLandmarks?: Float32Array;
  leftHandLandmarks?: Float32Array;
  leftHandWorldLandmarks?: Float32Array;
  rightHandLandmarks?: Float32Array;
  rightHandWorldLandmarks?: Float32Array;
  faceBlendshapes?: PoseFrame["faceBlendshapes"];
  hasPoseSegmentationMask?: boolean;
  trackingProfile?: PoseFrame["trackingProfile"];
  requestedTrackingProfile?: PoseFrame["requestedTrackingProfile"];
  fps?: number;
  frameId?: number;
};

type CleanupResult = {
  frames: PoseFrame[];
  report: TakePostProcess;
};

type CleanupOptions = {
  confidenceGate?: number;
  gapFillMaxSpan?: number;
};

const BODY_BUFFER_KEYS: readonly BufferKey[] = [
  "landmarks",
  "worldLandmarks",
  "faceLandmarks",
  "leftHandLandmarks",
  "leftHandWorldLandmarks",
  "rightHandLandmarks",
  "rightHandWorldLandmarks",
];

const STRIDE = 4;

function cloneFrame(frame: PoseFrame): MutableFrame {
  return {
    ...frame,
    landmarks: new Float32Array(frame.landmarks),
    worldLandmarks: frame.worldLandmarks ? new Float32Array(frame.worldLandmarks) : undefined,
    faceLandmarks: frame.faceLandmarks ? new Float32Array(frame.faceLandmarks) : undefined,
    leftHandLandmarks: frame.leftHandLandmarks
      ? new Float32Array(frame.leftHandLandmarks)
      : undefined,
    leftHandWorldLandmarks: frame.leftHandWorldLandmarks
      ? new Float32Array(frame.leftHandWorldLandmarks)
      : undefined,
    rightHandLandmarks: frame.rightHandLandmarks
      ? new Float32Array(frame.rightHandLandmarks)
      : undefined,
    rightHandWorldLandmarks: frame.rightHandWorldLandmarks
      ? new Float32Array(frame.rightHandWorldLandmarks)
      : undefined,
  };
}

function ensureBuffer(frame: MutableFrame, key: BufferKey, template: Float32Array) {
  const current = frame[key];
  if (current) return current;
  const next = new Float32Array(template.length);
  (frame as Record<BufferKey, Float32Array | undefined>)[key] = next;
  return next;
}

function pointDistance(bufA: Float32Array, bufB: Float32Array, index: number) {
  const offset = index * STRIDE;
  const dx = bufA[offset] - bufB[offset];
  const dy = bufA[offset + 1] - bufB[offset + 1];
  const dz = bufA[offset + 2] - bufB[offset + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isFinitePoint(buf: Float32Array, index: number) {
  const offset = index * STRIDE;
  return (
    Number.isFinite(buf[offset]) &&
    Number.isFinite(buf[offset + 1]) &&
    Number.isFinite(buf[offset + 2])
  );
}

function isValidPoint(buf: Float32Array | undefined, index: number, confidenceGate: number) {
  if (!buf || !isFinitePoint(buf, index)) return false;
  return buf[index * STRIDE + 3] >= confidenceGate;
}

function coreConfidence(frame: PoseFrame) {
  return (
    [
      MP33.LEFT_SHOULDER,
      MP33.RIGHT_SHOULDER,
      MP33.LEFT_HIP,
      MP33.RIGHT_HIP,
      MP33.LEFT_KNEE,
      MP33.RIGHT_KNEE,
      MP33.LEFT_ANKLE,
      MP33.RIGHT_ANKLE,
    ].reduce((sum, index) => sum + lmAt(frame.landmarks, index).c, 0) / 8
  );
}

function trimFrames(frames: readonly PoseFrame[], confidenceGate: number) {
  let start = 0;
  let end = frames.length - 1;

  while (start < frames.length && coreConfidence(frames[start]) < confidenceGate) {
    start += 1;
  }
  while (end > start && coreConfidence(frames[end]) < confidenceGate) {
    end -= 1;
  }

  return { start, end };
}

function estimateTorsoScale(frame: MutableFrame) {
  const leftShoulder = lmAt(frame.landmarks, MP33.LEFT_SHOULDER);
  const rightShoulder = lmAt(frame.landmarks, MP33.RIGHT_SHOULDER);
  const dx = leftShoulder.x - rightShoulder.x;
  const dy = leftShoulder.y - rightShoulder.y;
  const dz = leftShoulder.z - rightShoulder.z;
  return Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
}

function fillShortGaps(frames: MutableFrame[], key: BufferKey, confidenceGate: number, maxSpan: number) {
  const template = frames.find((frame) => frame[key])?.[key] as Float32Array | undefined;
  if (!template) return 0;

  const landmarkTotal = template.length / STRIDE;
  let fixes = 0;

  for (let landmarkIndex = 0; landmarkIndex < landmarkTotal; landmarkIndex += 1) {
    let index = 0;
    while (index < frames.length) {
      const current = frames[index][key];
      if (isValidPoint(current as Float32Array | undefined, landmarkIndex, confidenceGate)) {
        index += 1;
        continue;
      }

      const start = index - 1;
      let end = index;
      while (
        end < frames.length &&
        !isValidPoint(frames[end][key] as Float32Array | undefined, landmarkIndex, confidenceGate)
      ) {
        end += 1;
      }

      const gapLength = end - index;
      const prev = start >= 0 ? (frames[start][key] as Float32Array | undefined) : undefined;
      const next = end < frames.length ? (frames[end][key] as Float32Array | undefined) : undefined;

      if (
        gapLength > 0 &&
        gapLength <= maxSpan &&
        isValidPoint(prev, landmarkIndex, confidenceGate) &&
        isValidPoint(next, landmarkIndex, confidenceGate)
      ) {
        const offset = landmarkIndex * STRIDE;
        for (let step = 1; step <= gapLength; step += 1) {
          const t = step / (gapLength + 1);
          const target = ensureBuffer(frames[start + step], key, prev!);
          target[offset] = prev![offset] + (next![offset] - prev![offset]) * t;
          target[offset + 1] = prev![offset + 1] + (next![offset + 1] - prev![offset + 1]) * t;
          target[offset + 2] = prev![offset + 2] + (next![offset + 2] - prev![offset + 2]) * t;
          target[offset + 3] = Math.min(prev![offset + 3], next![offset + 3]) * 0.92;
          fixes += 1;
        }
      }

      index = Math.max(end, index + 1);
    }
  }

  return fixes;
}

function rejectOutliers(frames: MutableFrame[], key: BufferKey, confidenceGate: number) {
  const template = frames.find((frame) => frame[key])?.[key] as Float32Array | undefined;
  if (!template) return 0;

  const landmarkTotal = template.length / STRIDE;
  let fixes = 0;

  for (let frameIndex = 1; frameIndex < frames.length - 1; frameIndex += 1) {
    const previous = frames[frameIndex - 1][key] as Float32Array | undefined;
    const current = frames[frameIndex][key] as Float32Array | undefined;
    const next = frames[frameIndex + 1][key] as Float32Array | undefined;
    if (!previous || !current || !next) continue;

    const scale = estimateTorsoScale(frames[frameIndex]);
    const threshold = key.includes("World") || key === "worldLandmarks" ? scale * 0.9 : scale * 0.3;

    for (let landmarkIndex = 0; landmarkIndex < landmarkTotal; landmarkIndex += 1) {
      if (
        !isValidPoint(previous, landmarkIndex, confidenceGate) ||
        !isValidPoint(current, landmarkIndex, confidenceGate) ||
        !isValidPoint(next, landmarkIndex, confidenceGate)
      ) {
        continue;
      }

      const currentJump = Math.max(
        pointDistance(current, previous, landmarkIndex),
        pointDistance(current, next, landmarkIndex),
      );
      const bridge = pointDistance(previous, next, landmarkIndex);
      if (currentJump > threshold && bridge < currentJump * 0.45) {
        const offset = landmarkIndex * STRIDE;
        current[offset] = (previous[offset] + next[offset]) * 0.5;
        current[offset + 1] = (previous[offset + 1] + next[offset + 1]) * 0.5;
        current[offset + 2] = (previous[offset + 2] + next[offset + 2]) * 0.5;
        current[offset + 3] = Math.min(current[offset + 3], (previous[offset + 3] + next[offset + 3]) * 0.5);
        fixes += 1;
      }
    }
  }

  return fixes;
}

function applyEuroFilter(frames: MutableFrame[], key: BufferKey, confidenceGate: number) {
  const template = frames.find((frame) => frame[key])?.[key] as Float32Array | undefined;
  if (!template) return 0;

  const landmarkTotal = template.length / STRIDE;
  const smoother = new PoseSmoother(landmarkTotal, {
    minCutoff: 0.1,    // More aggressive cutoff for jitter removal post-process
    beta: 0.05,        // Less responsiveness to high speed (more smoothed)
    dCutoff: 1.0,
    confidenceGate,
  });

  let fixes = 0;
  
  // Calculate average dt for smoother frequency
  const dt = frames.length > 1 ? Math.max(0.001, (frames[frames.length - 1].ts - frames[0].ts) / frames.length) : 33.3;

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const current = frames[frameIndex][key] as Float32Array | undefined;
    if (!current) continue;

    // We pass the entire buffer into the smoother
    const smoothedBuffer = smoother.filter(current, frames[frameIndex].ts);

    for (let i = 0; i < current.length; i++) {
      // Just track if values actually changed
      if (Math.abs(current[i] - smoothedBuffer[i]) > 0.0001) fixes++;
      current[i] = smoothedBuffer[i];
    }
  }

  // SmoothTrajectories is a simple moving average, EuroFilter replaces/enhances it.
  return fixes;
}

function detectContactRuns(frames: MutableFrame[], footIndexes: readonly number[], confidenceGate: number) {
  const runs: Array<{ start: number; end: number }> = [];
  let activeStart = -1;
  let previousCenter: { x: number; y: number; z: number } | null = null;

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const buffer = frames[frameIndex].worldLandmarks ?? frames[frameIndex].landmarks;
    const validPoints = footIndexes.filter((index) => isValidPoint(buffer, index, confidenceGate));
    if (validPoints.length === 0) {
      if (activeStart >= 0 && frameIndex - activeStart >= 3) {
        runs.push({ start: activeStart, end: frameIndex - 1 });
      }
      activeStart = -1;
      previousCenter = null;
      continue;
    }

    const center = validPoints.reduce(
      (acc, index) => {
        const offset = index * STRIDE;
        return {
          x: acc.x + buffer[offset],
          y: acc.y + buffer[offset + 1],
          z: acc.z + buffer[offset + 2],
        };
      },
      { x: 0, y: 0, z: 0 },
    );
    center.x /= validPoints.length;
    center.y /= validPoints.length;
    center.z /= validPoints.length;

    const scale = estimateTorsoScale(frames[frameIndex]);
    const speed = previousCenter
      ? Math.sqrt(
          (center.x - previousCenter.x) * (center.x - previousCenter.x) +
            (center.y - previousCenter.y) * (center.y - previousCenter.y) +
            (center.z - previousCenter.z) * (center.z - previousCenter.z),
        )
      : Number.POSITIVE_INFINITY;
    const contact = speed < scale * 0.08;

    if (contact && activeStart < 0) {
      activeStart = Math.max(0, frameIndex - 1);
    }
    if (!contact && activeStart >= 0) {
      if (frameIndex - activeStart >= 3) {
        runs.push({ start: activeStart, end: frameIndex - 1 });
      }
      activeStart = -1;
    }

    previousCenter = center;
  }

  if (activeStart >= 0 && frames.length - activeStart >= 3) {
    runs.push({ start: activeStart, end: frames.length - 1 });
  }

  return runs;
}

function applyFootLocks(frames: MutableFrame[], confidenceGate: number) {
  let fixes = 0;
  const feet = [
    [MP33.LEFT_ANKLE, MP33.LEFT_HEEL, MP33.LEFT_FOOT_INDEX],
    [MP33.RIGHT_ANKLE, MP33.RIGHT_HEEL, MP33.RIGHT_FOOT_INDEX],
  ] as const;

  for (const footIndexes of feet) {
    for (const run of detectContactRuns(frames, footIndexes, confidenceGate)) {
      const anchors = footIndexes.map((landmarkIndex) => {
        const samples = frames
          .slice(run.start, run.end + 1)
          .map((frame) => (frame.worldLandmarks ?? frame.landmarks) as Float32Array | undefined)
          .filter((buffer): buffer is Float32Array => Boolean(buffer && isValidPoint(buffer, landmarkIndex, confidenceGate)));
        const count = Math.max(1, samples.length);

        const offset = landmarkIndex * STRIDE;
        const summed = samples.reduce(
          (acc, buffer) => ({
            x: acc.x + buffer[offset],
            y: acc.y + buffer[offset + 1],
            z: acc.z + buffer[offset + 2],
          }),
          { x: 0, y: 0, z: 0 },
        );
        return {
          x: summed.x / count,
          y: summed.y / count,
          z: summed.z / count,
        };
      });

      for (let footIndex = 0; footIndex < footIndexes.length; footIndex += 1) {
        const landmarkIndex = footIndexes[footIndex];
        const anchor = anchors[footIndex];

        for (let frameIndex = run.start; frameIndex <= run.end; frameIndex += 1) {
          const buffer = frames[frameIndex].worldLandmarks ?? frames[frameIndex].landmarks;
          if (!isValidPoint(buffer, landmarkIndex, confidenceGate)) continue;

          const offset = landmarkIndex * STRIDE;
          buffer[offset] = anchor.x;
          buffer[offset + 2] = anchor.z;
          buffer[offset + 3] = Math.max(buffer[offset + 3], 0.7);
          fixes += 1;
        }
      }
    }
  }

  return fixes;
}

function stabilizeRoot(frames: MutableFrame[]) {
  if (frames.length === 0) return false;

  const refNormalizedPose = mp33ToJointPose(frames[0].landmarks, {
    scale: 1,
    space: "normalized",
  });
  const refWorldPose = frames.every((frame) => frame.worldLandmarks)
    ? mp33ToJointPose(frames[0].worldLandmarks!, {
        scale: 1,
        space: "world",
      })
    : null;

  const maxNormalizedDisplacement = Math.max(
    ...frames.map((frame) => {
      const pose = mp33ToJointPose(frame.landmarks, {
        scale: 1,
        space: "normalized",
      });
      return Math.hypot(
        pose.Hips.x - refNormalizedPose.Hips.x,
        pose.Hips.z - refNormalizedPose.Hips.z,
      );
    }),
    0,
  );
  const normalizedShoulderWidth = estimateTorsoScale(frames[0]);

  if (maxNormalizedDisplacement > normalizedShoulderWidth * 0.14) {
    return false;
  }

  for (const frame of frames) {
    const normalizedPose = mp33ToJointPose(frame.landmarks, {
      scale: 1,
      space: "normalized",
    });
    const dxNorm = normalizedPose.Hips.x - refNormalizedPose.Hips.x;
    const dzNorm = normalizedPose.Hips.z - refNormalizedPose.Hips.z;

    for (const key of [
      "landmarks",
      "faceLandmarks",
      "leftHandLandmarks",
      "rightHandLandmarks",
    ] as const) {
      const current = frame[key];
      if (!current) continue;
      for (let index = 0; index < current.length; index += STRIDE) {
        current[index] -= dxNorm;
        current[index + 2] -= dzNorm;
      }
    }

    if (refWorldPose && frame.worldLandmarks) {
      const worldPose = mp33ToJointPose(frame.worldLandmarks, {
        scale: 1,
        space: "world",
      });
      const dxWorld = worldPose.Hips.x - refWorldPose.Hips.x;
      const dzWorld = worldPose.Hips.z - refWorldPose.Hips.z;
      for (const key of [
        "worldLandmarks",
        "leftHandWorldLandmarks",
        "rightHandWorldLandmarks",
      ] as const) {
        const current = frame[key];
        if (!current) continue;
        for (let index = 0; index < current.length; index += STRIDE) {
          current[index] -= dxWorld;
          current[index + 2] -= dzWorld;
        }
      }
    }
  }

  return true;
}

function finalizeFrames(frames: MutableFrame[]): PoseFrame[] {
  return frames.map((frame) => ({
    ...frame,
    landmarks: new Float32Array(frame.landmarks),
    worldLandmarks: frame.worldLandmarks ? new Float32Array(frame.worldLandmarks) : undefined,
    faceLandmarks: frame.faceLandmarks ? new Float32Array(frame.faceLandmarks) : undefined,
    leftHandLandmarks: frame.leftHandLandmarks
      ? new Float32Array(frame.leftHandLandmarks)
      : undefined,
    leftHandWorldLandmarks: frame.leftHandWorldLandmarks
      ? new Float32Array(frame.leftHandWorldLandmarks)
      : undefined,
    rightHandLandmarks: frame.rightHandLandmarks
      ? new Float32Array(frame.rightHandLandmarks)
      : undefined,
    rightHandWorldLandmarks: frame.rightHandWorldLandmarks
      ? new Float32Array(frame.rightHandWorldLandmarks)
      : undefined,
  }));
}

export const PoseCleanupPipeline = {
  run(frames: readonly PoseFrame[], opts?: CleanupOptions): CleanupResult {
    if (frames.length === 0) {
      return {
        frames: [],
        report: {
          status: "cleaned",
          trimmedStartFrames: 0,
          trimmedEndFrames: 0,
          gapFillCount: 0,
          outlierFixCount: 0,
          contactLockCount: 0,
          trajectoryFixCount: 0,
          rootStabilized: false,
          qualityScore: 0,
          processedAt: Date.now(),
        },
      };
    }

    const confidenceGate = opts?.confidenceGate ?? 0.45;
    const maxSpan = opts?.gapFillMaxSpan ?? 3;
    const trim = trimFrames(frames, confidenceGate);
    const trimmed = frames.slice(trim.start, trim.end + 1);
    const mutable = (trimmed.length > 0 ? trimmed : frames).map(cloneFrame);

    let gapFillCount = 0;
    let outlierFixCount = 0;
    let trajectoryFixCount = 0;

    for (const key of BODY_BUFFER_KEYS) {
      gapFillCount += fillShortGaps(mutable, key, confidenceGate, maxSpan);
      outlierFixCount += rejectOutliers(mutable, key, confidenceGate);
      trajectoryFixCount += applyEuroFilter(mutable, key, confidenceGate);
    }

    const contactLockCount = applyFootLocks(mutable, confidenceGate);
    const rootStabilized = stabilizeRoot(mutable);
    const cleanedFrames = finalizeFrames(mutable);

    const qualityScore = clamp(
      Math.round(
        96 -
          trim.start * 1.6 -
          Math.max(0, frames.length - 1 - trim.end) * 1.6 -
          gapFillCount * 0.08 -
          outlierFixCount * 0.1 -
          trajectoryFixCount * 0.02 +
          Math.min(8, contactLockCount * 0.01) +
          (rootStabilized ? 4 : 0),
      ),
      0,
      100,
    );

    return {
      frames: cleanedFrames,
      report: {
        status: "cleaned",
        trimmedStartFrames: trim.start,
        trimmedEndFrames: Math.max(0, frames.length - 1 - trim.end),
        gapFillCount,
        outlierFixCount,
        contactLockCount,
        trajectoryFixCount,
        rootStabilized,
        qualityScore,
        processedAt: Date.now(),
      },
    };
  },
};
