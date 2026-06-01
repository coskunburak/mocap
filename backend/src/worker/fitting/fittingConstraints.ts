import type {
  DualFitQualityMetrics,
  TriangulatedJointTrackArtifact,
  TriangulatedJointTrackJoint,
  Vector3,
} from "../types";

const BONE_PAIRS: readonly (readonly [string, string])[] = [
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "right_shoulder"],
  ["left_hip", "right_hip"],
];

export function computeBoneLengthConsistencyScore(
  jointTrack: TriangulatedJointTrackArtifact | undefined,
): number | undefined {
  if (!jointTrack?.frames.length) return undefined;
  const pairScores = BONE_PAIRS.flatMap(([startJointId, endJointId]) => {
    const lengths = jointTrack.frames.flatMap((frame) => {
      const start = trackedPoint(frame.joints.find((joint) => joint.jointId === startJointId));
      const end = trackedPoint(frame.joints.find((joint) => joint.jointId === endJointId));
      if (!start || !end) return [];
      return [distance(start, end)];
    });
    if (lengths.length < 2) return [];
    const mean = average(lengths);
    if (mean <= 0) return [];
    const variance = average(lengths.map((length) => (length - mean) ** 2));
    const coefficientOfVariation = Math.sqrt(variance) / mean;
    return [clamp01(1 - coefficientOfVariation)];
  });

  return pairScores.length ? average(pairScores) : undefined;
}

export function buildDualFitMetrics(input: {
  jointTrack?: TriangulatedJointTrackArtifact;
}): DualFitQualityMetrics {
  const jointTrack = input.jointTrack;
  return {
    triangulatedJointRatio: finiteOrNull(
      jointTrack?.metrics.triangulatedJointRatio,
    ),
    reliableConstraintRatio: null,
    averageReprojectionErrorPxBefore: finiteOrNull(
      jointTrack?.metrics.averageReprojectionErrorPx,
    ),
    averageReprojectionErrorPxAfter: null,
    reprojectionImprovementRatio: null,
    temporalJitterBefore: finiteOrNull(jointTrack?.metrics.temporalJitterBefore),
    temporalJitterAfter: finiteOrNull(jointTrack?.metrics.temporalJitterAfter),
    temporalSmoothingGain: finiteOrNull(jointTrack?.metrics.temporalSmoothingGain),
    boneLengthConsistencyScore: finiteOrNull(
      computeBoneLengthConsistencyScore(jointTrack),
    ),
    jointLimitViolationCount: null,
    footContactStabilityScore: null,
    optimizedMotionDelta: null,
    acceptedAsFinalAnimation: false,
  };
}

function trackedPoint(joint: TriangulatedJointTrackJoint | undefined): Vector3 | null {
  if (!joint) return null;
  if (
    !Number.isFinite(joint.x) ||
    !Number.isFinite(joint.y) ||
    !Number.isFinite(joint.z)
  ) {
    return null;
  }
  return [joint.x ?? 0, joint.y ?? 0, joint.z ?? 0];
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function distance(left: Vector3, right: Vector3) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
