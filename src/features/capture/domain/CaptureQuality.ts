import { lmAt } from "../../../domain/mocap/models/Landmark";
import { MP33 } from "../../../domain/mocap/models/MediapipePose33";
import type { CaptureQualityMetadata } from "../../../domain/mocap/models/CaptureMetadata";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";

const REQUIRED_JOINTS = [
  MP33.LEFT_SHOULDER,
  MP33.RIGHT_SHOULDER,
  MP33.LEFT_HIP,
  MP33.RIGHT_HIP,
  MP33.LEFT_ANKLE,
  MP33.RIGHT_ANKLE,
] as const;

const OPTIONAL_JOINTS = [
  MP33.NOSE,
  MP33.LEFT_ELBOW,
  MP33.RIGHT_ELBOW,
  MP33.LEFT_WRIST,
  MP33.RIGHT_WRIST,
  MP33.LEFT_KNEE,
  MP33.RIGHT_KNEE,
] as const;

export type CaptureQualityAccumulator = {
  frameCount: number;
  confidenceSum: number;
  fullBodyVisibleFrames: number;
  badFrames: number;
  trackingLossCount: number;
  poseFpsSum: number;
  poseFpsSamples: number;
  wasTrackingLocked: boolean;
};

export function createCaptureQualityAccumulator(): CaptureQualityAccumulator {
  return {
    frameCount: 0,
    confidenceSum: 0,
    fullBodyVisibleFrames: 0,
    badFrames: 0,
    trackingLossCount: 0,
    poseFpsSum: 0,
    poseFpsSamples: 0,
    wasTrackingLocked: false,
  };
}

function confidenceAt(frame: PoseFrame, index: number) {
  return lmAt(frame.landmarks, index).c ?? 0;
}

function trackedCount(frame: PoseFrame, indices: readonly number[], threshold: number) {
  return indices.reduce((count, index) => {
    return count + (confidenceAt(frame, index) >= threshold ? 1 : 0);
  }, 0);
}

export function observeCaptureQualityFrame(
  acc: CaptureQualityAccumulator,
  frame: PoseFrame,
  poseFps: number,
  threshold: number,
) {
  const gate = Math.max(0.25, Math.min(0.9, threshold));
  const requiredTracked = trackedCount(frame, REQUIRED_JOINTS, gate);
  const optionalTracked = trackedCount(frame, OPTIONAL_JOINTS, gate * 0.92);
  const fullBodyVisible = requiredTracked >= 5 && optionalTracked >= 3;
  const confidence =
    REQUIRED_JOINTS.reduce((sum, index) => sum + confidenceAt(frame, index), 0) /
    REQUIRED_JOINTS.length;

  acc.frameCount += 1;
  acc.confidenceSum += confidence;
  acc.fullBodyVisibleFrames += fullBodyVisible ? 1 : 0;
  acc.badFrames += fullBodyVisible ? 0 : 1;

  if (!fullBodyVisible && acc.wasTrackingLocked) {
    acc.trackingLossCount += 1;
  }
  acc.wasTrackingLocked = fullBodyVisible;

  if (Number.isFinite(poseFps) && poseFps > 0) {
    acc.poseFpsSum += poseFps;
    acc.poseFpsSamples += 1;
  }
}

export function finalizeCaptureQuality(
  acc: CaptureQualityAccumulator,
): CaptureQualityMetadata {
  const frameCount = Math.max(1, acc.frameCount);
  return {
    averagePoseConfidence: acc.confidenceSum / frameCount,
    fullBodyVisibleRatio: acc.fullBodyVisibleFrames / frameCount,
    badFrames: acc.badFrames,
    trackingLossCount: acc.trackingLossCount,
    poseFpsAverage:
      acc.poseFpsSamples > 0 ? acc.poseFpsSum / acc.poseFpsSamples : 0,
  };
}

