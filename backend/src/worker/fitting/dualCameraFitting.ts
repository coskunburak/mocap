import type {
  DualFitLossSummary,
  DualFitReportArtifact,
  DualFitStatus,
  PerCameraPoseArtifact,
  SolvedMotionArtifact,
} from "../types";
import { buildDualFitMetrics } from "./fittingConstraints";
import {
  evaluateDualFitQualityGates,
  hasBlockingGateFailure,
} from "./fittingQuality";
import {
  DEFAULT_DUAL_FIT_CONSTRAINTS,
  type RunDualCameraFittingFoundationInput,
  normalizeDualFitOptions,
} from "./fittingTypes";

export function runDualCameraFittingFoundation(
  input: RunDualCameraFittingFoundationInput,
): DualFitReportArtifact {
  const options = normalizeDualFitOptions(input.options);
  const smplInitialization = input.smplInitialization ?? input.whamInitialization?.smpl;
  const hasWhamInitialization = isUsableWhamInitialization(input.whamInitialization) &&
    Boolean(smplInitialization);
  const metrics = buildDualFitMetrics({ jointTrack: input.jointTrack });
  const gates = evaluateDualFitQualityGates({
    metrics,
    cameraCalibration: input.cameraCalibration,
    options,
  });
  const blockingGateFailed = hasBlockingGateFailure(gates);
  const warnings = new Set<string>();
  for (const gate of gates) {
    if (!gate.passed && gate.reason) warnings.add(gate.reason);
  }
  warnings.add("dual_fit_optimizer_not_implemented");

  const status = resolveStatus({
    hasWhamInitialization,
    hasJointTrack: Boolean(input.jointTrack),
    blockingGateFailed,
  });
  const reason = reasonForStatus(status);
  if (status === "missing_wham_initialization") {
    warnings.add("missing_wham_initialization");
  }
  if (status === "missing_joint_track") {
    warnings.add("missing_joint_track");
  }
  if (status === "insufficient_quality") {
    warnings.add("dual_fit_quality_gate_failed");
  }

  return {
    schema: "mocap.dual_fit_report.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    status,
    reason,
    inputSources: {
      initialization: hasWhamInitialization ? "primary_wham" : "unavailable",
      jointTrack: input.jointTrack ? "triangulated_joint_track_json" : null,
      pose2D: poseArtifactRefs(input.poseArtifacts),
      calibration: input.cameraCalibration ? "camera_calibration_json" : null,
    },
    constraints: DEFAULT_DUAL_FIT_CONSTRAINTS,
    losses: buildLosses(metrics),
    metrics,
    qualityGates: gates,
    acceptedAsFinalAnimation: false,
    finalAnimationSourceCandidate: "primary_wham",
    artifactRefs: fittingArtifactRefs(input.artifactRefs),
    warnings: Array.from(warnings),
  };
}

function resolveStatus(input: {
  hasWhamInitialization: boolean;
  hasJointTrack: boolean;
  blockingGateFailed: boolean;
}): DualFitStatus {
  if (!input.hasWhamInitialization) return "missing_wham_initialization";
  if (!input.hasJointTrack) return "missing_joint_track";
  if (input.blockingGateFailed) return "insufficient_quality";
  return "optimization_not_implemented";
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

function buildLosses(
  metrics: DualFitReportArtifact["metrics"],
): DualFitLossSummary {
  return {
    initializationLoss: null,
    triangulatedJointLoss: null,
    reprojectionLoss: metrics.averageReprojectionErrorPxBefore,
    boneLengthLoss:
      metrics.boneLengthConsistencyScore === null ||
      metrics.boneLengthConsistencyScore === undefined
        ? null
        : 1 - metrics.boneLengthConsistencyScore,
    jointLimitLoss: null,
    footContactLoss: null,
    temporalSmoothnessLoss: metrics.temporalJitterAfter,
    totalLoss: null,
  };
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

function reasonForStatus(status: DualFitStatus): string {
  if (status === "missing_wham_initialization") {
    return "Primary WHAM solved motion and SMPL initialization are required before dual fitting can run.";
  }
  if (status === "missing_joint_track") {
    return "Triangulated joint track artifact is required before dual fitting can run.";
  }
  if (status === "insufficient_quality") {
    return "One or more blocking dual fitting quality gates failed.";
  }
  if (status === "optimization_not_implemented") {
    return "Phase 5A evaluates constrained fitting readiness but does not run an optimizer or replace final animation.";
  }
  if (status === "diagnostic_only") {
    return "Dual fitting foundation completed for diagnostics only.";
  }
  return status;
}
