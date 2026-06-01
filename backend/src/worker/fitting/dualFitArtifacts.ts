import type { DualFitReportArtifact } from "../types";
import type { DualFitValidationResult } from "./fittingTypes";

export function validateDualFitReportArtifact(
  artifact: DualFitReportArtifact,
): DualFitValidationResult {
  const errors: string[] = [];
  if (artifact.schema !== "mocap.dual_fit_report.v1") {
    errors.push("schema must be mocap.dual_fit_report.v1");
  }
  if (!artifact.takeId) errors.push("takeId is required");
  if (!artifact.jobId) errors.push("jobId is required");
  if (
    artifact.acceptedAsFinalAnimation &&
    artifact.finalAnimationSourceCandidate !== "true_dual_solve"
  ) {
    errors.push("accepted dual fit reports must target true_dual_solve.");
  }
  if (
    !artifact.acceptedAsFinalAnimation &&
    artifact.finalAnimationSourceCandidate !== "primary_wham"
  ) {
    errors.push("rejected dual fit reports must keep primary_wham as the final source candidate.");
  }
  if (artifact.acceptedAsFinalAnimation && artifact.status !== "ready") {
    errors.push("accepted dual fit reports must have ready status.");
  }
  for (const [index, gate] of artifact.qualityGates.entries()) {
    if (!gate.name) errors.push(`qualityGates[${index}].name is required`);
    if (typeof gate.passed !== "boolean") {
      errors.push(`qualityGates[${index}].passed must be boolean`);
    }
    if (gate.severity !== "blocking" && gate.severity !== "warning") {
      errors.push(`qualityGates[${index}].severity is invalid`);
    }
  }
  validateFiniteOrNull(artifact.metrics.triangulatedJointRatio, "triangulatedJointRatio", errors);
  validateFiniteOrNull(
    artifact.metrics.averageReprojectionErrorPxBefore,
    "averageReprojectionErrorPxBefore",
    errors,
  );
  validateFiniteOrNull(
    artifact.metrics.averageReprojectionErrorPxAfter,
    "averageReprojectionErrorPxAfter",
    errors,
  );
  validateFiniteOrNull(
    artifact.metrics.temporalJitterBefore,
    "temporalJitterBefore",
    errors,
  );
  validateFiniteOrNull(
    artifact.metrics.temporalJitterAfter,
    "temporalJitterAfter",
    errors,
  );
  validateFiniteOrNull(
    artifact.metrics.reliableConstraintRatio,
    "reliableConstraintRatio",
    errors,
  );
  validateFiniteOrNull(
    artifact.metrics.optimizedMotionDelta,
    "optimizedMotionDelta",
    errors,
  );
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateFiniteOrNull(
  value: number | null | undefined,
  name: string,
  errors: string[],
) {
  if (value !== undefined && value !== null && !Number.isFinite(value)) {
    errors.push(`${name} must be finite, null, or omitted`);
  }
}
