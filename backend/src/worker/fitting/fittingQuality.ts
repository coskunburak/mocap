import type {
  CameraCalibrationArtifact,
  DualFitAcceptanceSummary,
  DualFitGateFailureCode,
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
    calibrationQualityGate(input.metrics, input.options),
    reprojectionErrorGate(input.metrics, input.options),
    reprojectionP95Gate(input.metrics, input.options),
    temporalJitterGate(input.metrics, input.options),
    temporalJitterIncreaseGate(input.metrics, input.options),
    boneLengthConsistencyGate(input.metrics, input.options),
    jointLimitGate(input.metrics, input.options),
    footContactGate(input.metrics, input.options),
    ...(input.options.acceptOptimizedOutput
      ? [
          rootTranslationDeltaGate(input.metrics, input.options),
          optimizedMotionDeltaGate(input.metrics, input.options),
          optimizedMotionValidGate(input.metrics),
          ...optimizedBvhGate(input.metrics, input.options),
          ...optimizedArtifactsGate(input.metrics, input.options),
        ]
      : []),
  ];
  return gates;
}

export function hasBlockingGateFailure(
  gates: readonly DualFitQualityGateResult[],
) {
  return gates.some((gate) => !gate.passed && gate.severity === "blocking");
}

const DUAL_FIT_QUALITY_METRIC_KEYS: readonly (keyof DualFitQualityMetrics)[] = [
  "triangulatedJointRatio",
  "reliableConstraintRatio",
  "reliableConstraintCount",
  "candidateConstraintCount",
  "rejectedConstraintCount",
  "lowConfidenceConstraintCount",
  "highReprojectionConstraintCount",
  "invalidConstraintCount",
  "triangulatedJointMeanPositionErrorBefore",
  "triangulatedJointMeanPositionErrorAfter",
  "triangulatedJointP95PositionErrorBefore",
  "triangulatedJointP95PositionErrorAfter",
  "averageReprojectionErrorPxBefore",
  "averageReprojectionErrorPxAfter",
  "reprojectionP95PxBefore",
  "reprojectionP95PxAfter",
  "reprojectionImprovementRatio",
  "calibrationQualityScore",
  "temporalJitterBefore",
  "temporalJitterAfter",
  "temporalJitterIncreaseRatio",
  "temporalSmoothingGain",
  "boneLengthConsistencyScore",
  "boneLengthMeanVariation",
  "boneLengthMaxVariation",
  "jointLimitViolationCount",
  "footContactStabilityScore",
  "footLockViolationCount",
  "rootTranslationMeanDelta",
  "rootTranslationMaxDelta",
  "optimizedMotionDelta",
  "optimizedMotionValid",
  "optimizedBvhValid",
  "optimizedArtifactsPresent",
  "fullSmplOptimization",
  "acceptedAsFinalAnimation",
];

export function buildDualFitAcceptanceSummary(input: {
  metrics: DualFitQualityMetrics;
  gates: readonly DualFitQualityGateResult[];
  acceptedAsFinalAnimation: boolean;
  additionalBlockingFailures?: readonly DualFitGateFailureCode[];
  additionalWarnings?: readonly DualFitGateFailureCode[];
}): DualFitAcceptanceSummary {
  const blockingFailures = uniqueCodes([
    ...input.gates
      .filter((gate) => !gate.passed && gate.severity === "blocking")
      .map((gate) => gate.code)
      .filter(isGateFailureCode),
    ...(input.additionalBlockingFailures ?? []),
  ]);
  const warnings = uniqueCodes([
    ...input.gates
      .filter((gate) => !gate.passed && gate.severity === "warning")
      .map((gate) => gate.code)
      .filter(isGateFailureCode),
    ...(input.additionalWarnings ?? []),
  ]);
  const unavailableMetrics = Array.from(
    new Set(
      input.gates
        .filter(
          (gate) =>
            !gate.passed &&
            gate.value === null &&
            isGateFailureCode(gate.code) &&
            gate.code.endsWith("_unavailable"),
        )
        .map((gate) => gate.name),
    ),
  );
  const accepted =
    input.acceptedAsFinalAnimation && blockingFailures.length === 0;
  return {
    accepted,
    blockingFailures,
    warnings,
    unavailableMetrics,
    metrics: qualityMetricSnapshot(input.metrics),
    finalAnimationSourceRecommendation: accepted
      ? "true_dual_solve"
      : "primary_wham",
  };
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
      code: "triangulated_joint_ratio_unavailable",
      reason: "Triangulated joint ratio is unavailable.",
    };
  }
  return {
    name: "triangulated_joint_ratio",
    passed: value >= options.minTriangulatedJointRatio,
    value,
    threshold: options.minTriangulatedJointRatio,
    severity: "blocking",
    code: value >= options.minTriangulatedJointRatio
      ? null
      : "triangulated_joint_ratio_low",
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
      code: "reliable_constraint_ratio_unavailable",
      reason: "Reliable dual-camera constraint ratio is unavailable.",
    };
  }
  return {
    name: "reliable_constraint_ratio",
    passed: value >= options.minReliableConstraintRatio,
    value,
    threshold: options.minReliableConstraintRatio,
    severity: "blocking",
    code: value >= options.minReliableConstraintRatio
      ? null
      : "reliable_constraint_ratio_low",
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
      code: "calibration_not_ready",
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
      code: null,
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
      code: "calibration_not_ready",
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
    code: "calibration_not_ready",
    reason: "Camera calibration is not usable for constrained fitting.",
  };
}

function calibrationQualityGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.calibrationQualityScore);
  if (value === undefined) {
    return {
      name: "calibration_quality",
      passed: false,
      value: null,
      threshold: options.minCalibrationQualityScore,
      severity: options.acceptOptimizedOutput ? "blocking" : "warning",
      code: "calibration_quality_low",
      reason: "Camera calibration quality score is unavailable.",
    };
  }
  return {
    name: "calibration_quality",
    passed: value >= options.minCalibrationQualityScore,
    value,
    threshold: options.minCalibrationQualityScore,
    severity: options.acceptOptimizedOutput ? "blocking" : "warning",
    code: value >= options.minCalibrationQualityScore
      ? null
      : "calibration_quality_low",
    reason:
      value >= options.minCalibrationQualityScore
        ? null
        : "Camera calibration quality is below the true dual solve threshold.",
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
      severity: options.acceptOptimizedOutput ? "blocking" : "warning",
      code: "reprojection_error_unavailable",
      reason: "Reprojection error is unavailable for dual fitting gates.",
    };
  }
  return {
    name: "reprojection_error",
    passed: value <= options.maxReprojectionErrorPx,
    value,
    threshold: options.maxReprojectionErrorPx,
    severity: "blocking",
    code: value <= options.maxReprojectionErrorPx
      ? null
      : "reprojection_error_high",
    reason:
      value <= options.maxReprojectionErrorPx
        ? null
        : "Reprojection error is above the fitting threshold.",
  };
}

function reprojectionP95Gate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const after = finiteNumber(metrics.reprojectionP95PxAfter);
  const before = finiteNumber(metrics.reprojectionP95PxBefore);
  const value = after ?? before;
  if (value === undefined) {
    return {
      name: "reprojection_p95",
      passed: false,
      value: null,
      threshold: options.maxReprojectionP95Px,
      severity: options.acceptOptimizedOutput ? "blocking" : "warning",
      code: "reprojection_error_unavailable",
      reason: "Reprojection p95 is unavailable for dual fitting gates.",
    };
  }
  return {
    name: "reprojection_p95",
    passed: value <= options.maxReprojectionP95Px,
    value,
    threshold: options.maxReprojectionP95Px,
    severity: "blocking",
    code: value <= options.maxReprojectionP95Px
      ? null
      : "reprojection_p95_high",
    reason:
      value <= options.maxReprojectionP95Px
        ? null
        : "Reprojection p95 is above the fitting threshold.",
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
      code: "temporal_jitter_unavailable",
      reason: "Temporal jitter is unavailable for dual fitting gates.",
    };
  }
  return {
    name: "temporal_jitter",
    passed: value <= options.maxTemporalJitter,
    value,
    threshold: options.maxTemporalJitter,
    severity: "warning",
    code: value <= options.maxTemporalJitter
      ? null
      : "temporal_jitter_increased",
    reason:
      value <= options.maxTemporalJitter
        ? null
        : "Temporal jitter is above the diagnostic threshold.",
  };
}

function temporalJitterIncreaseGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.temporalJitterIncreaseRatio);
  if (value === undefined) {
    return {
      name: "temporal_jitter_increase",
      passed: false,
      value: null,
      threshold: options.maxTemporalJitterIncreaseRatio,
      severity: "warning",
      code: "temporal_jitter_unavailable",
      reason: "Temporal jitter increase could not be computed from available frames.",
    };
  }
  return {
    name: "temporal_jitter_increase",
    passed: value <= options.maxTemporalJitterIncreaseRatio,
    value,
    threshold: options.maxTemporalJitterIncreaseRatio,
    severity: options.acceptOptimizedOutput ? "blocking" : "warning",
    code: value <= options.maxTemporalJitterIncreaseRatio
      ? null
      : "temporal_jitter_increased",
    reason:
      value <= options.maxTemporalJitterIncreaseRatio
        ? null
        : "Optimized motion increases temporal jitter beyond the acceptance threshold.",
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
      severity: options.acceptOptimizedOutput ? "blocking" : "warning",
      code: "bone_length_consistency_unavailable",
      reason: "Bone length consistency could not be computed from available joints.",
    };
  }
  return {
    name: "bone_length_consistency",
    passed: value >= options.minBoneLengthConsistencyScore,
    value,
    threshold: options.minBoneLengthConsistencyScore,
    severity: options.acceptOptimizedOutput ? "blocking" : "warning",
    code: value >= options.minBoneLengthConsistencyScore
      ? null
      : "bone_length_consistency_low",
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
      severity: options.acceptOptimizedOutput ? "blocking" : "warning",
      code: "joint_limit_unavailable",
      reason: "Joint limit evaluation is unavailable.",
    };
  }
  return {
    name: "joint_limit_violations",
    passed: value <= options.maxJointLimitViolationCount,
    value,
    threshold: options.maxJointLimitViolationCount,
    severity: options.acceptOptimizedOutput ? "blocking" : "warning",
    code: value <= options.maxJointLimitViolationCount
      ? null
      : "joint_limit_violation_high",
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
      code: "foot_contact_stability_unavailable",
      reason: "Foot contact stability is not available for dual fitting gates.",
    };
  }
  return {
    name: "foot_contact_stability",
    passed: value >= options.minFootContactStabilityScore,
    value,
    threshold: options.minFootContactStabilityScore,
    severity: "warning",
    code: value >= options.minFootContactStabilityScore
      ? null
      : "foot_contact_stability_low",
    reason:
      value >= options.minFootContactStabilityScore
        ? null
        : "Foot contact stability is below the diagnostic threshold.",
  };
}

function rootTranslationDeltaGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.rootTranslationMaxDelta);
  if (value === undefined) {
    return {
      name: "root_translation_delta",
      passed: false,
      value: null,
      threshold: options.maxRootTranslationDeltaMeters,
      severity: "blocking",
      code: "optimized_motion_invalid",
      reason: "Root translation correction delta is unavailable.",
    };
  }
  return {
    name: "root_translation_delta",
    passed: value <= options.maxRootTranslationDeltaMeters,
    value,
    threshold: options.maxRootTranslationDeltaMeters,
    severity: "blocking",
    code: value <= options.maxRootTranslationDeltaMeters
      ? null
      : "excessive_motion_delta",
    reason:
      value <= options.maxRootTranslationDeltaMeters
        ? null
        : "Root translation correction exceeds the acceptance threshold.",
  };
}

function optimizedMotionDeltaGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult {
  const value = finiteNumber(metrics.optimizedMotionDelta);
  if (value === undefined) {
    return {
      name: "optimized_motion_delta",
      passed: false,
      value: null,
      threshold: options.minOptimizedMotionDelta,
      severity: "blocking",
      code: "insufficient_motion_delta",
      reason: "Optimized motion delta is unavailable.",
    };
  }
  if (value < options.minOptimizedMotionDelta) {
    return {
      name: "optimized_motion_delta",
      passed: false,
      value,
      threshold: options.minOptimizedMotionDelta,
      severity: "blocking",
      code: "insufficient_motion_delta",
      reason: "Dual fitting did not produce a meaningful correction.",
    };
  }
  return {
    name: "optimized_motion_delta",
    passed: value <= options.maxOptimizedMotionDelta,
    value,
    threshold: options.maxOptimizedMotionDelta,
    severity: "blocking",
    code: value <= options.maxOptimizedMotionDelta
      ? null
      : "excessive_motion_delta",
    reason:
      value <= options.maxOptimizedMotionDelta
        ? null
        : "Optimized motion delta exceeds the acceptance threshold.",
  };
}

function optimizedMotionValidGate(
  metrics: DualFitQualityMetrics,
): DualFitQualityGateResult {
  const value = metrics.optimizedMotionValid;
  return {
    name: "optimized_motion_valid",
    passed: value === true,
    value: typeof value === "boolean" ? value : null,
    threshold: true,
    severity: "blocking",
    code: value === true ? null : "optimized_motion_invalid",
    reason:
      value === true
        ? null
        : "Optimized solved motion is missing or structurally invalid.",
  };
}

function optimizedBvhGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult[] {
  if (
    !options.requireOptimizedBvhValidation &&
    metrics.optimizedBvhValid == null
  ) {
    return [];
  }
  const value = metrics.optimizedBvhValid;
  return [
    {
      name: "optimized_bvh_valid",
      passed: value === true,
      value: typeof value === "boolean" ? value : null,
      threshold: true,
      severity: "blocking",
      code: value === true
        ? null
        : value === false
          ? "optimized_bvh_invalid"
          : "optimized_bvh_missing",
      reason:
        value === true
          ? null
          : "Optimized BVH validation has not passed.",
    },
  ];
}

function optimizedArtifactsGate(
  metrics: DualFitQualityMetrics,
  options: NormalizedDualFitOptions,
): DualFitQualityGateResult[] {
  if (
    !options.requireOptimizedArtifactsForAcceptance &&
    metrics.optimizedArtifactsPresent == null
  ) {
    return [];
  }
  const value = metrics.optimizedArtifactsPresent;
  return [
    {
      name: "optimized_artifacts_present",
      passed: value === true,
      value: typeof value === "boolean" ? value : null,
      threshold: true,
      severity: "blocking",
      code: value === true ? null : "optimized_artifacts_missing",
      reason:
        value === true
          ? null
          : "Optimized solved motion and BVH artifacts are not present.",
    },
  ];
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function qualityMetricSnapshot(
  metrics: DualFitQualityMetrics,
): DualFitAcceptanceSummary["metrics"] {
  const snapshot: DualFitAcceptanceSummary["metrics"] = {};
  for (const key of DUAL_FIT_QUALITY_METRIC_KEYS) {
    const value = metrics[key];
    if (typeof value === "number") {
      if (Number.isFinite(value)) snapshot[key] = value;
      continue;
    }
    if (typeof value === "boolean" || value === null) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function uniqueCodes(
  codes: readonly DualFitGateFailureCode[],
): DualFitGateFailureCode[] {
  return Array.from(new Set(codes));
}

function isGateFailureCode(
  code: DualFitGateFailureCode | null | undefined,
): code is DualFitGateFailureCode {
  return typeof code === "string";
}
