import type {
  CameraCalibrationArtifact,
  DualFitQualityGateResult,
  DualFitQualityMetrics,
} from "../types";
import type { NormalizedDualFitOptions } from "./fittingTypes";

export function evaluateDualFitQualityGates(input: {
  metrics: DualFitQualityMetrics;
  cameraCalibration?: CameraCalibrationArtifact;
  options: NormalizedDualFitOptions;
}): DualFitQualityGateResult[] {
  const gates: DualFitQualityGateResult[] = [
    triangulatedJointRatioGate(input.metrics, input.options),
    ...(input.options.acceptOptimizedOutput
      ? [reliableConstraintRatioGate(input.metrics, input.options)]
      : []),
    calibrationReadinessGate(input.cameraCalibration, input.options),
    reprojectionErrorGate(input.metrics, input.options),
    temporalJitterGate(input.metrics, input.options),
    boneLengthConsistencyGate(input.metrics, input.options),
    jointLimitGate(input.metrics, input.options),
    footContactGate(input.metrics, input.options),
  ];
  return gates;
}

export function hasBlockingGateFailure(
  gates: readonly DualFitQualityGateResult[],
) {
  return gates.some((gate) => !gate.passed && gate.severity === "blocking");
}

export function summarizeQualityGates(
  gates: readonly DualFitQualityGateResult[],
) {
  return {
    passed: gates.filter((gate) => gate.passed).length,
    failed: gates.filter((gate) => !gate.passed).length,
    blockingFailed: gates.filter(
      (gate) => !gate.passed && gate.severity === "blocking",
    ).length,
    warningFailed: gates.filter(
      (gate) => !gate.passed && gate.severity === "warning",
    ).length,
  };
}

function triangulatedJointRatioGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.triangulatedJointRatio);
  if (value === undefined) {
    return {
      name: "triangulated_joint_ratio",
      passed: false,
      value: null,
      threshold: options.minTriangulatedJointRatio,
      severity: "blocking",
      reason: "Triangulated joint ratio is unavailable.",
    };
  }
  return {
    name: "triangulated_joint_ratio",
    passed: value >= options.minTriangulatedJointRatio,
    value,
    threshold: options.minTriangulatedJointRatio,
    severity: "blocking",
    reason:
      value >= options.minTriangulatedJointRatio
        ? null
        : "Triangulated joint coverage is below the fitting threshold.",
  };
}

function reliableConstraintRatioGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.reliableConstraintRatio);
  if (value === undefined) {
    return {
      name: "reliable_constraint_ratio",
      passed: false,
      value: null,
      threshold: options.minReliableConstraintRatio,
      severity: "blocking",
      reason: "Reliable dual-camera constraint ratio is unavailable.",
    };
  }
  return {
    name: "reliable_constraint_ratio",
    passed: value >= options.minReliableConstraintRatio,
    value,
    threshold: options.minReliableConstraintRatio,
    severity: "blocking",
    reason:
      value >= options.minReliableConstraintRatio
        ? null
        : "Reliable dual-camera constraint coverage is below the acceptance threshold.",
  };
}

function calibrationReadinessGate(
  calibration: CameraCalibrationArtifact | undefined,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const status = calibration?.status ?? "ready";
  if (!calibration) {
    return {
      name: "calibration_readiness",
      passed: !options.requireReadyCalibration,
      value: "missing",
      threshold: "ready",
      severity: options.requireReadyCalibration ? "blocking" : "warning",
      reason: "Camera calibration artifact is unavailable.",
    };
  }
  if (status === "ready" || status === undefined) {
    return {
      name: "calibration_readiness",
      passed: true,
      value: "ready",
      threshold: "ready",
      severity: "blocking",
      reason: null,
    };
  }
  if (status === "approximate" || status === "diagnostic_only") {
    return {
      name: "calibration_readiness",
      passed: false,
      value: status,
      threshold: "ready",
      severity: options.acceptOptimizedOutput ? "blocking" : "warning",
      reason:
        "Calibration is not production-grade; true dual solve acceptance is blocked.",
    };
  }
  return {
    name: "calibration_readiness",
    passed: false,
    value: status,
    threshold: "ready",
    severity: "blocking",
    reason: "Camera calibration is not usable for constrained fitting.",
  };
}

function reprojectionErrorGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const after = finiteNumber(metrics.averageReprojectionErrorPxAfter);
  const before = finiteNumber(metrics.averageReprojectionErrorPxBefore);
  const value = after ?? before;
  if (value === undefined) {
    return {
      name: "reprojection_error",
      passed: false,
      value: null,
      threshold: options.maxReprojectionErrorPx,
      severity: "warning",
      reason: "Reprojection error is unavailable for Phase 5A fitting gates.",
    };
  }
  return {
    name: "reprojection_error",
    passed: value <= options.maxReprojectionErrorPx,
    value,
    threshold: options.maxReprojectionErrorPx,
    severity: "blocking",
    reason:
      value <= options.maxReprojectionErrorPx
        ? null
        : "Reprojection error is above the fitting threshold.",
  };
}

function temporalJitterGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.temporalJitterAfter);
  if (value === undefined) {
    return {
      name: "temporal_jitter",
      passed: false,
      value: null,
      threshold: options.maxTemporalJitter,
      severity: "warning",
      reason: "Temporal jitter is unavailable for Phase 5A fitting gates.",
    };
  }
  return {
    name: "temporal_jitter",
    passed: value <= options.maxTemporalJitter,
    value,
    threshold: options.maxTemporalJitter,
    severity: "warning",
    reason:
      value <= options.maxTemporalJitter
        ? null
        : "Temporal jitter is above the diagnostic threshold.",
  };
}

function boneLengthConsistencyGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.boneLengthConsistencyScore);
  if (value === undefined) {
    return {
      name: "bone_length_consistency",
      passed: false,
      value: null,
      threshold: options.minBoneLengthConsistencyScore,
      severity: "warning",
      reason: "Bone length consistency could not be computed from available joints.",
    };
  }
  return {
    name: "bone_length_consistency",
    passed: value >= options.minBoneLengthConsistencyScore,
    value,
    threshold: options.minBoneLengthConsistencyScore,
    severity: "warning",
    reason:
      value >= options.minBoneLengthConsistencyScore
        ? null
        : "Bone length consistency is below the diagnostic threshold.",
  };
}

function jointLimitGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.jointLimitViolationCount);
  if (value === undefined) {
    return {
      name: "joint_limit_violations",
      passed: false,
      value: null,
      threshold: options.maxJointLimitViolationCount,
      severity: "warning",
      reason: "Joint limit evaluation is not implemented in Phase 5A.",
    };
  }
  return {
    name: "joint_limit_violations",
    passed: value <= options.maxJointLimitViolationCount,
    value,
    threshold: options.maxJointLimitViolationCount,
    severity: "warning",
    reason:
      value <= options.maxJointLimitViolationCount
        ? null
        : "Joint limit violation count is above the diagnostic threshold.",
  };
}

function footContactGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.footContactStabilityScore);
  if (value === undefined) {
    return {
      name: "foot_contact_stability",
      passed: false,
      value: null,
      threshold: options.minFootContactStabilityScore,
      severity: "warning",
      reason: "Foot contact stability is not available in Phase 5A.",
    };
  }
  return {
    name: "foot_contact_stability",
    passed: value >= options.minFootContactStabilityScore,
    value,
    threshold: options.minFootContactStabilityScore,
    severity: "warning",
    reason:
      value >= options.minFootContactStabilityScore
        ? null
        : "Foot contact stability is below the diagnostic threshold.",
  };
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
