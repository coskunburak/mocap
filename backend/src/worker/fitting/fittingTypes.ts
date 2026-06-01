import type {
  CameraCalibrationArtifact,
  DualFitConstraintSet,
  DualFitReportArtifact,
  PerCameraPoseArtifact,
  SmplParametersArtifact,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
} from "../types";

export const DEFAULT_DUAL_FIT_CONSTRAINTS: DualFitConstraintSet = {
  triangulated3DEnabled: true,
  reprojection2DEnabled: true,
  boneLengthConsistencyEnabled: true,
  jointAngleLimitsEnabled: true,
  footContactEnabled: true,
  temporalSmoothnessEnabled: true,
  centerOfMassEnabled: false,
  leftRightConsistencyEnabled: true,
};

export type DualFitOptions = {
  minTriangulatedJointRatio?: number;
  minReliableConstraintRatio?: number;
  maxReprojectionErrorPx?: number;
  maxTemporalJitter?: number;
  minBoneLengthConsistencyScore?: number;
  maxJointLimitViolationCount?: number;
  minFootContactStabilityScore?: number;
  requireReadyCalibration?: boolean;
  maxRootAdjustmentMeters?: number;
  maxJointRotationAdjustmentDegrees?: number;
  acceptOptimizedOutput?: boolean;
};

export type NormalizedDualFitOptions = Required<DualFitOptions>;

export type RunDualCameraFittingFoundationInput = {
  takeId: string;
  jobId: string;
  whamInitialization?: SolvedMotionArtifact;
  smplInitialization?: SmplParametersArtifact;
  jointTrack?: TriangulatedJointTrackArtifact;
  poseArtifacts?: readonly PerCameraPoseArtifact[];
  cameraCalibration?: CameraCalibrationArtifact;
  artifactRefs?: Record<string, string>;
  options?: DualFitOptions;
};

export type DualCameraFittingOptimizationResult = {
  report: DualFitReportArtifact;
  optimizedMotion?: SolvedMotionArtifact;
};

export type DualFitValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type DualFitReportBuilderInput = Omit<
  DualFitReportArtifact,
  "schema" | "acceptedAsFinalAnimation" | "finalAnimationSourceCandidate"
>;

export function normalizeDualFitOptions(
  options: DualFitOptions | undefined,
): NormalizedDualFitOptions {
  return {
    minTriangulatedJointRatio: options?.minTriangulatedJointRatio ?? 0.65,
    minReliableConstraintRatio: options?.minReliableConstraintRatio ?? 0.25,
    maxReprojectionErrorPx: options?.maxReprojectionErrorPx ?? 10,
    maxTemporalJitter: options?.maxTemporalJitter ?? 0.5,
    minBoneLengthConsistencyScore:
      options?.minBoneLengthConsistencyScore ?? 0.65,
    maxJointLimitViolationCount:
      options?.maxJointLimitViolationCount ?? 0,
    minFootContactStabilityScore:
      options?.minFootContactStabilityScore ?? 0.65,
    requireReadyCalibration: options?.requireReadyCalibration ?? true,
    maxRootAdjustmentMeters: options?.maxRootAdjustmentMeters ?? 0.25,
    maxJointRotationAdjustmentDegrees:
      options?.maxJointRotationAdjustmentDegrees ?? 6,
    acceptOptimizedOutput: options?.acceptOptimizedOutput ?? false,
  };
}
