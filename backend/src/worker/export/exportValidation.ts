import type {
  CameraCalibrationArtifact,
  CalibrationObservationsArtifact,
  CaptureVolumeArtifact,
  CaptureMetadataDiagnostics,
  CleanupReport,
  DualFitReportArtifact,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  PreviewSummary,
  QualityReport,
  QualityReportFinalAnimationSource,
  QualityReportMultiViewSection,
  QualityReportMultiViewReconstructionStatus,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
  WhamInputUsageMetrics,
} from "../types";
import type {
  DualReconstructionArtifact,
  MultiViewReconstructionSummaryArtifact,
} from "../reconstruction/dualReconstructionArtifacts";
import { SKELETON } from "./skeletonDefinition";

export type QualityReportMultiViewDiagnosticInput = {
  reconstructionAvailable?: boolean;
  captureMetadataDiagnostics?: CaptureMetadataDiagnostics;
  syncReport?: MultiViewSyncReport;
  calibrationObservations?: CalibrationObservationsArtifact;
  cameraCalibration?: CameraCalibrationArtifact;
  captureVolume?: CaptureVolumeArtifact;
  reconstruction?: MultiViewReconstructionArtifact;
  jointTrack?: TriangulatedJointTrackArtifact;
  dualFitReport?: DualFitReportArtifact;
  dualReconstruction?: DualReconstructionArtifact;
  multiViewReconstruction?: MultiViewReconstructionSummaryArtifact;
  poseArtifacts?: readonly PerCameraPoseArtifact[];
  warnings?: string[];
  errorCode?: string;
  errorMessage?: string;
};

export type BuildQualityReportMultiViewSectionInput = {
  whamInputUsage?: WhamInputUsageMetrics;
  multiViewDiagnostic?: QualityReportMultiViewDiagnosticInput;
};

function hasOnlyFiniteNumbers(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumbers);
  if (value && typeof value === "object") {
    return Object.values(value).every(hasOnlyFiniteNumbers);
  }
  return true;
}

export function validateSolvedMotion(motion: SolvedMotionArtifact) {
  const errors = [...motion.validation.errors];
  const warnings = [...motion.validation.warnings];

  if (motion.frameCount !== motion.frames.length) {
    errors.push("frameCount does not match frame array length.");
  }
  if (motion.frames.length === 0) {
    errors.push("Motion contains no frames.");
  }
  if (!hasOnlyFiniteNumbers(motion.frames)) {
    errors.push("Motion contains NaN or Infinity.");
  }
  for (const frame of motion.frames) {
    for (const joint of SKELETON) {
      if (!frame.joints[joint.name]) {
        errors.push(`Missing joint rotation: ${joint.name}`);
        break;
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
  };
}

export function validateBvhText(bvh: string, frameCount: number) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!bvh.startsWith("HIERARCHY")) errors.push("BVH does not start with HIERARCHY.");
  if (!bvh.includes("ROOT Hips")) errors.push("BVH root joint Hips is missing.");
  if (!bvh.includes("MOTION")) errors.push("BVH MOTION block is missing.");
  if (!bvh.includes(`Frames: ${frameCount}`)) errors.push("BVH frame count header is wrong.");
  if (frameCount < 2) warnings.push("BVH contains fewer than two frames.");
  if (/NaN|Infinity/.test(bvh)) errors.push("BVH contains NaN or Infinity.");

  return { ok: errors.length === 0, errors, warnings };
}

export function buildQualityReportMultiViewSection(
  input: BuildQualityReportMultiViewSectionInput,
): QualityReportMultiViewSection | undefined {
  const source =
    input.whamInputUsage?.source ?? input.multiViewDiagnostic?.reconstruction?.source;
  if (!source || source === "single_camera") {
    return undefined;
  }

  const reconstructionAvailable = Boolean(
    input.whamInputUsage?.multiViewReconstructionAvailable ||
      input.multiViewDiagnostic?.reconstructionAvailable ||
    input.multiViewDiagnostic?.reconstruction ||
      input.multiViewDiagnostic?.jointTrack ||
      input.multiViewDiagnostic?.dualFitReport ||
      input.multiViewDiagnostic?.dualReconstruction ||
      input.multiViewDiagnostic?.multiViewReconstruction,
  );
  const primaryWhamFallbackReason =
    input.whamInputUsage?.primaryWhamFallbackReason === "none"
      ? undefined
      : input.whamInputUsage?.primaryWhamFallbackReason;
  const reconstructionStatus = resolveReconstructionStatus(input);
  const finalAnimationSource = resolveFinalAnimationSource({
    whamInputUsage: input.whamInputUsage,
    reconstructionAvailable,
    multiViewDiagnostic: input.multiViewDiagnostic,
  });
  const primaryCameraFallbackUsed =
    finalAnimationSource === "primary_wham" &&
    Boolean(input.whamInputUsage?.primaryVideoUsed);
  const metrics = buildMultiViewReportMetrics(input.multiViewDiagnostic);
  const syncReport = input.multiViewDiagnostic?.syncReport;
  const calibrationObservations =
    input.multiViewDiagnostic?.calibrationObservations;
  const calibrationObservationCount = calibrationObservations
    ? calibrationObservations.frames.reduce(
        (sum, frame) => sum + frame.observations.length,
        0,
      )
    : undefined;
  const calibrationObservationConfidence =
    calibrationObservations
      ? averageObservationConfidence(calibrationObservations)
      : undefined;
  const poseExtraction = buildMultiViewPoseExtractionSummary(
    input.multiViewDiagnostic?.poseArtifacts,
  );
  const calibrationReadiness = buildCalibrationReadinessSummary(
    input.multiViewDiagnostic?.cameraCalibration,
    input.multiViewDiagnostic?.captureVolume,
    input.multiViewDiagnostic?.reconstruction,
  );
  const metadataDiagnostics =
    input.multiViewDiagnostic?.captureMetadataDiagnostics;
  const warnings = buildMultiViewReportWarnings({
    whamInputUsage: input.whamInputUsage,
    multiViewDiagnostic: input.multiViewDiagnostic,
    finalAnimationSource,
    reconstructionStatus,
    primaryCameraFallbackUsed,
  });

  return {
    enabled: true,
    source,
    reconstructionAvailable,
    reconstructionUsedForConstraints:
      finalAnimationSource === "true_dual_solve" ||
      (input.whamInputUsage?.multiViewConstraintsUsed ?? false),
    primaryWhamFallbackUsed:
      finalAnimationSource === "true_dual_solve"
        ? false
        : (input.whamInputUsage?.primaryWhamFallbackUsed ?? false),
    primaryCameraFallbackUsed,
    finalAnimationSource,
    reconstructionStatus,
    dualReconstructionStatus: reconstructionStatus,
    trueDualSolveAvailable: finalAnimationSource === "true_dual_solve",
    ...(poseExtraction
      ? {
          poseDetectorSource: poseExtraction.poseDetectorSource,
          poseExtractionStatus: poseExtraction.poseExtractionStatus,
          poseFramesDevice0Status: poseExtraction.poseFramesDevice0Status,
          poseFramesDevice1Status: poseExtraction.poseFramesDevice1Status,
          averageKeypointConfidence: poseExtraction.averageKeypointConfidence,
          missingPoseFrameRatio: poseExtraction.missingPoseFrameRatio,
        }
      : {}),
    ...(syncReport
      ? {
          syncStatus: syncReport.status,
          syncMethod: syncReport.syncMethod,
          syncConfidence: syncReport.metrics.syncConfidence,
          averageTimeDeltaMs: syncReport.metrics.averageTimeDeltaMs,
          p95TimeDeltaMs: syncReport.metrics.p95TimeDeltaMs,
          syncDiagnosticOnly:
            syncReport.status === "diagnostic_only" ||
            syncReport.syncMethod === "index_based_diagnostic_sync" ||
            syncReport.syncMethod === "fallback",
        }
      : {}),
    ...(calibrationObservations
      ? {
          calibrationObservationStatus: calibrationObservations.status,
          calibrationTargetType: calibrationObservations.targetType,
          calibrationObservationCount,
          calibrationDetectorSource: calibrationObservations.detectorSource,
          calibrationObservationConfidence,
        }
      : observationFieldsFromCalibration(input.multiViewDiagnostic?.cameraCalibration)),
    ...calibrationReadiness,
    ...(input.multiViewDiagnostic?.jointTrack
      ? jointTrackTopLevelFields(input.multiViewDiagnostic.jointTrack)
      : {}),
    ...(input.multiViewDiagnostic?.dualFitReport
      ? dualFitTopLevelFields(input.multiViewDiagnostic.dualFitReport)
      : {}),
    ...(primaryWhamFallbackReason ? { primaryWhamFallbackReason } : {}),
    ...(input.whamInputUsage ? { whamInputUsage: input.whamInputUsage } : {}),
    ...(metadataDiagnostics
      ? {
          metadataCompleteness: metadataDiagnostics.metadataCompleteness,
          availableTimestampFields: metadataDiagnostics.availableTimestampFields,
          availableCameraMetadataFields:
            metadataDiagnostics.availableCameraMetadataFields,
          hasAudioTrack: metadataDiagnostics.hasAudioTrack,
          hasIntrinsics: metadataDiagnostics.hasIntrinsics,
          hasFrameTimestamps: metadataDiagnostics.hasFrameTimestamps,
          missingMetadataWarnings: metadataDiagnostics.missingMetadataWarnings,
        }
      : {}),
    ...(metrics ? { metrics } : {}),
    ...(poseExtraction ? { poseExtraction } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

function resolveFinalAnimationSource(input: {
  whamInputUsage?: WhamInputUsageMetrics;
  reconstructionAvailable: boolean;
  multiViewDiagnostic?: QualityReportMultiViewDiagnosticInput;
}): QualityReportFinalAnimationSource {
  const dualFitReport = input.multiViewDiagnostic?.dualFitReport;
  if (
    dualFitReport?.acceptedAsFinalAnimation &&
    dualFitReport.finalAnimationSourceCandidate === "true_dual_solve" &&
    dualFitReport.artifactRefs.optimized_bvh &&
    dualFitReport.artifactRefs.optimized_solved_motion_json
  ) {
    return "true_dual_solve";
  }
  if (
    input.whamInputUsage?.multiViewConstraintsUsed &&
    input.reconstructionAvailable
  ) {
    return "dual_triangulation_constraint";
  }
  if (input.whamInputUsage?.primaryVideoUsed) {
    return "primary_wham";
  }
  if (input.reconstructionAvailable) {
    return "dual_triangulation_diagnostic";
  }
  return "unavailable";
}

function resolveReconstructionStatus(
  input: BuildQualityReportMultiViewSectionInput,
): QualityReportMultiViewReconstructionStatus {
  if (input.multiViewDiagnostic?.dualReconstruction?.status) {
    return input.multiViewDiagnostic.dualReconstruction.status;
  }
  if (input.multiViewDiagnostic?.multiViewReconstruction?.status) {
    return input.multiViewDiagnostic.multiViewReconstruction.status;
  }
  const calibrationStatus = input.multiViewDiagnostic?.cameraCalibration?.status;
  if (
    calibrationStatus === "missing_calibration" ||
    calibrationStatus === "invalid_calibration" ||
    calibrationStatus === "insufficient_views" ||
    calibrationStatus === "failed"
  ) {
    return calibrationStatus;
  }
  if (input.multiViewDiagnostic?.reconstruction) {
    return "ready";
  }
  if (input.multiViewDiagnostic?.dualFitReport?.status) {
    return input.multiViewDiagnostic.dualFitReport.status;
  }
  if (input.multiViewDiagnostic?.errorCode) {
    return input.multiViewDiagnostic.errorCode;
  }
  return "unavailable";
}

function buildMultiViewReportMetrics(
  diagnostic: QualityReportMultiViewDiagnosticInput | undefined,
): QualityReportMultiViewSection["metrics"] | undefined {
  if (!diagnostic) {
    return undefined;
  }
  const metrics: NonNullable<QualityReportMultiViewSection["metrics"]> = {};
  const setFiniteMetric = (
    key: keyof NonNullable<QualityReportMultiViewSection["metrics"]>,
    value: number | undefined,
  ) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
    }
  };

  setFiniteMetric("syncOffsetMs", maxAbsoluteSyncOffsetMs(diagnostic.syncReport));
  setFiniteMetric("syncConfidence", diagnostic.syncReport?.metrics.syncConfidence);
  setFiniteMetric("matchedFrameCount", diagnostic.syncReport?.metrics.matchedFrameCount);
  setFiniteMetric("droppedFrameCount", diagnostic.syncReport?.metrics.droppedFrameCount);
  setFiniteMetric(
    "averageTimeDeltaMs",
    diagnostic.syncReport?.metrics.averageTimeDeltaMs,
  );
  setFiniteMetric(
    "p95TimeDeltaMs",
    diagnostic.syncReport?.metrics.p95TimeDeltaMs,
  );
  if (diagnostic.calibrationObservations) {
    setFiniteMetric(
      "calibrationObservationCount",
      diagnostic.calibrationObservations.frames.reduce(
        (sum, frame) => sum + frame.observations.length,
        0,
      ),
    );
    setFiniteMetric(
      "calibrationObservationConfidence",
      averageObservationConfidence(diagnostic.calibrationObservations),
    );
  }
  if (
    diagnostic.cameraCalibration &&
    diagnostic.cameraCalibration.devices.length > 0 &&
    diagnostic.cameraCalibration.status !== "missing_calibration" &&
    diagnostic.cameraCalibration.status !== "invalid_calibration"
  ) {
    setFiniteMetric(
      "calibrationQualityScore",
      diagnostic.cameraCalibration.quality.score,
    );
    setFiniteMetric(
      "baselineEstimate",
      diagnostic.cameraCalibration.baselineEstimate ??
        diagnostic.cameraCalibration.quality.baseline,
    );
  }
  setFiniteMetric(
    "baselineEstimate",
    diagnostic.captureVolume?.baselineEstimate ?? undefined,
  );
  if (diagnostic.cameraCalibration?.devices.length) {
    setFiniteMetric(
      "intrinsicsFallbackUsed",
      diagnostic.cameraCalibration.devices.some(
        (device) => device.intrinsicsSource === "fov_fallback",
      )
        ? 1
        : 0,
    );
    setFiniteMetric(
      "extrinsicsFallbackUsed",
      diagnostic.cameraCalibration.devices.some(
        (device) => device.extrinsicsSource === "role_angle_fallback",
      )
        ? 1
        : 0,
    );
  }

  const reconstructionMetrics = diagnostic.reconstruction?.metrics;
  setFiniteMetric("syncOffsetMs", reconstructionMetrics?.syncOffsetMs);
  setFiniteMetric("syncConfidence", reconstructionMetrics?.syncConfidence);
  setFiniteMetric("matchedFrameCount", reconstructionMetrics?.matchedFrameCount);
  setFiniteMetric("droppedFrameCount", reconstructionMetrics?.droppedFrameCount);
  setFiniteMetric("averageTimeDeltaMs", reconstructionMetrics?.averageTimeDeltaMs);
  setFiniteMetric("p95TimeDeltaMs", reconstructionMetrics?.p95TimeDeltaMs);
  setFiniteMetric("reprojectionErrorPx", reconstructionMetrics?.reprojectionErrorPx);
  setFiniteMetric("reprojectionP95Px", reconstructionMetrics?.reprojectionP95Px);
  setFiniteMetric(
    "triangulatedLandmarkRatio",
    reconstructionMetrics?.triangulatedLandmarkRatio,
  );
  setFiniteMetric(
    "fallbackLandmarkRatio",
    reconstructionMetrics?.fallbackLandmarkRatio,
  );
  setFiniteMetric(
    "calibrationQualityScore",
    reconstructionMetrics?.calibrationQualityScore,
  );
  setFiniteMetric("intrinsicsFallbackUsed", reconstructionMetrics?.intrinsicsFallbackUsed);
  setFiniteMetric("extrinsicsFallbackUsed", reconstructionMetrics?.extrinsicsFallbackUsed);
  setFiniteMetric("multiViewQualityGain", reconstructionMetrics?.multiViewQualityGain);
  const jointTrack = diagnostic.jointTrack;
  if (jointTrack) {
    setFiniteMetric("matchedFrameCount", jointTrack.metrics.matchedFrameCount);
    setFiniteMetric(
      "triangulatedLandmarkRatio",
      jointTrack.metrics.triangulatedJointRatio,
    );
    setFiniteMetric(
      "reprojectionErrorPx",
      jointTrack.metrics.averageReprojectionErrorPx,
    );
    setFiniteMetric("reprojectionP95Px", jointTrack.metrics.reprojectionP95Px);
    setFiniteMetric(
      "averageJointConfidence",
      jointTrack.metrics.averageJointConfidence,
    );
    setFiniteMetric(
      "lowConfidenceJointRatio",
      jointTrack.metrics.lowConfidenceJointRatio,
    );
    setFiniteMetric("occludedJointRatio", jointTrack.metrics.occludedJointRatio);
    setFiniteMetric("smoothedJointRatio", jointTrack.metrics.smoothedJointRatio);
    setFiniteMetric(
      "interpolatedJointRatio",
      jointTrack.metrics.interpolatedJointRatio,
    );
    setFiniteMetric("droppedJointRatio", jointTrack.metrics.droppedJointRatio);
    setFiniteMetric(
      "temporalJitterBefore",
      jointTrack.metrics.temporalJitterBefore,
    );
    setFiniteMetric("temporalJitterAfter", jointTrack.metrics.temporalJitterAfter);
    setFiniteMetric(
      "temporalSmoothingGain",
      jointTrack.metrics.temporalSmoothingGain,
    );
  }
  const dualFitReport = diagnostic.dualFitReport;
  if (dualFitReport) {
    setFiniteMetric(
      "fittingTotalLoss",
      finiteNumber(dualFitReport.losses.totalLoss),
    );
    setFiniteMetric(
      "initializationLoss",
      finiteNumber(dualFitReport.losses.initializationLoss),
    );
    setFiniteMetric(
      "triangulatedJointLoss",
      finiteNumber(dualFitReport.losses.triangulatedJointLoss),
    );
    setFiniteMetric(
      "reprojectionLoss",
      finiteNumber(dualFitReport.losses.reprojectionLoss),
    );
    setFiniteMetric(
      "reprojectionImprovementRatio",
      finiteNumber(dualFitReport.metrics.reprojectionImprovementRatio),
    );
    setFiniteMetric(
      "boneLengthConsistencyScore",
      finiteNumber(dualFitReport.metrics.boneLengthConsistencyScore),
    );
    setFiniteMetric(
      "jointLimitViolationCount",
      finiteNumber(dualFitReport.metrics.jointLimitViolationCount),
    );
    setFiniteMetric(
      "footContactStabilityScore",
      finiteNumber(dualFitReport.metrics.footContactStabilityScore),
    );
    setFiniteMetric(
      "optimizedBvhAvailable",
      dualFitReport.artifactRefs.optimized_bvh ? 1 : 0,
    );
    setFiniteMetric(
      "optimizedSolvedMotionAvailable",
      dualFitReport.artifactRefs.optimized_solved_motion_json ? 1 : 0,
    );
    setFiniteMetric(
      "reliableConstraintRatio",
      finiteNumber(dualFitReport.metrics.reliableConstraintRatio),
    );
    setFiniteMetric(
      "optimizedMotionDelta",
      finiteNumber(dualFitReport.metrics.optimizedMotionDelta),
    );
  }
  const poseExtraction = buildMultiViewPoseExtractionSummary(
    diagnostic.poseArtifacts,
  );
  setFiniteMetric(
    "averageKeypointConfidence",
    poseExtraction?.averageKeypointConfidence,
  );
  setFiniteMetric("missingPoseFrameRatio", poseExtraction?.missingPoseFrameRatio);

  const dualReconstruction = diagnostic.dualReconstruction;
  if (dualReconstruction) {
    setFiniteMetric("syncConfidence", dualReconstruction.syncConfidence);
    setFiniteMetric("matchedFrameCount", dualReconstruction.matchedFrameCount);
    setFiniteMetric(
      "reprojectionErrorPx",
      dualReconstruction.averageReprojectionErrorPx,
    );
    setFiniteMetric("reprojectionP95Px", dualReconstruction.reprojectionP95Px);
    setFiniteMetric(
      "triangulatedLandmarkRatio",
      dualReconstruction.triangulatedLandmarkRatio,
    );
    setFiniteMetric(
      "fallbackLandmarkRatio",
      dualReconstruction.fallbackLandmarkRatio,
    );
    setFiniteMetric(
      "calibrationQualityScore",
      dualReconstruction.calibrationQualityScore,
    );
  }

  const multiViewReconstruction = diagnostic.multiViewReconstruction;
  if (multiViewReconstruction) {
    setFiniteMetric(
      "syncConfidence",
      multiViewReconstruction.syncSummary.syncConfidence,
    );
    setFiniteMetric(
      "matchedFrameCount",
      multiViewReconstruction.syncSummary.matchedFrameCount,
    );
    setFiniteMetric(
      "reprojectionErrorPx",
      multiViewReconstruction.triangulationSummary.averageReprojectionErrorPx,
    );
    setFiniteMetric(
      "reprojectionP95Px",
      multiViewReconstruction.triangulationSummary.reprojectionP95Px,
    );
    setFiniteMetric(
      "triangulatedLandmarkRatio",
      multiViewReconstruction.triangulationSummary.triangulatedLandmarkRatio,
    );
    setFiniteMetric(
      "calibrationQualityScore",
      multiViewReconstruction.calibrationSummary.calibrationQualityScore,
    );
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function dualFitTopLevelFields(
  dualFitReport: DualFitReportArtifact,
): Pick<
  QualityReportMultiViewSection,
  | "dualFitStatus"
  | "dualFitAcceptedAsFinal"
  | "optimizedBvhAvailable"
  | "optimizedSolvedMotionAvailable"
  | "fittingTotalLoss"
  | "initializationLoss"
  | "triangulatedJointLoss"
  | "reprojectionLoss"
  | "reprojectionImprovementRatio"
  | "boneLengthConsistencyScore"
  | "jointLimitViolationCount"
  | "footContactStabilityScore"
> {
  return {
    dualFitStatus: dualFitReport.status,
    dualFitAcceptedAsFinal: dualFitReport.acceptedAsFinalAnimation,
    optimizedBvhAvailable: Boolean(dualFitReport.artifactRefs.optimized_bvh),
    optimizedSolvedMotionAvailable: Boolean(
      dualFitReport.artifactRefs.optimized_solved_motion_json,
    ),
    ...(finiteNumber(dualFitReport.losses.totalLoss) !== undefined
      ? { fittingTotalLoss: finiteNumber(dualFitReport.losses.totalLoss) }
      : {}),
    ...(finiteNumber(dualFitReport.losses.initializationLoss) !== undefined
      ? { initializationLoss: finiteNumber(dualFitReport.losses.initializationLoss) }
      : {}),
    ...(finiteNumber(dualFitReport.losses.triangulatedJointLoss) !== undefined
      ? {
          triangulatedJointLoss: finiteNumber(
            dualFitReport.losses.triangulatedJointLoss,
          ),
        }
      : {}),
    ...(finiteNumber(dualFitReport.losses.reprojectionLoss) !== undefined
      ? { reprojectionLoss: finiteNumber(dualFitReport.losses.reprojectionLoss) }
      : {}),
    ...(finiteNumber(dualFitReport.metrics.reprojectionImprovementRatio) !== undefined
      ? {
          reprojectionImprovementRatio: finiteNumber(
            dualFitReport.metrics.reprojectionImprovementRatio,
          ),
        }
      : {}),
    ...(finiteNumber(dualFitReport.metrics.boneLengthConsistencyScore) !== undefined
      ? {
          boneLengthConsistencyScore: finiteNumber(
            dualFitReport.metrics.boneLengthConsistencyScore,
          ),
        }
      : {}),
    ...(finiteNumber(dualFitReport.metrics.jointLimitViolationCount) !== undefined
      ? {
          jointLimitViolationCount: finiteNumber(
            dualFitReport.metrics.jointLimitViolationCount,
          ),
        }
      : {}),
    ...(finiteNumber(dualFitReport.metrics.footContactStabilityScore) !== undefined
      ? {
          footContactStabilityScore: finiteNumber(
            dualFitReport.metrics.footContactStabilityScore,
          ),
        }
      : {}),
  };
}

function jointTrackTopLevelFields(
  jointTrack: TriangulatedJointTrackArtifact,
): Pick<
  QualityReportMultiViewSection,
  | "jointTrackStatus"
  | "averageJointConfidence"
  | "occludedJointRatio"
  | "droppedJointRatio"
  | "temporalJitterBefore"
  | "temporalJitterAfter"
  | "temporalSmoothingGain"
> {
  return {
    jointTrackStatus: jointTrack.status,
    averageJointConfidence: jointTrack.metrics.averageJointConfidence,
    occludedJointRatio: jointTrack.metrics.occludedJointRatio,
    droppedJointRatio: jointTrack.metrics.droppedJointRatio,
    temporalJitterBefore: jointTrack.metrics.temporalJitterBefore,
    temporalJitterAfter: jointTrack.metrics.temporalJitterAfter,
    temporalSmoothingGain: jointTrack.metrics.temporalSmoothingGain,
  };
}

function observationFieldsFromCalibration(
  calibration: CameraCalibrationArtifact | undefined,
): Pick<
  QualityReportMultiViewSection,
  | "calibrationObservationStatus"
  | "calibrationTargetType"
  | "calibrationObservationCount"
  | "calibrationDetectorSource"
  | "calibrationObservationConfidence"
> {
  if (!calibration?.calibrationObservationStatus) return {};
  return {
    calibrationObservationStatus: calibration.calibrationObservationStatus,
    calibrationTargetType: calibration.calibrationTargetType,
    calibrationObservationCount: calibration.calibrationObservationCount,
    calibrationDetectorSource: calibration.calibrationDetectorSource,
    calibrationObservationConfidence: calibration.calibrationObservationConfidence,
  };
}

function buildCalibrationReadinessSummary(
  calibration: CameraCalibrationArtifact | undefined,
  captureVolume: CaptureVolumeArtifact | undefined,
  reconstruction: MultiViewReconstructionArtifact | undefined,
): Pick<
  QualityReportMultiViewSection,
  | "intrinsicsStatus"
  | "intrinsicsSource"
  | "intrinsicsConfidence"
  | "extrinsicsStatus"
  | "extrinsicsSource"
  | "extrinsicsConfidence"
  | "calibrationQualityScore"
  | "captureVolumeStatus"
  | "baselineEstimate"
  | "reprojectionErrorPx"
> {
  if (!calibration && !captureVolume && !reconstruction) return {};
  const intrinsics = calibration ? intrinsicsSummary(calibration) : undefined;
  const extrinsics = calibration ? extrinsicsSummary(calibration) : undefined;
  const baselineEstimate =
    finiteNumber(captureVolume?.baselineEstimate) ??
    finiteNumber(calibration?.baselineEstimate) ??
    finiteNumber(calibration?.quality.baseline);
  const reprojectionErrorPx =
    finiteNumber(reconstruction?.metrics.reprojectionErrorPx) ??
    finiteNumber(calibration?.quality.averageReprojectionErrorPx);
  return {
    ...(intrinsics
      ? {
          intrinsicsStatus: intrinsics.status,
          intrinsicsSource: intrinsics.source,
          intrinsicsConfidence: intrinsics.confidence,
        }
      : {}),
    ...(extrinsics
      ? {
          extrinsicsStatus: extrinsics.status,
          extrinsicsSource: extrinsics.source,
          extrinsicsConfidence: extrinsics.confidence,
        }
      : {}),
    ...(calibration?.quality.score !== undefined
      ? { calibrationQualityScore: calibration.quality.score }
      : {}),
    ...(captureVolume ? { captureVolumeStatus: captureVolume.status } : {}),
    ...(baselineEstimate !== undefined ? { baselineEstimate } : {}),
    ...(reprojectionErrorPx !== undefined ? { reprojectionErrorPx } : {}),
  };
}

function intrinsicsSummary(calibration: CameraCalibrationArtifact) {
  const hasFallback = calibration.devices.some(
    (device) => device.intrinsicsSource === "fov_fallback",
  );
  return {
    status: hasFallback ? "missing_intrinsics" : "ready",
    source: uniqueSource(
      calibration.devices.map((device) => device.intrinsicsSource),
    ),
    confidence: averageNumbers(
      calibration.devices.map((device) =>
        intrinsicsConfidence(device.intrinsicsSource),
      ),
    ),
  };
}

function extrinsicsSummary(calibration: CameraCalibrationArtifact) {
  const hasFallback = calibration.devices.some(
    (device) => device.extrinsicsSource === "role_angle_fallback",
  );
  return {
    status: hasFallback ? "missing_extrinsics" : "ready",
    source: uniqueSource(
      calibration.devices.map((device) => device.extrinsicsSource ?? "unavailable"),
    ),
    confidence: averageNumbers(
      calibration.devices.map((device) =>
        extrinsicsConfidence(device.extrinsicsSource),
      ),
    ),
  };
}

function intrinsicsConfidence(source: string | undefined) {
  if (source === "calibration_payload") return 0.95;
  if (source === "stored_profile") return 0.9;
  if (source === "capture_metadata") return 0.85;
  if (source === "fov_fallback") return 0.4;
  return 0;
}

function extrinsicsConfidence(source: string | undefined) {
  if (source === "calibration_payload") return 0.95;
  if (source === "stored_profile") return 0.9;
  if (source === "capture_metadata") return 0.8;
  if (source === "role_angle_fallback") return 0.35;
  return 0;
}

function uniqueSource(values: readonly string[]) {
  const unique = Array.from(new Set(values));
  return unique.length === 1 ? unique[0] : "mixed";
}

function averageNumbers(values: readonly number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function averageObservationConfidence(
  artifact: CalibrationObservationsArtifact,
) {
  const confidences = artifact.frames.flatMap((frame) =>
    frame.observations.map((observation) => observation.confidence),
  );
  return confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
}

function buildMultiViewPoseExtractionSummary(
  poseArtifacts: readonly PerCameraPoseArtifact[] | undefined,
): QualityReportMultiViewSection["poseExtraction"] | undefined {
  if (!poseArtifacts?.length) {
    return undefined;
  }
  const deviceStatuses = Object.fromEntries(
    poseArtifacts.map((artifact) => [
      `device_${artifact.deviceIndex}`,
      artifact.status ?? "unavailable",
    ]),
  );
  const detectedArtifacts = poseArtifacts.filter(
    (artifact) => artifact.quality.detectedFrameCount > 0,
  );
  const averageKeypointConfidence =
    detectedArtifacts.length > 0
      ? detectedArtifacts.reduce(
          (sum, artifact) =>
            sum + (artifact.averageConfidence ?? artifact.quality.averagePoseConfidence),
          0,
        ) / detectedArtifacts.length
      : undefined;
  const totalFrameCount = poseArtifacts.reduce(
    (sum, artifact) => sum + artifact.quality.frameCount,
    0,
  );
  const totalMissingFrameCount = poseArtifacts.reduce(
    (sum, artifact) => sum + artifact.quality.missingFrameCount,
    0,
  );
  const missingPoseFrameRatio =
    totalFrameCount > 0 ? totalMissingFrameCount / totalFrameCount : undefined;
  const status = resolvePoseExtractionStatus(poseArtifacts);
  const detectorSource =
    poseArtifacts.find((artifact) => artifact.detectorSource)?.detectorSource ??
    poseArtifacts[0]?.detector.name;
  const warnings = Array.from(
    new Set(
      poseArtifacts.flatMap((artifact) => [
        ...artifact.warnings,
        ...(artifact.reason ? [artifact.reason] : []),
      ]),
    ),
  );

  return {
    detectorSource,
    poseDetectorSource: detectorSource,
    status,
    poseExtractionStatus: status,
    poseFramesDevice0Status: deviceStatuses.device_0,
    poseFramesDevice1Status: deviceStatuses.device_1,
    deviceStatuses,
    ...(averageKeypointConfidence !== undefined
      ? { averageKeypointConfidence }
      : {}),
    ...(missingPoseFrameRatio !== undefined ? { missingPoseFrameRatio } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

function resolvePoseExtractionStatus(
  poseArtifacts: readonly PerCameraPoseArtifact[],
) {
  if (
    poseArtifacts.some(
      (artifact) =>
        artifact.status === "missing_pose_frames" ||
        artifact.quality.detectedFrameCount === 0,
    )
  ) {
    return "missing_pose_frames";
  }
  if (poseArtifacts.some((artifact) => artifact.status === "failed")) {
    return "failed";
  }
  if (poseArtifacts.some((artifact) => artifact.status === "low_confidence")) {
    return "low_confidence";
  }
  return "ready";
}

function maxAbsoluteSyncOffsetMs(
  syncReport: MultiViewSyncReport | undefined,
): number | undefined {
  if (!syncReport) {
    return undefined;
  }
  return syncReport.devices.reduce(
    (max, device) => Math.max(max, Math.abs(device.offsetMs)),
    0,
  );
}

function buildMultiViewReportWarnings(input: {
  whamInputUsage?: WhamInputUsageMetrics;
  multiViewDiagnostic?: QualityReportMultiViewDiagnosticInput;
  finalAnimationSource?: QualityReportFinalAnimationSource;
  reconstructionStatus?: QualityReportMultiViewReconstructionStatus;
  primaryCameraFallbackUsed?: boolean;
}) {
  const warnings: string[] = [];
  warnings.push(...(input.multiViewDiagnostic?.warnings ?? []));
  warnings.push(
    ...(input.multiViewDiagnostic?.captureMetadataDiagnostics
      ?.missingMetadataWarnings ?? []),
  );
  warnings.push(...(input.multiViewDiagnostic?.syncReport?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.calibrationObservations?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.cameraCalibration?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.captureVolume?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.reconstruction?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.jointTrack?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.dualFitReport?.warnings ?? []));
  warnings.push(...(input.multiViewDiagnostic?.dualReconstruction?.warnings ?? []));
  warnings.push(
    ...(input.multiViewDiagnostic?.multiViewReconstruction?.qualitySummary.warnings ?? []),
  );
  if (input.multiViewDiagnostic?.errorCode) {
    warnings.push(input.multiViewDiagnostic.errorCode);
  }
  if (
    input.primaryCameraFallbackUsed ||
    input.finalAnimationSource === "primary_wham"
  ) {
    warnings.push("single_camera_solver_fallback_used");
  }
  if (
    input.reconstructionStatus &&
    input.reconstructionStatus !== "ready" &&
    input.reconstructionStatus !== "unavailable"
  ) {
    warnings.push(input.reconstructionStatus);
  }
  const fallbackReason = input.whamInputUsage?.primaryWhamFallbackReason;
  if (fallbackReason && fallbackReason !== "none") {
    warnings.push(fallbackReason);
  }
  return Array.from(new Set(warnings));
}

export function buildQualityReport(
  pose: PoseFramesArtifact,
  solved: SolvedMotionArtifact,
  cleanup: CleanupReport,
  validation: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    blenderOk: boolean;
    blenderSkipped: boolean;
  },
  inputSource: "single_camera" | "dual_camera" | "multi_view" = "single_camera",
  multiViewInput: BuildQualityReportMultiViewSectionInput = {},
): QualityReport {
  const detectedRatio =
    pose.quality.frameCount > 0
      ? pose.quality.detectedFrameCount / pose.quality.frameCount
      : 0;
  const solvedRatio =
    pose.quality.frameCount > 0 ? solved.frameCount / pose.quality.frameCount : 0;
  const singleCameraScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        pose.quality.averagePoseConfidence * 24 +
          detectedRatio * 18 +
          solvedRatio * 14 +
          cleanup.metrics.jitterScore * 13 +
          cleanup.metrics.footSlidingScore * 11 +
          cleanup.metrics.boneLengthConsistency * 12 +
          cleanup.metrics.rootStability * 8,
      ),
    ),
  );
  const score = singleCameraScore;
  const grade =
    validation.errors.length > 0
      ? "failed"
      : score >= 88
        ? "excellent"
        : score >= 74
          ? "good"
          : score >= 58
            ? "usable"
            : "poor";
  const summary =
    grade === "excellent"
      ? "Clean solve. Export is ready for DCC review."
      : grade === "good"
        ? "Usable solve with minor cleanup warnings."
        : grade === "usable"
          ? "Export is usable, but review foot contact and jitter before final delivery."
          : grade === "poor"
            ? "Input quality is low. Re-capture is recommended for production delivery."
            : "Export validation failed. Reprocess or re-capture before delivery.";

  const multiView = buildQualityReportMultiViewSection(multiViewInput);
  const multiViewMetricMirrors = buildMultiViewMetricMirrors(multiView);
  return {
    schema: "mocap.quality_report.v1",
    takeId: pose.takeId,
    jobId: pose.jobId,
    score,
    grade,
    summary,
    metrics: {
      ...cleanup.metrics,
      detectedFrameCount: pose.quality.detectedFrameCount,
      detectedRatio,
      lowConfidenceFrameCount: pose.quality.lowConfidenceFrameCount,
      averagePoseConfidence: pose.quality.averagePoseConfidence,
      solvedRatio,
      ikAppliedConstraintCount: solved.ik?.appliedConstraintCount ?? 0,
      ikAdjustedJointRotationCount: solved.ik?.adjustedJointRotationCount ?? 0,
      retargetPresetEnabled: solved.preset ? 1 : 0,
      ...multiViewMetricMirrors,
    },
    warnings: [
      ...validation.warnings,
      ...cleanup.warnings,
      ...(solved.ik?.warnings ?? []),
    ],
    errors: validation.errors,
    actions: cleanup.actions,
    validation: {
      exportOk: validation.ok,
      blenderOk: validation.blenderOk,
      blenderSkipped: validation.blenderSkipped,
    },
    inputSource: {
      source: inputSource,
    },
    ...(multiView ? { multiView } : {}),
  };
}

function buildMultiViewMetricMirrors(
  multiView: QualityReportMultiViewSection | undefined,
): Record<string, number> {
  if (!multiView?.metrics) return {};
  const mirrors: Record<string, number> = {};
  const metricMap: Array<
    readonly [
      keyof NonNullable<QualityReportMultiViewSection["metrics"]>,
      string,
    ]
  > = [
    ["matchedFrameCount", "multiViewMatchedFrameCount"],
    ["averageTimeDeltaMs", "multiViewAverageTimeDeltaMs"],
    ["p95TimeDeltaMs", "multiViewP95TimeDeltaMs"],
    ["syncConfidence", "multiViewSyncConfidence"],
    ["reprojectionErrorPx", "multiViewReprojectionErrorPx"],
    ["reprojectionP95Px", "multiViewReprojectionP95Px"],
    ["triangulatedLandmarkRatio", "multiViewTriangulatedLandmarkRatio"],
    ["fallbackLandmarkRatio", "multiViewFallbackLandmarkRatio"],
    ["calibrationQualityScore", "multiViewCalibrationQualityScore"],
    ["baselineEstimate", "multiViewBaselineEstimate"],
    ["intrinsicsFallbackUsed", "multiViewIntrinsicsFallbackUsed"],
    ["extrinsicsFallbackUsed", "multiViewExtrinsicsFallbackUsed"],
    ["calibrationObservationCount", "multiViewCalibrationObservationCount"],
    [
      "calibrationObservationConfidence",
      "multiViewCalibrationObservationConfidence",
    ],
    ["averageKeypointConfidence", "multiViewAverageKeypointConfidence"],
    ["missingPoseFrameRatio", "multiViewMissingPoseFrameRatio"],
    ["averageJointConfidence", "multiViewAverageJointConfidence"],
    ["lowConfidenceJointRatio", "multiViewLowConfidenceJointRatio"],
    ["occludedJointRatio", "multiViewOccludedJointRatio"],
    ["smoothedJointRatio", "multiViewSmoothedJointRatio"],
    ["interpolatedJointRatio", "multiViewInterpolatedJointRatio"],
    ["droppedJointRatio", "multiViewDroppedJointRatio"],
    ["temporalJitterBefore", "multiViewTemporalJitterBefore"],
    ["temporalJitterAfter", "multiViewTemporalJitterAfter"],
    ["temporalSmoothingGain", "multiViewTemporalSmoothingGain"],
    ["fittingTotalLoss", "multiViewFittingTotalLoss"],
    ["initializationLoss", "multiViewInitializationLoss"],
    ["triangulatedJointLoss", "multiViewTriangulatedJointLoss"],
    ["reprojectionLoss", "multiViewReprojectionLoss"],
    ["reprojectionImprovementRatio", "multiViewReprojectionImprovementRatio"],
    ["boneLengthConsistencyScore", "multiViewBoneLengthConsistencyScore"],
    ["jointLimitViolationCount", "multiViewJointLimitViolationCount"],
    ["footContactStabilityScore", "multiViewFootContactStabilityScore"],
    ["optimizedBvhAvailable", "multiViewOptimizedBvhAvailable"],
    [
      "optimizedSolvedMotionAvailable",
      "multiViewOptimizedSolvedMotionAvailable",
    ],
    ["reliableConstraintRatio", "multiViewReliableConstraintRatio"],
    ["optimizedMotionDelta", "multiViewOptimizedMotionDelta"],
    ["multiViewQualityGain", "multiViewQualityGain"],
  ];
  for (const [sourceKey, outputKey] of metricMap) {
    const value = multiView.metrics[sourceKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      mirrors[outputKey] = value;
    }
  }
  return mirrors;
}

export function buildPreviewSummary(
  solved: SolvedMotionArtifact,
  quality: QualityReport,
  cleanup: CleanupReport,
): PreviewSummary {
  const roots = solved.frames.map((frame) => frame.rootTranslation);
  const min = roots.reduce(
    (acc, root) => [
      Math.min(acc[0], root[0]),
      Math.min(acc[1], root[1]),
      Math.min(acc[2], root[2]),
    ] as [number, number, number],
    [Infinity, Infinity, Infinity],
  );
  const max = roots.reduce(
    (acc, root) => [
      Math.max(acc[0], root[0]),
      Math.max(acc[1], root[1]),
      Math.max(acc[2], root[2]),
    ] as [number, number, number],
    [-Infinity, -Infinity, -Infinity],
  );
  const rootTravel = roots.slice(1).reduce((acc, root, index) => {
    const previous = roots[index];
    return acc + Math.hypot(root[0] - previous[0], root[2] - previous[2]);
  }, 0);

  return {
    schema: "mocap.preview_summary.v1",
    takeId: solved.takeId,
    jobId: solved.jobId,
    fps: solved.fps,
    durationMs: solved.durationMs,
    frameCount: solved.frameCount,
    qualityScore: quality.score,
    rootTravel,
    rootBounds: {
      min: min.map((value) => (Number.isFinite(value) ? value : 0)) as [
        number,
        number,
        number,
      ],
      max: max.map((value) => (Number.isFinite(value) ? value : 0)) as [
        number,
        number,
        number,
      ],
    },
    contactFrames: cleanup.metrics.footContactFrameCount,
    warnings: quality.warnings.slice(0, 8),
  };
}
