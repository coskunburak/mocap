import type {
  CameraCalibrationArtifact,
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
  return computeBoneLengthConsistencyStats(jointTrack)?.score;
}

export function computeBoneLengthConsistencyStats(
  jointTrack: TriangulatedJointTrackArtifact | undefined,
):
  | {
      score: number;
      meanVariation: number;
      maxVariation: number;
    }
  | undefined {
  if (!jointTrack?.frames.length) return undefined;
  const pairStats = BONE_PAIRS.flatMap(([startJointId, endJointId]) => {
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
    return [
      {
        score: clamp01(1 - coefficientOfVariation),
        variation: coefficientOfVariation,
      },
    ];
  });

  if (!pairStats.length) return undefined;
  return {
    score: average(pairStats.map((stat) => stat.score)),
    meanVariation: average(pairStats.map((stat) => stat.variation)),
    maxVariation: Math.max(...pairStats.map((stat) => stat.variation)),
  };
}

export function buildDualFitMetrics(input: {
  jointTrack?: TriangulatedJointTrackArtifact;
  cameraCalibration?: CameraCalibrationArtifact;
}): DualFitQualityMetrics {
  const jointTrack = input.jointTrack;
  const boneStats = computeBoneLengthConsistencyStats(jointTrack);
  return {
    triangulatedJointRatio: finiteOrNull(
      jointTrack?.metrics.triangulatedJointRatio,
    ),
    reliableConstraintRatio: null,
    averageReprojectionErrorPxBefore: finiteOrNull(
      jointTrack?.metrics.averageReprojectionErrorPx,
    ),
    averageReprojectionErrorPxAfter: null,
    reprojectionP95PxBefore: finiteOrNull(jointTrack?.metrics.reprojectionP95Px),
    reprojectionP95PxAfter: null,
    reprojectionImprovementRatio: null,
    calibrationQualityScore: finiteOrNull(input.cameraCalibration?.quality.score),
    temporalJitterBefore: finiteOrNull(jointTrack?.metrics.temporalJitterBefore),
    temporalJitterAfter: finiteOrNull(jointTrack?.metrics.temporalJitterAfter),
    temporalSmoothingGain: finiteOrNull(jointTrack?.metrics.temporalSmoothingGain),
    boneLengthConsistencyScore: finiteOrNull(boneStats?.score),
    boneLengthMeanVariation: finiteOrNull(boneStats?.meanVariation),
    boneLengthMaxVariation: finiteOrNull(boneStats?.maxVariation),
    jointLimitViolationCount: null,
    footContactStabilityScore: null,
    footLockViolationCount: null,
    optimizedMotionDelta: null,
    optimizedMotionValid: null,
    optimizedBvhValid: null,
    optimizedArtifactsPresent: null,
    fullSmplOptimization: false,
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
