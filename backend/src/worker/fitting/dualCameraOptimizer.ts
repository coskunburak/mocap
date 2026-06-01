import type {
  DualFitLossSummary,
  DualFitQualityMetrics,
  DualFitReportArtifact,
  DualFitStatus,
  PerCameraPoseArtifact,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
  TriangulatedJointTrackJoint,
  Vector3,
} from "../types";
import { SKELETON } from "../export/skeletonDefinition";
import { buildDualFitMetrics } from "./fittingConstraints";
import {
  evaluateDualFitQualityGates,
  hasBlockingGateFailure,
} from "./fittingQuality";
import {
  DEFAULT_DUAL_FIT_CONSTRAINTS,
  type DualCameraFittingOptimizationResult,
  type RunDualCameraFittingFoundationInput,
  normalizeDualFitOptions,
} from "./fittingTypes";

type ReliableConstraint = {
  frameIndex: number;
  jointId: string;
  skeletonJointName: string;
  point: Vector3;
  confidence: number;
  reprojectionErrorPx: number;
};

type MutableVector3 = [number, number, number];

const JOINT_TO_SKELETON: Record<string, string> = {
  hips: "Hips",
  pelvis: "Hips",
  root: "Hips",
  spine: "Spine",
  chest: "Chest",
  neck: "Neck",
  head: "Head",
  left_shoulder: "LeftShoulder",
  left_elbow: "LeftForeArm",
  left_wrist: "LeftHand",
  left_hand: "LeftHand",
  right_shoulder: "RightShoulder",
  right_elbow: "RightForeArm",
  right_wrist: "RightHand",
  right_hand: "RightHand",
  left_hip: "LeftUpLeg",
  left_knee: "LeftLeg",
  left_ankle: "LeftFoot",
  left_foot: "LeftFoot",
  right_hip: "RightUpLeg",
  right_knee: "RightLeg",
  right_ankle: "RightFoot",
  right_foot: "RightFoot",
};

const ROOT_JOINT_IDS = new Set(["hips", "pelvis", "root", "left_hip", "right_hip"]);

export function runDualCameraFittingOptimization(
  input: RunDualCameraFittingFoundationInput,
): DualCameraFittingOptimizationResult {
  const options = normalizeDualFitOptions({
    ...input.options,
    acceptOptimizedOutput: true,
  });
  const smplInitialization = input.smplInitialization ?? input.whamInitialization?.smpl;
  const hasWhamInitialization =
    isUsableWhamInitialization(input.whamInitialization) && Boolean(smplInitialization);
  const constraints = collectReliableConstraints(input.jointTrack, options);
  const reliableConstraintRatio =
    constraints.totalCandidateCount > 0
      ? constraints.reliable.length / constraints.totalCandidateCount
      : null;
  const optimizedMotion =
    hasWhamInitialization && input.jointTrack && constraints.reliable.length > 0
      ? optimizeSolvedMotion({
          motion: input.whamInitialization!,
          constraints: constraints.reliable,
          maxRootAdjustmentMeters: options.maxRootAdjustmentMeters,
          maxJointRotationAdjustmentDegrees:
            options.maxJointRotationAdjustmentDegrees,
        })
      : undefined;
  const motionDelta = optimizedMotion
    ? averageMotionDelta(input.whamInitialization, optimizedMotion)
    : null;
  const baseMetrics = buildDualFitMetrics({ jointTrack: input.jointTrack });
  const metrics: DualFitQualityMetrics = {
    ...baseMetrics,
    reliableConstraintRatio,
    temporalJitterBefore:
      baseMetrics.temporalJitterBefore ?? rootJitter(input.whamInitialization),
    temporalJitterAfter: optimizedMotion
      ? rootJitter(optimizedMotion)
      : baseMetrics.temporalJitterAfter,
    jointLimitViolationCount: optimizedMotion
      ? jointLimitViolationCount(optimizedMotion)
      : baseMetrics.jointLimitViolationCount,
    optimizedMotionDelta: motionDelta,
    acceptedAsFinalAnimation: false,
  };
  const gates = evaluateDualFitQualityGates({
    metrics,
    cameraCalibration: input.cameraCalibration,
    options,
  });
  const blockingGateFailed = hasBlockingGateFailure(gates);
  const hasSemanticAdjustment =
    typeof motionDelta === "number" && motionDelta > 1e-6;
  const acceptedAsFinalAnimation =
    hasWhamInitialization &&
    Boolean(input.jointTrack) &&
    Boolean(optimizedMotion) &&
    hasSemanticAdjustment &&
    !blockingGateFailed;
  const status = resolveStatus({
    hasWhamInitialization,
    hasJointTrack: Boolean(input.jointTrack),
    hasReliableConstraints: constraints.reliable.length > 0,
    hasSemanticAdjustment,
    blockingGateFailed,
    acceptedAsFinalAnimation,
  });
  const warnings = buildWarnings({
    gates,
    status,
    hasReliableConstraints: constraints.reliable.length > 0,
    hasSemanticAdjustment,
    acceptedAsFinalAnimation,
  });
  const report: DualFitReportArtifact = {
    schema: "mocap.dual_fit_report.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    status,
    reason: reasonForStatus(status),
    inputSources: {
      initialization: hasWhamInitialization ? "primary_wham" : "unavailable",
      jointTrack: input.jointTrack ? "triangulated_joint_track_json" : null,
      pose2D: poseArtifactRefs(input.poseArtifacts),
      calibration: input.cameraCalibration ? "camera_calibration_json" : null,
    },
    constraints: DEFAULT_DUAL_FIT_CONSTRAINTS,
    losses: buildOptimizationLosses(metrics),
    metrics: {
      ...metrics,
      acceptedAsFinalAnimation,
    },
    qualityGates: gates,
    acceptedAsFinalAnimation,
    finalAnimationSourceCandidate: acceptedAsFinalAnimation
      ? "true_dual_solve"
      : "primary_wham",
    artifactRefs: fittingArtifactRefs(input.artifactRefs),
    warnings,
  };
  return {
    report,
    ...(acceptedAsFinalAnimation && optimizedMotion ? { optimizedMotion } : {}),
  };
}

function collectReliableConstraints(
  jointTrack: TriangulatedJointTrackArtifact | undefined,
  options: ReturnType<typeof normalizeDualFitOptions>,
) {
  const reliable: ReliableConstraint[] = [];
  let totalCandidateCount = 0;
  for (const frame of jointTrack?.frames ?? []) {
    for (const joint of frame.joints) {
      totalCandidateCount += 1;
      const constraint = reliableConstraintFromJoint(frame.frameIndex, joint, options);
      if (constraint) reliable.push(constraint);
    }
  }
  return { reliable, totalCandidateCount };
}

function reliableConstraintFromJoint(
  frameIndex: number,
  joint: TriangulatedJointTrackJoint,
  options: ReturnType<typeof normalizeDualFitOptions>,
): ReliableConstraint | null {
  const jointId = normalizeJointId(joint.jointId);
  const skeletonJointName = JOINT_TO_SKELETON[jointId];
  if (!skeletonJointName) return null;
  if (joint.status !== "tracked" && joint.status !== "smoothed" && joint.status !== "interpolated") {
    return null;
  }
  if (!finite(joint.x) || !finite(joint.y) || !finite(joint.z)) return null;
  const confidence = finite(joint.confidence) ? joint.confidence : 0;
  if (confidence < 0.5) return null;
  const reprojectionErrorPx = finite(joint.reprojectionErrorPx)
    ? joint.reprojectionErrorPx
    : Number.POSITIVE_INFINITY;
  if (reprojectionErrorPx > options.maxReprojectionErrorPx) return null;
  if (new Set(joint.sourceCameraIds).size < 2) return null;
  return {
    frameIndex,
    jointId,
    skeletonJointName,
    point: [joint.x, joint.y, joint.z],
    confidence,
    reprojectionErrorPx,
  };
}

function optimizeSolvedMotion(input: {
  motion: SolvedMotionArtifact;
  constraints: readonly ReliableConstraint[];
  maxRootAdjustmentMeters: number;
  maxJointRotationAdjustmentDegrees: number;
}): SolvedMotionArtifact {
  const constraintsByFrame = groupConstraintsByFrame(input.constraints);
  const frames = input.motion.frames.map((frame) => {
    const constraints = constraintsByFrame.get(frame.frameIndex) ?? [];
    const rootTarget = rootTargetFromConstraints(constraints);
    const rootTranslation = rootTarget
      ? adjustRoot(frame.rootTranslation, rootTarget, input.maxRootAdjustmentMeters)
      : frame.rootTranslation;
    const joints = { ...frame.joints };
    for (const constraint of constraints) {
      const current = joints[constraint.skeletonJointName] ?? [0, 0, 0];
      joints[constraint.skeletonJointName] = adjustJointRotation({
        current,
        point: constraint.point,
        rootTranslation,
        confidence: constraint.confidence,
        reprojectionErrorPx: constraint.reprojectionErrorPx,
        maxDegrees: input.maxJointRotationAdjustmentDegrees,
      });
    }
    return {
      ...frame,
      rootTranslation,
      joints,
    };
  });
  const smoothedFrames = smoothRootTranslations(frames);
  const { smpl: _smpl, ...motionWithoutSmpl } = input.motion;
  return {
    ...motionWithoutSmpl,
    frames: smoothedFrames,
    frameCount: smoothedFrames.length,
    validation: {
      ok: true,
      warnings: [
        ...input.motion.validation.warnings,
        "dual_camera_constrained_skeleton_adjustment",
        "optimized_smpl_parameters_not_produced",
      ],
      errors: [],
    },
    optimizedFrom: {
      source: "primary_wham",
      method: "dual_camera_constrained_skeleton_adjustment",
      constraintsApplied: input.constraints.length,
      acceptedAsFinalAnimation: false,
      warnings: ["This is not full SMPL optimization."],
    },
  };
}

function groupConstraintsByFrame(constraints: readonly ReliableConstraint[]) {
  const grouped = new Map<number, ReliableConstraint[]>();
  for (const constraint of constraints) {
    const list = grouped.get(constraint.frameIndex) ?? [];
    list.push(constraint);
    grouped.set(constraint.frameIndex, list);
  }
  return grouped;
}

function rootTargetFromConstraints(
  constraints: readonly ReliableConstraint[],
): Vector3 | null {
  const rootConstraints = constraints.filter((constraint) =>
    ROOT_JOINT_IDS.has(constraint.jointId),
  );
  if (!rootConstraints.length) return null;
  return averageVector(rootConstraints.map((constraint) => constraint.point));
}

function adjustRoot(
  current: Vector3,
  target: Vector3,
  maxRootAdjustmentMeters: number,
): MutableVector3 {
  const delta: Vector3 = [
    target[0] - current[0],
    target[1] - current[1],
    target[2] - current[2],
  ];
  const magnitude = Math.hypot(delta[0], delta[1], delta[2]);
  const scale =
    magnitude > maxRootAdjustmentMeters && magnitude > 0
      ? maxRootAdjustmentMeters / magnitude
      : 1;
  return [
    current[0] + delta[0] * scale,
    current[1] + delta[1] * scale,
    current[2] + delta[2] * scale,
  ];
}

function adjustJointRotation(input: {
  current: [number, number, number];
  point: Vector3;
  rootTranslation: Vector3;
  confidence: number;
  reprojectionErrorPx: number;
  maxDegrees: number;
}): [number, number, number] {
  const reprojectionWeight = 1 / (1 + Math.max(0, input.reprojectionErrorPx));
  const weight = clamp01(input.confidence) * reprojectionWeight;
  const relative: Vector3 = [
    input.point[0] - input.rootTranslation[0],
    input.point[1] - input.rootTranslation[1],
    input.point[2] - input.rootTranslation[2],
  ];
  const rawDelta: [number, number, number] = [
    relative[1] * input.maxDegrees,
    -relative[0] * input.maxDegrees,
    relative[2] * input.maxDegrees * 0.25,
  ];
  return [
    clampRotation(input.current[0] + clamp(rawDelta[0] * weight, -input.maxDegrees, input.maxDegrees)),
    clampRotation(input.current[1] + clamp(rawDelta[1] * weight, -input.maxDegrees, input.maxDegrees)),
    clampRotation(input.current[2] + clamp(rawDelta[2] * weight, -input.maxDegrees, input.maxDegrees)),
  ];
}

function smoothRootTranslations<T extends { rootTranslation: Vector3 }>(
  frames: readonly T[],
): T[] {
  return frames.map((frame, index) => {
    if (index === 0 || index === frames.length - 1) return frame;
    const previous = frames[index - 1].rootTranslation;
    const next = frames[index + 1].rootTranslation;
    return {
      ...frame,
      rootTranslation: [
        (previous[0] + frame.rootTranslation[0] * 2 + next[0]) / 4,
        (previous[1] + frame.rootTranslation[1] * 2 + next[1]) / 4,
        (previous[2] + frame.rootTranslation[2] * 2 + next[2]) / 4,
      ] as MutableVector3,
    };
  });
}

function buildOptimizationLosses(
  metrics: DualFitQualityMetrics,
): DualFitLossSummary {
  const initializationLoss = metrics.optimizedMotionDelta ?? null;
  const triangulatedJointLoss =
    metrics.reliableConstraintRatio === null ||
    metrics.reliableConstraintRatio === undefined
      ? null
      : 1 - metrics.reliableConstraintRatio;
  const boneLengthLoss =
    metrics.boneLengthConsistencyScore === null ||
    metrics.boneLengthConsistencyScore === undefined
      ? null
      : 1 - metrics.boneLengthConsistencyScore;
  const totalLoss = sumFinite([
    initializationLoss,
    triangulatedJointLoss,
    metrics.averageReprojectionErrorPxBefore,
    boneLengthLoss,
    metrics.temporalJitterAfter,
  ]);
  return {
    initializationLoss,
    triangulatedJointLoss,
    reprojectionLoss: metrics.averageReprojectionErrorPxBefore,
    boneLengthLoss,
    jointLimitLoss:
      metrics.jointLimitViolationCount === null ||
      metrics.jointLimitViolationCount === undefined
        ? null
        : metrics.jointLimitViolationCount,
    footContactLoss: null,
    temporalSmoothnessLoss: metrics.temporalJitterAfter,
    totalLoss,
  };
}

function resolveStatus(input: {
  hasWhamInitialization: boolean;
  hasJointTrack: boolean;
  hasReliableConstraints: boolean;
  hasSemanticAdjustment: boolean;
  blockingGateFailed: boolean;
  acceptedAsFinalAnimation: boolean;
}): DualFitStatus {
  if (!input.hasWhamInitialization) return "missing_wham_initialization";
  if (!input.hasJointTrack) return "missing_joint_track";
  if (!input.hasReliableConstraints || !input.hasSemanticAdjustment) {
    return "insufficient_quality";
  }
  if (input.blockingGateFailed) return "insufficient_quality";
  return input.acceptedAsFinalAnimation ? "ready" : "optimization_failed";
}

function buildWarnings(input: {
  gates: ReturnType<typeof evaluateDualFitQualityGates>;
  status: DualFitStatus;
  hasReliableConstraints: boolean;
  hasSemanticAdjustment: boolean;
  acceptedAsFinalAnimation: boolean;
}) {
  const warnings = new Set<string>();
  warnings.add("dual_fit_method_constrained_skeleton_adjustment_not_full_smpl");
  for (const gate of input.gates) {
    if (!gate.passed && gate.reason) warnings.add(gate.reason);
  }
  if (!input.hasReliableConstraints) warnings.add("dual_fit_no_reliable_constraints");
  if (!input.hasSemanticAdjustment) warnings.add("dual_fit_no_semantic_motion_delta");
  if (!input.acceptedAsFinalAnimation) warnings.add("dual_fit_rejected_primary_wham_final");
  if (input.status === "ready") warnings.add("dual_fit_accepted_true_dual_solve_candidate");
  return Array.from(warnings);
}

function reasonForStatus(status: DualFitStatus): string {
  if (status === "ready") {
    return "Constrained dual-camera skeleton adjustment passed acceptance gates; optimized BVH export can become final if export validation passes.";
  }
  if (status === "missing_wham_initialization") {
    return "Primary WHAM solved motion and SMPL initialization are required before dual fitting can run.";
  }
  if (status === "missing_joint_track") {
    return "Triangulated joint track artifact is required before dual fitting can run.";
  }
  if (status === "insufficient_quality") {
    return "Dual-camera constraints did not pass acceptance gates; primary WHAM remains final.";
  }
  return "Dual-camera fitting optimization did not produce an accepted result.";
}

function isUsableWhamInitialization(
  solved: SolvedMotionArtifact | undefined,
): solved is SolvedMotionArtifact {
  return Boolean(
    solved &&
      solved.schema === "mocap.solved_motion.v1" &&
      solved.frames.length > 0 &&
      solved.frameCount === solved.frames.length &&
      solved.validation.ok,
  );
}

function poseArtifactRefs(
  poseArtifacts: readonly PerCameraPoseArtifact[] | undefined,
): string[] {
  return (poseArtifacts ?? [])
    .map((artifact) => `pose_frames_device_${artifact.deviceIndex}_json`)
    .sort();
}

function fittingArtifactRefs(
  artifactRefs: Record<string, string> | undefined,
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const key of [
    "triangulated_joint_track_json",
    "pose_frames_device_0_json",
    "pose_frames_device_1_json",
    "camera_calibration_json",
  ]) {
    const value = artifactRefs?.[key];
    if (value) refs[key] = value;
  }
  return refs;
}

function averageMotionDelta(
  before: SolvedMotionArtifact | undefined,
  after: SolvedMotionArtifact,
): number | null {
  if (!before || before.frames.length !== after.frames.length) return null;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < before.frames.length; index += 1) {
    const left = before.frames[index];
    const right = after.frames[index];
    sum += vectorDistance(left.rootTranslation, right.rootTranslation);
    count += 1;
    for (const joint of SKELETON) {
      const beforeRotation = left.joints[joint.name];
      const afterRotation = right.joints[joint.name];
      if (!beforeRotation || !afterRotation) continue;
      sum += vectorDistance(beforeRotation, afterRotation) / 180;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function rootJitter(motion: SolvedMotionArtifact | undefined): number | null {
  if (!motion || motion.frames.length < 3) return null;
  const deltas: number[] = [];
  for (let index = 2; index < motion.frames.length; index += 1) {
    const a = motion.frames[index - 2].rootTranslation;
    const b = motion.frames[index - 1].rootTranslation;
    const c = motion.frames[index].rootTranslation;
    const velocityA: Vector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const velocityB: Vector3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    deltas.push(vectorDistance(velocityA, velocityB));
  }
  return deltas.length ? average(deltas) : null;
}

function jointLimitViolationCount(motion: SolvedMotionArtifact) {
  let violations = 0;
  for (const frame of motion.frames) {
    for (const rotation of Object.values(frame.joints)) {
      if (rotation.some((value) => Math.abs(value) > 180)) violations += 1;
    }
  }
  return violations;
}

function averageVector(points: readonly Vector3[]): Vector3 {
  const sum = points.reduce(
    (acc, point) => [
      acc[0] + point[0],
      acc[1] + point[1],
      acc[2] + point[2],
    ] as Vector3,
    [0, 0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function normalizeJointId(jointId: string) {
  return jointId.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function vectorDistance(left: Vector3, right: Vector3) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function sumFinite(values: readonly (number | null | undefined)[]) {
  const finiteValues = values.filter(finite);
  return finiteValues.length
    ? finiteValues.reduce((sum, value) => sum + value, 0)
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clampRotation(value: number) {
  return clamp(value, -180, 180);
}
