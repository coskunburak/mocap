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
  maxReprojectionP95Px?: number;
  minCalibrationQualityScore?: number;
  maxTemporalJitter?: number;
  maxTemporalJitterIncreaseRatio?: number;
  minBoneLengthConsistencyScore?: number;
  maxJointLimitViolationCount?: number;
  minFootContactStabilityScore?: number;
  requireReadyCalibration?: boolean;
  maxRootAdjustmentMeters?: number;
  maxRootTranslationDeltaMeters?: number;
  maxJointRotationAdjustmentDegrees?: number;
  minOptimizedMotionDelta?: number;
  maxOptimizedMotionDelta?: number;
  minConstraintConfidence?: number;
  maxConstraintDistanceMeters?: number;
  maxFootSlidingMetersPerFrame?: number;
  requireOptimizedBvhValidation?: boolean;
  requireOptimizedArtifactsForAcceptance?: boolean;
  acceptOptimizedOutput?: boolean;
  acceptApproximateCalibration?: boolean;
};

export type NormalizedDualFitOptions = Required<DualFitOptions>;

export type DualCameraOptimizationOptions = DualFitOptions;

export interface DualCameraOptimizationInput {
  takeId: string;
  jobId: string;
  whamMotion: SolvedMotionArtifact;
  smplInitialization?: SmplParametersArtifact;
  triangulatedJointTrack: TriangulatedJointTrackArtifact;
  cameraCalibration?: CameraCalibrationArtifact;
  perCameraPoseArtifacts?: readonly PerCameraPoseArtifact[];
  artifactRefs?: Record<string, string>;
  options?: DualCameraOptimizationOptions;
}

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
    maxReprojectionP95Px: options?.maxReprojectionP95Px ?? 12,
    minCalibrationQualityScore: options?.minCalibrationQualityScore ?? 0.75,
    maxTemporalJitter: options?.maxTemporalJitter ?? 0.5,
    maxTemporalJitterIncreaseRatio:
      options?.maxTemporalJitterIncreaseRatio ?? 0.15,
    minBoneLengthConsistencyScore:
      options?.minBoneLengthConsistencyScore ?? 0.65,
    maxJointLimitViolationCount:
      options?.maxJointLimitViolationCount ?? 0,
    minFootContactStabilityScore:
      options?.minFootContactStabilityScore ?? 0.65,
    requireReadyCalibration: options?.requireReadyCalibration ?? true,
    maxRootAdjustmentMeters: options?.maxRootAdjustmentMeters ?? 0.25,
    maxRootTranslationDeltaMeters:
      options?.maxRootTranslationDeltaMeters ??
      options?.maxRootAdjustmentMeters ??
      0.25,
    maxJointRotationAdjustmentDegrees:
      options?.maxJointRotationAdjustmentDegrees ?? 6,
    minOptimizedMotionDelta: options?.minOptimizedMotionDelta ?? 1e-6,
    maxOptimizedMotionDelta: options?.maxOptimizedMotionDelta ?? 0.2,
    minConstraintConfidence: options?.minConstraintConfidence ?? 0.5,
    maxConstraintDistanceMeters: options?.maxConstraintDistanceMeters ?? 20,
    maxFootSlidingMetersPerFrame:
      options?.maxFootSlidingMetersPerFrame ?? 0.03,
    requireOptimizedBvhValidation:
      options?.requireOptimizedBvhValidation ?? false,
    requireOptimizedArtifactsForAcceptance:
      options?.requireOptimizedArtifactsForAcceptance ?? false,
    acceptOptimizedOutput: options?.acceptOptimizedOutput ?? false,
    acceptApproximateCalibration: options?.acceptApproximateCalibration ?? false,
  };
}
