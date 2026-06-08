import type {
  CameraCalibrationArtifact,
  CaptureVolumeArtifact,
  DualFitReportArtifact,
  DualFitQualityGateSummary,
  MotionPipelineStageName,
  MotionPipelineStageResultStatus,
  MotionPipelineStageStatus,
  CalibrationObservationsArtifact,
  MultiViewSyncReport,
  TriangulatedJointTrackArtifact,
  QualityReportFinalAnimationSource,
} from "../types";
import type { PersistedMultiViewArtifact } from "../reconstruction/multiViewArtifacts";
import { buildDualFitAcceptanceSummary } from "../fitting/fittingQuality";

const RECONSTRUCTION_STAGE_NAMES: readonly MotionPipelineStageName[] = [
  "per_camera_pose_extraction",
  "frame_sync",
  "calibration_target_detection",
  "camera_intrinsics",
  "camera_extrinsics",
  "capture_volume",
  "camera_calibration",
  "dual_triangulation",
  "triangulated_joint_tracking",
  "dual_camera_fitting",
  "dual_reconstruction_artifacts",
];

const STAGE_ORDER: Record<MotionPipelineStageName, number> = {
  video_normalization: 0,
  primary_wham: 1,
  per_camera_pose_extraction: 2,
  frame_sync: 3,
  calibration_target_detection: 4,
  camera_intrinsics: 5,
  camera_extrinsics: 6,
  capture_volume: 7,
  camera_calibration: 8,
  dual_triangulation: 9,
  triangulated_joint_tracking: 10,
  dual_camera_fitting: 11,
  dual_reconstruction_artifacts: 12,
  quality_report: 13,
  final_animation_export: 14,
};

const FAILURE_STAGE_BY_ERROR_CODE: Record<string, MotionPipelineStageName> = {
  multi_view_pose_extraction_failed: "per_camera_pose_extraction",
  multi_view_sync_failed: "frame_sync",
  camera_calibration_failed: "camera_calibration",
  camera_projection_invalid: "camera_calibration",
  metadata_intrinsics_required: "camera_intrinsics",
  triangulation_failed: "dual_triangulation",
  triangulation_coverage_low: "dual_triangulation",
  reprojection_error_high: "dual_triangulation",
  multi_view_reconstruction_invalid: "dual_triangulation",
  multi_view_artifact_persistence_failed: "dual_reconstruction_artifacts",
};

export type BuildMotionPipelineStageInput = {
  stageName: MotionPipelineStageName;
  status: MotionPipelineStageResultStatus;
  reason: string;
  startedAtMs?: number;
  completedAtMs?: number;
  artifactRefs?: Record<string, string>;
  warnings?: readonly string[];
  syncMethod?: MultiViewSyncReport["syncMethod"];
  averageTimeDeltaMs?: number;
  p95TimeDeltaMs?: number;
  syncConfidence?: number;
  matchedFrameCount?: number;
  jointTrackStatus?: TriangulatedJointTrackArtifact["status"];
  dualFitStatus?: DualFitReportArtifact["status"];
  acceptedAsFinalAnimation?: boolean;
  finalAnimationSource?: QualityReportFinalAnimationSource;
  qualityGateSummary?: DualFitQualityGateSummary;
  triangulatedJointRatio?: number;
  averageReprojectionErrorPx?: number;
  temporalJitterAfter?: number;
  artifactRef?: string;
  targetType?: CalibrationObservationsArtifact["targetType"];
  detectorSource?: string;
  observationCount?: number;
  averageConfidence?: number;
  calibrationObservationStatus?: CalibrationObservationsArtifact["status"];
  captureVolumeStatus?: CaptureVolumeArtifact["status"];
  intrinsicsStatus?: MotionPipelineStageStatus["intrinsicsStatus"];
  intrinsicsSource?: string;
  intrinsicsConfidence?: number;
  extrinsicsStatus?: MotionPipelineStageStatus["extrinsicsStatus"];
  extrinsicsSource?: string;
  extrinsicsConfidence?: number;
  calibrationQualityScore?: number;
  baselineEstimate?: number;
  confidence?: number;
  qualityScore?: number;
};

export type BuildReconstructionDiagnosticStagesInput = {
  source: "single_camera" | "dual_camera" | "multi_view";
  branchKind: string;
  reconstructionAvailable: boolean;
  reconstructionStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  artifactRefs?: Record<string, string>;
  syncReport?: MultiViewSyncReport;
  calibrationObservations?: CalibrationObservationsArtifact;
  cameraCalibration?: CameraCalibrationArtifact;
  captureVolume?: CaptureVolumeArtifact;
  triangulatedJointTrack?: TriangulatedJointTrackArtifact;
  dualFitReport?: DualFitReportArtifact;
  warnings?: readonly string[];
  startedAtMs?: number;
  completedAtMs?: number;
};

export function buildMotionPipelineStage(
  input: BuildMotionPipelineStageInput,
): MotionPipelineStageStatus {
  const durationMs =
    input.startedAtMs !== undefined && input.completedAtMs !== undefined
      ? Math.max(0, input.completedAtMs - input.startedAtMs)
      : undefined;
  return {
    stageName: input.stageName,
    status: input.status,
    reason: input.reason,
    ...(input.startedAtMs !== undefined
      ? { startedAt: new Date(input.startedAtMs).toISOString() }
      : {}),
    ...(input.completedAtMs !== undefined
      ? { completedAt: new Date(input.completedAtMs).toISOString() }
      : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    artifactRefs: input.artifactRefs ?? {},
    ...(input.syncMethod ? { syncMethod: input.syncMethod } : {}),
    ...(input.averageTimeDeltaMs !== undefined
      ? { averageTimeDeltaMs: input.averageTimeDeltaMs }
      : {}),
    ...(input.p95TimeDeltaMs !== undefined ? { p95TimeDeltaMs: input.p95TimeDeltaMs } : {}),
    ...(input.syncConfidence !== undefined ? { syncConfidence: input.syncConfidence } : {}),
    ...(input.matchedFrameCount !== undefined
      ? { matchedFrameCount: input.matchedFrameCount }
      : {}),
    ...(input.jointTrackStatus ? { jointTrackStatus: input.jointTrackStatus } : {}),
    ...(input.dualFitStatus ? { dualFitStatus: input.dualFitStatus } : {}),
    ...(input.acceptedAsFinalAnimation !== undefined
      ? { acceptedAsFinalAnimation: input.acceptedAsFinalAnimation }
      : {}),
    ...(input.finalAnimationSource
      ? { finalAnimationSource: input.finalAnimationSource }
      : {}),
    ...(input.qualityGateSummary
      ? { qualityGateSummary: input.qualityGateSummary }
      : {}),
    ...(input.triangulatedJointRatio !== undefined
      ? { triangulatedJointRatio: input.triangulatedJointRatio }
      : {}),
    ...(input.averageReprojectionErrorPx !== undefined
      ? { averageReprojectionErrorPx: input.averageReprojectionErrorPx }
      : {}),
    ...(input.temporalJitterAfter !== undefined
      ? { temporalJitterAfter: input.temporalJitterAfter }
      : {}),
    ...(input.artifactRef ? { artifactRef: input.artifactRef } : {}),
    ...(input.targetType ? { targetType: input.targetType } : {}),
    ...(input.detectorSource ? { detectorSource: input.detectorSource } : {}),
    ...(input.observationCount !== undefined
      ? { observationCount: input.observationCount }
      : {}),
    ...(input.averageConfidence !== undefined
      ? { averageConfidence: input.averageConfidence }
      : {}),
    ...(input.calibrationObservationStatus
      ? { calibrationObservationStatus: input.calibrationObservationStatus }
      : {}),
    ...(input.captureVolumeStatus
      ? { captureVolumeStatus: input.captureVolumeStatus }
      : {}),
    ...(input.intrinsicsStatus ? { intrinsicsStatus: input.intrinsicsStatus } : {}),
    ...(input.intrinsicsSource ? { intrinsicsSource: input.intrinsicsSource } : {}),
    ...(input.intrinsicsConfidence !== undefined
      ? { intrinsicsConfidence: input.intrinsicsConfidence }
      : {}),
    ...(input.extrinsicsStatus ? { extrinsicsStatus: input.extrinsicsStatus } : {}),
    ...(input.extrinsicsSource ? { extrinsicsSource: input.extrinsicsSource } : {}),
    ...(input.extrinsicsConfidence !== undefined
      ? { extrinsicsConfidence: input.extrinsicsConfidence }
      : {}),
    ...(input.calibrationQualityScore !== undefined
      ? { calibrationQualityScore: input.calibrationQualityScore }
      : {}),
    ...(input.baselineEstimate !== undefined
      ? { baselineEstimate: input.baselineEstimate }
      : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.qualityScore !== undefined ? { qualityScore: input.qualityScore } : {}),
    warnings: Array.from(new Set(input.warnings ?? [])),
  };
}

export function sortMotionPipelineStages(
  stages: readonly MotionPipelineStageStatus[],
): MotionPipelineStageStatus[] {
  return [...stages].sort(
    (left, right) => STAGE_ORDER[left.stageName] - STAGE_ORDER[right.stageName],
  );
}

export function artifactRefsFromPersistedMultiViewArtifacts(
  artifacts: readonly PersistedMultiViewArtifact[],
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const artifact of artifacts) {
    refs[artifact.artifactName || artifact.format] = artifact.storageKey;
  }
  return refs;
}

export function buildReconstructionDiagnosticStages(
  input: BuildReconstructionDiagnosticStagesInput,
): MotionPipelineStageStatus[] {
  if (input.source === "single_camera") return [];

  if (input.branchKind !== "multi_view_reconstruction") {
    return RECONSTRUCTION_STAGE_NAMES.map((stageName) =>
      buildMotionPipelineStage({
        stageName,
        status: "skipped",
        reason:
          input.branchKind === "primary_wham_fallback"
            ? "Multi-view reconstruction is disabled; primary WHAM fallback continues."
            : "Multi-view reconstruction branch was not selected.",
        warnings: input.warnings,
      }),
    );
  }

  if (input.reconstructionAvailable) {
    const triangulationDiagnostic =
      input.reconstructionStatus &&
      input.reconstructionStatus !== "ready" &&
      input.reconstructionStatus !== "completed";
    const frameSyncArtifactRefs = pickRefs(input.artifactRefs, /^multi_view_sync_json$/);
    const frameSyncArtifactRef = frameSyncArtifactRefs.multi_view_sync_json;
    const calibrationObservationArtifactRefs = pickRefs(
      input.artifactRefs,
      /^calibration_observations_json$/,
    );
    const calibrationObservationArtifactRef =
      calibrationObservationArtifactRefs.calibration_observations_json;
    const calibrationObservationCount = input.calibrationObservations
      ? input.calibrationObservations.frames.reduce(
          (sum, frame) => sum + frame.observations.length,
          0,
        )
      : undefined;
    const calibrationObservationConfidence = input.calibrationObservations
      ? averageObservationConfidence(input.calibrationObservations)
      : undefined;
    const frameSyncStatus: MotionPipelineStageResultStatus =
      syncStageStatus(input.syncReport);
    const intrinsics = cameraIntrinsicsSummary(input.cameraCalibration);
    const extrinsics = cameraExtrinsicsSummary(input.cameraCalibration);
    const calibrationStatus = calibrationStageStatus(input.cameraCalibration);
    const captureVolumeArtifactRefs = pickRefs(
      input.artifactRefs,
      /^capture_volume_json$/,
    );
    const captureVolumeArtifactRef = captureVolumeArtifactRefs.capture_volume_json;
    const jointTrackArtifactRefs = pickRefs(
      input.artifactRefs,
      /^triangulated_joint_track_json$/,
    );
    const jointTrackArtifactRef =
      jointTrackArtifactRefs.triangulated_joint_track_json;
    const dualFitArtifactRefs = {
      ...pickRefs(
        input.artifactRefs,
        /^(dual_fit_report_json|optimized_solved_motion_json|optimized_smpl_parameters_json|optimized_bvh)$/,
      ),
      ...pickRefs(
        input.dualFitReport?.artifactRefs,
        /^(dual_fit_report_json|optimized_solved_motion_json|optimized_smpl_parameters_json|optimized_bvh)$/,
      ),
    };
    const dualFitArtifactRef = dualFitArtifactRefs.dual_fit_report_json;
    const acceptedDualFitFinal = Boolean(
      input.dualFitReport?.acceptedAsFinalAnimation &&
      input.dualFitReport.finalAnimationSourceCandidate === "true_dual_solve" &&
      Boolean(dualFitArtifactRefs.optimized_solved_motion_json) &&
      Boolean(dualFitArtifactRefs.optimized_bvh),
    );
    const finalAnimationSource: QualityReportFinalAnimationSource =
      acceptedDualFitFinal ? "true_dual_solve" : "primary_wham";
    return [
      buildMotionPipelineStage({
        stageName: "per_camera_pose_extraction",
        status: "ready",
        reason: "Per-camera pose artifacts were produced for reconstruction diagnostics.",
        artifactRefs: pickRefs(input.artifactRefs, /^pose_frames_device_\d+_json$/),
        warnings: input.warnings,
        startedAtMs: input.startedAtMs,
      }),
      buildMotionPipelineStage({
        stageName: "frame_sync",
        status: frameSyncStatus,
        reason: input.syncReport
          ? `Multi-view frame synchronization report was produced with status ${input.syncReport.status}.`
          : "Multi-view frame synchronization report was produced.",
        artifactRefs: frameSyncArtifactRefs,
        artifactRef: frameSyncArtifactRef,
        syncMethod: input.syncReport?.syncMethod,
        averageTimeDeltaMs: input.syncReport?.metrics.averageTimeDeltaMs,
        p95TimeDeltaMs: input.syncReport?.metrics.p95TimeDeltaMs,
        syncConfidence: input.syncReport?.metrics.syncConfidence,
        matchedFrameCount: input.syncReport?.metrics.matchedFrameCount,
        warnings: input.warnings,
      }),
      buildMotionPipelineStage({
        stageName: "calibration_target_detection",
        status: input.calibrationObservations
          ? calibrationObservationStageStatus(input.calibrationObservations.status)
          : "skipped",
        reason: input.calibrationObservations
          ? `Calibration target detection reported ${input.calibrationObservations.status}.`
          : "Calibration target detector did not run for this diagnostic reconstruction.",
        artifactRefs: calibrationObservationArtifactRefs,
        artifactRef: calibrationObservationArtifactRef,
        targetType: input.calibrationObservations?.targetType,
        detectorSource: input.calibrationObservations?.detectorSource,
        observationCount: calibrationObservationCount,
        averageConfidence: calibrationObservationConfidence,
        calibrationObservationStatus: input.calibrationObservations?.status,
        warnings: [
          ...(input.warnings ?? []),
          ...(input.calibrationObservations?.warnings ?? []),
        ],
      }),
      buildMotionPipelineStage({
        stageName: "camera_intrinsics",
        status: intrinsics.status,
        reason: `Camera intrinsics readiness is ${intrinsics.status}.`,
        artifactRefs: pickRefs(input.artifactRefs, /^camera_calibration_json$/),
        artifactRef: input.artifactRefs?.camera_calibration_json,
        intrinsicsStatus: intrinsics.status,
        intrinsicsSource: intrinsics.source,
        intrinsicsConfidence: intrinsics.confidence,
        confidence: intrinsics.confidence,
        warnings: input.warnings,
      }),
      buildMotionPipelineStage({
        stageName: "camera_extrinsics",
        status: extrinsics.status,
        reason: `Camera extrinsics readiness is ${extrinsics.status}.`,
        artifactRefs: pickRefs(input.artifactRefs, /^camera_calibration_json$/),
        artifactRef: input.artifactRefs?.camera_calibration_json,
        extrinsicsStatus: extrinsics.status,
        extrinsicsSource: extrinsics.source,
        extrinsicsConfidence: extrinsics.confidence,
        confidence: extrinsics.confidence,
        warnings: input.warnings,
      }),
      buildMotionPipelineStage({
        stageName: "capture_volume",
        status: input.captureVolume
          ? captureVolumeStageStatus(input.captureVolume.status)
          : "skipped",
        reason: input.captureVolume
          ? `Capture volume artifact was produced with status ${input.captureVolume.status}.`
          : "Capture volume artifact was not produced for this diagnostic reconstruction.",
        artifactRefs: captureVolumeArtifactRefs,
        artifactRef: captureVolumeArtifactRef,
        captureVolumeStatus: input.captureVolume?.status,
        baselineEstimate:
          input.captureVolume?.baselineEstimate === null
            ? undefined
            : input.captureVolume?.baselineEstimate,
        warnings: [
          ...(input.warnings ?? []),
          ...(input.captureVolume?.warnings ?? []),
        ],
      }),
      buildMotionPipelineStage({
        stageName: "camera_calibration",
        status: calibrationStatus,
        reason: input.cameraCalibration
          ? `Camera calibration artifact was produced with status ${input.cameraCalibration.status ?? "ready"}.`
          : "Camera calibration artifact was produced for reconstruction diagnostics.",
        artifactRefs: pickRefs(input.artifactRefs, /^camera_calibration_json$/),
        artifactRef: input.artifactRefs?.camera_calibration_json,
        calibrationQualityScore: input.cameraCalibration?.quality.score,
        baselineEstimate: input.cameraCalibration?.baselineEstimate,
        qualityScore: input.cameraCalibration?.quality.score,
        warnings: input.warnings,
      }),
      buildMotionPipelineStage({
        stageName: "dual_triangulation",
        status: triangulationDiagnostic
          ? reconstructionStatusToStageStatus(input.reconstructionStatus)
          : "ready",
        reason: triangulationDiagnostic
          ? `Triangulation completed with diagnostic status ${input.reconstructionStatus}.`
          : "DLT triangulation diagnostics completed.",
        artifactRefs: pickRefs(input.artifactRefs, /^dual_reconstruction_json$/),
        warnings: input.warnings,
      }),
      buildMotionPipelineStage({
        stageName: "triangulated_joint_tracking",
        status: input.triangulatedJointTrack
          ? reconstructionStatusToStageStatus(input.triangulatedJointTrack.status)
          : "skipped",
        reason: input.triangulatedJointTrack
          ? `Triangulated 3D joint track artifact was produced with status ${input.triangulatedJointTrack.status}.`
          : "Triangulated 3D joint track artifact was not produced.",
        artifactRefs: jointTrackArtifactRefs,
        artifactRef: jointTrackArtifactRef,
        jointTrackStatus: input.triangulatedJointTrack?.status,
        triangulatedJointRatio:
          input.triangulatedJointTrack?.metrics.triangulatedJointRatio,
        averageReprojectionErrorPx:
          input.triangulatedJointTrack?.metrics.averageReprojectionErrorPx,
        temporalJitterAfter:
          input.triangulatedJointTrack?.metrics.temporalJitterAfter,
        warnings: [
          ...(input.warnings ?? []),
          ...(input.triangulatedJointTrack?.warnings ?? []),
        ],
      }),
      buildMotionPipelineStage({
        stageName: "dual_camera_fitting",
        status: input.dualFitReport
          ? dualFitStageStatus(input.dualFitReport.status, acceptedDualFitFinal)
          : "skipped",
        reason: input.dualFitReport
          ? acceptedDualFitFinal
            ? `Dual-camera fitting produced an accepted optimized output with status ${input.dualFitReport.status}.`
            : `Dual-camera fitting produced a report with status ${input.dualFitReport.status}; primary WHAM remains final.`
          : "Dual-camera fitting foundation did not run for this diagnostic reconstruction.",
        artifactRefs: dualFitArtifactRefs,
        artifactRef: dualFitArtifactRef,
        dualFitStatus: input.dualFitReport?.status,
        acceptedAsFinalAnimation: acceptedDualFitFinal,
        finalAnimationSource,
        qualityGateSummary: input.dualFitReport
          ? qualityGateSummary(input.dualFitReport, acceptedDualFitFinal)
          : undefined,
        warnings: [
          ...(input.warnings ?? []),
          ...(input.dualFitReport?.warnings ?? []),
        ],
      }),
      buildMotionPipelineStage({
        stageName: "dual_reconstruction_artifacts",
        status: input.errorCode === "multi_view_artifact_persistence_failed"
          ? "failed"
          : "ready",
        reason:
          input.errorCode === "multi_view_artifact_persistence_failed"
            ? input.errorMessage ?? "Multi-view artifact persistence failed."
            : "Diagnostic reconstruction artifacts were persisted.",
        artifactRefs: pickRefs(
          input.artifactRefs,
          /^(dual_reconstruction_json|multi_view_reconstruction_json|triangulated_joint_track_json|dual_fit_report_json|optimized_solved_motion_json|optimized_smpl_parameters_json|optimized_bvh|pose_frames_json)$/,
        ),
        warnings: input.warnings,
        completedAtMs: input.completedAtMs,
      }),
    ];
  }

  const failureStage =
    FAILURE_STAGE_BY_ERROR_CODE[input.errorCode ?? ""] ??
    "dual_triangulation";
  const failureIndex = RECONSTRUCTION_STAGE_NAMES.indexOf(failureStage);

  return RECONSTRUCTION_STAGE_NAMES.map((stageName, index) => {
    const status: MotionPipelineStageResultStatus =
      index < failureIndex
        ? "ready"
        : index === failureIndex
          ? failureStatus(input.errorCode)
          : "skipped";
    return buildMotionPipelineStage({
      stageName,
      status,
      reason:
        status === "failed"
          ? input.errorMessage ??
            `${stageName} failed; primary WHAM fallback continues.`
          : status === "skipped"
            ? "Skipped after diagnostic reconstruction failure; primary WHAM fallback continues."
            : "Completed before diagnostic reconstruction failure.",
      artifactRefs:
        stageName === "per_camera_pose_extraction"
          ? pickRefs(input.artifactRefs, /^pose_frames_device_\d+_json$/)
          : {},
      warnings: [
        ...(input.warnings ?? []),
        ...(input.errorCode ? [input.errorCode] : []),
      ],
      ...(index === 0 ? { startedAtMs: input.startedAtMs } : {}),
      ...(index === failureIndex ? { completedAtMs: input.completedAtMs } : {}),
    });
  });
}

function averageObservationConfidence(artifact: CalibrationObservationsArtifact) {
  const confidences = artifact.frames.flatMap((frame) =>
    frame.observations.map((observation) => observation.confidence),
  );
  return confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
}

function syncStageStatus(
  syncReport: MultiViewSyncReport | undefined,
): MotionPipelineStageResultStatus {
  if (!syncReport) return "ready";
  if (syncReport.status === "ready") return "ready";
  if (syncReport.status === "approximate") return "approximate";
  if (syncReport.status === "missing_timestamps") return "missing_timestamps";
  if (syncReport.status === "insufficient_frames") return "insufficient_views";
  if (syncReport.status === "failed") return "failed";
  return "diagnostic_only";
}

function calibrationObservationStageStatus(
  status: CalibrationObservationsArtifact["status"],
): MotionPipelineStageResultStatus {
  if (status === "ready") return "ready";
  if (status === "disabled") return "skipped";
  if (
    status === "missing_runtime" ||
    status === "missing_dependency" ||
    status === "missing_calibration_observations"
  ) {
    return "missing_calibration_observations";
  }
  if (status === "failed") return "failed";
  return "diagnostic_only";
}

function captureVolumeStageStatus(
  status: CaptureVolumeArtifact["status"],
): MotionPipelineStageResultStatus {
  if (status === "ready") return "ready";
  if (status === "approximate") return "approximate";
  if (status === "diagnostic_only") return "diagnostic_only";
  if (status === "missing_intrinsics") return "missing_intrinsics";
  if (status === "missing_extrinsics") return "missing_extrinsics";
  if (status === "insufficient_cameras") return "insufficient_views";
  return "failed";
}

function calibrationStageStatus(
  calibration: CameraCalibrationArtifact | undefined,
): MotionPipelineStageResultStatus {
  if (!calibration) return "ready";
  if (calibration.status === "ready" || !calibration.status) return "ready";
  if (calibration.status === "approximate") return "approximate";
  if (calibration.status === "diagnostic_only") return "diagnostic_only";
  if (calibration.status === "insufficient_views") return "insufficient_views";
  if (calibration.status === "missing_calibration") return "insufficient_calibration";
  return "failed";
}

function reconstructionStatusToStageStatus(
  status: string | undefined,
): MotionPipelineStageResultStatus {
  if (status === "ready" || status === "completed") return "ready";
  if (status === "diagnostic_only") return "diagnostic_only";
  if (status === "approximate") return "approximate";
  if (status === "missing_sync") return "missing_timestamps";
  if (status === "missing_pose_frames") return "missing_pose_frames";
  if (status === "missing_calibration") return "insufficient_calibration";
  if (status === "insufficient_views") return "insufficient_views";
  if (status === "failed") return "failed";
  return "diagnostic_only";
}

function dualFitStageStatus(
  status: DualFitReportArtifact["status"],
  acceptedAsFinalAnimation: boolean,
): MotionPipelineStageResultStatus {
  if (acceptedAsFinalAnimation) return "ready";
  if (status === "failed" || status === "optimization_failed") return "failed";
  if (
    status === "missing_joint_track" ||
    status === "missing_wham_initialization" ||
    status === "optimization_not_implemented" ||
    status === "fallback_primary_wham" ||
    status === "diagnostic_only" ||
    status === "ready"
  ) {
    return "diagnostic_only";
  }
  if (status === "insufficient_quality") return "diagnostic_only";
  return "ready";
}

function qualityGateSummary(
  report: DualFitReportArtifact,
  acceptedDualFitFinal: boolean,
): DualFitQualityGateSummary {
  const acceptance =
    !acceptedDualFitFinal && report.acceptedAsFinalAnimation
      ? buildDualFitAcceptanceSummary({
          metrics: {
            ...report.metrics,
            acceptedAsFinalAnimation: false,
          },
          gates: report.qualityGates,
          acceptedAsFinalAnimation: false,
          additionalBlockingFailures: ["optimized_artifacts_missing"],
        })
      : report.acceptance ??
        buildDualFitAcceptanceSummary({
          metrics: report.metrics,
          gates: report.qualityGates,
          acceptedAsFinalAnimation: report.acceptedAsFinalAnimation,
        });
  return {
    passed: report.qualityGates.filter((gate) => gate.passed).length,
    failed: report.qualityGates.filter((gate) => !gate.passed).length,
    blockingFailed: report.qualityGates.filter(
      (gate) => !gate.passed && gate.severity === "blocking",
    ).length,
    warningFailed: report.qualityGates.filter(
      (gate) => !gate.passed && gate.severity === "warning",
    ).length,
    accepted: acceptance.accepted,
    blockingFailures: acceptance.blockingFailures,
    warnings: acceptance.warnings,
    unavailableMetrics: acceptance.unavailableMetrics,
    metrics: acceptance.metrics,
    finalAnimationSourceRecommendation:
      acceptance.finalAnimationSourceRecommendation,
  };
}

function failureStatus(errorCode: string | undefined): MotionPipelineStageResultStatus {
  if (errorCode === "multi_view_pose_extraction_failed") return "missing_pose_frames";
  if (errorCode === "multi_view_sync_failed") return "missing_timestamps";
  if (errorCode === "metadata_intrinsics_required") return "missing_intrinsics";
  if (
    errorCode === "camera_calibration_failed" ||
    errorCode === "camera_projection_invalid"
  ) {
    return "insufficient_calibration";
  }
  if (
    errorCode === "triangulation_coverage_low" ||
    errorCode === "reprojection_error_high"
  ) {
    return "diagnostic_only";
  }
  return "failed";
}

function cameraIntrinsicsSummary(calibration: CameraCalibrationArtifact | undefined) {
  if (!calibration?.devices.length) {
    return {
      status: "missing_intrinsics" as const,
      source: "unavailable",
      confidence: 0,
    };
  }
  const hasFallback = calibration.devices.some(
    (device) => device.intrinsicsSource === "fov_fallback",
  );
  return {
    status: hasFallback ? ("missing_intrinsics" as const) : ("ready" as const),
    source: uniqueSource(
      calibration.devices.map((device) => device.intrinsicsSource),
    ),
    confidence: average(
      calibration.devices.map((device) =>
        intrinsicsConfidence(device.intrinsicsSource),
      ),
    ),
  };
}

function cameraExtrinsicsSummary(calibration: CameraCalibrationArtifact | undefined) {
  if (!calibration?.devices.length) {
    return {
      status: "missing_extrinsics" as const,
      source: "unavailable",
      confidence: 0,
    };
  }
  const hasFallback = calibration.devices.some(
    (device) => device.extrinsicsSource === "role_angle_fallback",
  );
  return {
    status: hasFallback ? ("missing_extrinsics" as const) : ("ready" as const),
    source: uniqueSource(
      calibration.devices.map((device) => device.extrinsicsSource ?? "unavailable"),
    ),
    confidence: average(
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

function average(values: readonly number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function pickRefs(
  artifactRefs: Record<string, string> | undefined,
  pattern: RegExp,
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(artifactRefs ?? {})) {
    if (pattern.test(key)) refs[key] = value;
  }
  return refs;
}
