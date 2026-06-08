import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  CalibrationObservationsArtifact,
  CaptureVolumeArtifact,
  DualFitReportArtifact,
  Matrix3x3,
  MultiViewSyncReport,
  ProjectionMatrix3x4,
  TriangulatedJointTrackArtifact,
  Vector3,
} from "../types";
import { resolveWorkerPipelineBranch } from "../reconstruction/multiViewOrchestrator";
import {
  artifactRefsFromPersistedMultiViewArtifacts,
  buildMotionPipelineStage,
  buildReconstructionDiagnosticStages,
  sortMotionPipelineStages,
} from "./motionPipelineStages";

function stageNames(stages: ReturnType<typeof buildReconstructionDiagnosticStages>) {
  return stages.map((stage) => stage.stageName);
}

function syncReport(): MultiViewSyncReport {
  return {
    schema: "mocap.multiview_sync.v1",
    schemaVersion: "mocap.multi_view_sync.v1",
    takeId: "take",
    jobId: "job",
    syncMethod: "monotonic_timestamp_sync",
    referenceDeviceId: "device_0",
    targetDeviceIds: ["device_1"],
    referenceDeviceIndex: 0,
    devices: [0, 1].map((deviceIndex) => ({
      deviceIndex,
      offsetMs: deviceIndex === 0 ? 0 : 3.2,
      confidence: 0.91,
      method: "monotonic_timestamp_sync",
      matchedFrameCount: 120,
      droppedFrameCount: deviceIndex === 0 ? 0 : 4,
      averageTimeDeltaMs: 3.2,
      maxTimeDeltaMs: 12.1,
    })),
    matchedFrames: [],
    framePairs: [],
    matchedFrameCount: 120,
    averageTimeDeltaMs: 3.2,
    p95TimeDeltaMs: 8.7,
    syncConfidence: 0.91,
    droppedFrameCount: 4,
    clockOffsetMs: null,
    manualOffsetMs: null,
    status: "ready",
    metrics: {
      matchedFrameCount: 120,
      droppedFrameCount: 4,
      averageTimeDeltaMs: 3.2,
      maxTimeDeltaMs: 12.1,
      p95TimeDeltaMs: 8.7,
      syncConfidence: 0.91,
    },
    warnings: [],
  };
}

function calibrationObservations(): CalibrationObservationsArtifact {
  return {
    schemaVersion: "mocap.calibration_observations.v1",
    takeId: "take",
    jobId: "job",
    sessionId: "session",
    targetType: "apriltag",
    detectorSource: "fixture",
    status: "ready",
    reason: null,
    cameras: [
      {
        cameraId: "device_0",
        deviceId: "device_0",
        status: "ready",
        frameCount: 1,
        observationCount: 1,
        averageConfidence: 0.9,
        warnings: [],
      },
    ],
    frames: [
      {
        cameraId: "device_0",
        deviceId: "device_0",
        frameIndex: 0,
        timestampMs: 0,
        observations: [
          {
            targetId: "tag_0",
            cornerId: "0",
            x: 10,
            y: 20,
            confidence: 0.9,
          },
        ],
        warnings: [],
      },
    ],
    warnings: [],
  };
}

const IDENTITY: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PROJECTION: ProjectionMatrix3x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const ZERO: Vector3 = [0, 0, 0];

function cameraCalibration(): CameraCalibrationArtifact {
  return {
    schema: "mocap.camera_calibration.v1",
    takeId: "take",
    jobId: "job",
    source: "capture_metadata",
    intrinsicsSource: "capture_metadata",
    devices: [0, 1].map((deviceIndex) => ({
      cameraId: `device_${deviceIndex}`,
      deviceIndex,
      deviceRole: deviceIndex === 0 ? "primary" : "secondary",
      intrinsic: IDENTITY,
      rotation: IDENTITY,
      translation: ZERO,
      projection: PROJECTION,
      intrinsicsSource: "capture_metadata",
      extrinsicsSource: "capture_metadata",
    })),
    baselineEstimate: 1,
    status: "ready",
    quality: {
      score: 0.9,
      averageReprojectionErrorPx: 0,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings: [],
  };
}

function captureVolume(): CaptureVolumeArtifact {
  return {
    schemaVersion: "mocap.capture_volume.v1",
    volumeId: "take",
    takeId: "take",
    jobId: "job",
    sessionId: "session",
    cameraIds: ["device_0", "device_1"],
    validCameraCount: 2,
    worldOrigin: { source: "capture_metadata", description: "camera_0_origin" },
    coordinateSystem: { upAxis: "Y", forwardAxis: "Z", unit: "meter" },
    floorPlane: null,
    baselineEstimate: 1,
    captureBounds: null,
    status: "ready",
    warnings: [],
  };
}

function triangulatedJointTrack(): TriangulatedJointTrackArtifact {
  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: "take",
    jobId: "job",
    source: "dual_camera",
    status: "ready",
    coordinateSystem: "right_handed_y_up",
    jointSet: "body33",
    cameraIds: ["device_0", "device_1"],
    frameCount: 120,
    trackedFrameCount: 118,
    metrics: {
      matchedFrameCount: 120,
      triangulatedJointRatio: 0.82,
      averageReprojectionErrorPx: 2.4,
      reprojectionP95Px: 5.8,
      temporalJitterAfter: 0.04,
    },
    frames: [],
    warnings: [],
  };
}

function dualFitReport(): DualFitReportArtifact {
  return {
    schema: "mocap.dual_fit_report.v1",
    takeId: "take",
    jobId: "job",
    status: "optimization_not_implemented",
    reason:
      "Phase 5A evaluates fitting readiness but keeps final animation on primary WHAM.",
    inputSources: {
      initialization: "primary_wham",
      jointTrack: "triangulated_joint_track_json",
      pose2D: ["pose_frames_device_0_json", "pose_frames_device_1_json"],
      calibration: "camera_calibration_json",
    },
    constraints: {
      triangulated3DEnabled: true,
      reprojection2DEnabled: true,
      boneLengthConsistencyEnabled: true,
      jointAngleLimitsEnabled: true,
      footContactEnabled: true,
      temporalSmoothnessEnabled: true,
      centerOfMassEnabled: false,
      leftRightConsistencyEnabled: true,
    },
    losses: {
      initializationLoss: null,
      triangulatedJointLoss: null,
      reprojectionLoss: 2.4,
      boneLengthLoss: null,
      jointLimitLoss: null,
      footContactLoss: null,
      temporalSmoothnessLoss: 0.04,
      totalLoss: null,
    },
    metrics: {
      triangulatedJointRatio: 0.82,
      averageReprojectionErrorPxBefore: 2.4,
      averageReprojectionErrorPxAfter: null,
      reprojectionImprovementRatio: null,
      temporalJitterBefore: 0.08,
      temporalJitterAfter: 0.04,
      temporalSmoothingGain: 0.5,
      boneLengthConsistencyScore: null,
      jointLimitViolationCount: null,
      footContactStabilityScore: null,
      acceptedAsFinalAnimation: false,
    },
    qualityGates: [
      {
        name: "triangulated_joint_ratio",
        passed: true,
        value: 0.82,
        threshold: 0.65,
        severity: "blocking",
        reason: null,
      },
    ],
    acceptedAsFinalAnimation: false,
    finalAnimationSourceCandidate: "primary_wham",
    artifactRefs: {
      triangulated_joint_track_json:
        "takes/take/jobs/job/triangulated_joint_track.json",
    },
    warnings: ["dual_fit_optimizer_not_implemented"],
  };
}

function testSelectedVideoCountAtMostOneSkipsReconstructionBranch() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });
  const stages = buildReconstructionDiagnosticStages({
    source: "single_camera",
    branchKind: branch.kind,
    reconstructionAvailable: false,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.deepEqual(stages, []);
}

function testDualSuccessIncludesAllReconstructionStages() {
  const refs = artifactRefsFromPersistedMultiViewArtifacts([
    {
      format: "pose_frames_device_json",
      artifactName: "pose_frames_device_0_json",
      storageKey: "takes/take/jobs/job/pose_frames_device_0.json",
      sizeBytes: 1,
    },
    {
      format: "pose_frames_device_json",
      artifactName: "pose_frames_device_1_json",
      storageKey: "takes/take/jobs/job/pose_frames_device_1.json",
      sizeBytes: 1,
    },
    {
      format: "multi_view_sync_json",
      artifactName: "multi_view_sync_json",
      storageKey: "takes/take/jobs/job/multi_view_sync.json",
      sizeBytes: 1,
    },
    {
      format: "calibration_observations_json",
      artifactName: "calibration_observations_json",
      storageKey: "takes/take/jobs/job/calibration_observations.json",
      sizeBytes: 1,
    },
    {
      format: "camera_calibration_json",
      artifactName: "camera_calibration_json",
      storageKey: "takes/take/jobs/job/camera_calibration.json",
      sizeBytes: 1,
    },
    {
      format: "capture_volume_json",
      artifactName: "capture_volume_json",
      storageKey: "takes/take/jobs/job/capture_volume.json",
      sizeBytes: 1,
    },
    {
      format: "triangulated_joint_track_json",
      artifactName: "triangulated_joint_track_json",
      storageKey: "takes/take/jobs/job/triangulated_joint_track.json",
      sizeBytes: 1,
    },
    {
      format: "dual_fit_report_json",
      artifactName: "dual_fit_report_json",
      storageKey: "takes/take/jobs/job/dual_fit_report.json",
      sizeBytes: 1,
    },
    {
      format: "dual_reconstruction_json",
      artifactName: "dual_reconstruction_json",
      storageKey: "takes/take/jobs/job/dual_reconstruction.json",
      sizeBytes: 1,
    },
    {
      format: "multi_view_reconstruction_json",
      artifactName: "multi_view_reconstruction_json",
      storageKey: "takes/take/jobs/job/multi_view_reconstruction.json",
      sizeBytes: 1,
    },
  ]);
  const stages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "multi_view_reconstruction",
    reconstructionAvailable: true,
    reconstructionStatus: "ready",
    artifactRefs: refs,
    syncReport: syncReport(),
    calibrationObservations: calibrationObservations(),
    cameraCalibration: cameraCalibration(),
    captureVolume: captureVolume(),
    triangulatedJointTrack: triangulatedJointTrack(),
    dualFitReport: dualFitReport(),
    startedAtMs: 1000,
    completedAtMs: 1125,
  });

  assert.deepEqual(stageNames(stages), [
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
  ]);
  assert.ok(
    stages
      .filter((stage) => stage.stageName !== "dual_camera_fitting")
      .every((stage) => stage.status === "ready"),
    `unexpected statuses: ${stages.map((stage) => `${stage.stageName}:${stage.status}`).join(", ")}`,
  );
  const fittingStage = stages.find(
    (stage) => stage.stageName === "dual_camera_fitting",
  );
  assert.equal(fittingStage?.status, "diagnostic_only");
  assert.equal(fittingStage?.dualFitStatus, "optimization_not_implemented");
  assert.equal(fittingStage?.acceptedAsFinalAnimation, false);
  assert.equal(fittingStage?.finalAnimationSource, "primary_wham");
  assert.equal(fittingStage?.artifactRefs.dual_fit_report_json, "takes/take/jobs/job/dual_fit_report.json");
  assert.equal(fittingStage?.qualityGateSummary?.passed, 1);
  assert.equal(fittingStage?.qualityGateSummary?.accepted, false);
  assert.equal(
    fittingStage?.qualityGateSummary?.finalAnimationSourceRecommendation,
    "primary_wham",
  );
  assert.equal(
    stages[0].artifactRefs.pose_frames_device_0_json,
    "takes/take/jobs/job/pose_frames_device_0.json",
  );
  const triangulationStage = stages.find(
    (stage) => stage.stageName === "dual_triangulation",
  );
  assert.equal(
    triangulationStage?.artifactRefs.dual_reconstruction_json,
    "takes/take/jobs/job/dual_reconstruction.json",
  );
  const jointTrackStage = stages.find(
    (stage) => stage.stageName === "triangulated_joint_tracking",
  );
  assert.equal(
    jointTrackStage?.artifactRefs.triangulated_joint_track_json,
    "takes/take/jobs/job/triangulated_joint_track.json",
  );
  assert.equal(jointTrackStage?.jointTrackStatus, "ready");
  assert.equal(jointTrackStage?.triangulatedJointRatio, 0.82);
  assert.equal(jointTrackStage?.averageReprojectionErrorPx, 2.4);
  assert.equal(jointTrackStage?.temporalJitterAfter, 0.04);
  const frameSyncStage = stages.find((stage) => stage.stageName === "frame_sync");
  assert.equal(frameSyncStage?.syncMethod, "monotonic_timestamp_sync");
  assert.equal(frameSyncStage?.averageTimeDeltaMs, 3.2);
  assert.equal(frameSyncStage?.p95TimeDeltaMs, 8.7);
  assert.equal(frameSyncStage?.syncConfidence, 0.91);
  assert.equal(frameSyncStage?.matchedFrameCount, 120);
  assert.equal(
    frameSyncStage?.artifactRef,
    "takes/take/jobs/job/multi_view_sync.json",
  );
  const calibrationDetectionStage = stages.find(
    (stage) => stage.stageName === "calibration_target_detection",
  );
  assert.equal(calibrationDetectionStage?.targetType, "apriltag");
  assert.equal(calibrationDetectionStage?.detectorSource, "fixture");
  assert.equal(calibrationDetectionStage?.observationCount, 1);
  assert.equal(calibrationDetectionStage?.averageConfidence, 0.9);
  assert.equal(
    calibrationDetectionStage?.artifactRef,
    "takes/take/jobs/job/calibration_observations.json",
  );
  const intrinsicsStage = stages.find((stage) => stage.stageName === "camera_intrinsics");
  assert.equal(intrinsicsStage?.intrinsicsStatus, "ready");
  assert.equal(intrinsicsStage?.intrinsicsSource, "capture_metadata");
  assert.equal(intrinsicsStage?.artifactRef, "takes/take/jobs/job/camera_calibration.json");
  const captureVolumeStage = stages.find((stage) => stage.stageName === "capture_volume");
  assert.equal(captureVolumeStage?.captureVolumeStatus, "ready");
  assert.equal(captureVolumeStage?.baselineEstimate, 1);
  assert.equal(captureVolumeStage?.artifactRef, "takes/take/jobs/job/capture_volume.json");
}

function testAcceptedDualFitStageReferencesOptimizedArtifacts() {
  const acceptedFitReport: DualFitReportArtifact = {
    ...dualFitReport(),
    status: "ready",
    reason: "Accepted optimized dual-camera solve.",
    metrics: {
      ...dualFitReport().metrics,
      acceptedAsFinalAnimation: true,
      reliableConstraintRatio: 0.72,
      optimizedMotionDelta: 0.03,
    },
    acceptedAsFinalAnimation: true,
    finalAnimationSourceCandidate: "true_dual_solve",
    artifactRefs: {
      dual_fit_report_json: "takes/take/jobs/job/dual_fit_report.json",
      optimized_solved_motion_json:
        "takes/take/jobs/job/optimized_solved_motion.json",
      optimized_bvh: "takes/take/jobs/job/optimized_result.bvh",
    },
    warnings: ["dual_fit_accepted_true_dual_solve"],
  };
  const stages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "multi_view_reconstruction",
    reconstructionAvailable: true,
    reconstructionStatus: "ready",
    artifactRefs: {
      dual_fit_report_json: "takes/take/jobs/job/dual_fit_report.json",
      optimized_solved_motion_json:
        "takes/take/jobs/job/optimized_solved_motion.json",
      optimized_bvh: "takes/take/jobs/job/optimized_result.bvh",
      triangulated_joint_track_json:
        "takes/take/jobs/job/triangulated_joint_track.json",
    },
    triangulatedJointTrack: triangulatedJointTrack(),
    dualFitReport: acceptedFitReport,
  });
  const fittingStage = stages.find(
    (stage) => stage.stageName === "dual_camera_fitting",
  );
  const artifactStage = stages.find(
    (stage) => stage.stageName === "dual_reconstruction_artifacts",
  );

  assert.equal(fittingStage?.status, "ready");
  assert.equal(fittingStage?.acceptedAsFinalAnimation, true);
  assert.equal(fittingStage?.finalAnimationSource, "true_dual_solve");
  assert.equal(fittingStage?.qualityGateSummary?.accepted, true);
  assert.deepEqual(fittingStage?.qualityGateSummary?.blockingFailures, []);
  assert.equal(
    fittingStage?.qualityGateSummary?.finalAnimationSourceRecommendation,
    "true_dual_solve",
  );
  assert.equal(
    fittingStage?.artifactRefs.optimized_solved_motion_json,
    "takes/take/jobs/job/optimized_solved_motion.json",
  );
  assert.equal(
    fittingStage?.artifactRefs.optimized_bvh,
    "takes/take/jobs/job/optimized_result.bvh",
  );
  assert.equal(
    artifactStage?.artifactRefs.optimized_bvh,
    "takes/take/jobs/job/optimized_result.bvh",
  );
}

function testRejectedDualFitStageKeepsPrimaryWham() {
  const rejectedFitReport: DualFitReportArtifact = {
    ...dualFitReport(),
    status: "insufficient_quality",
    reason: "Triangulated joint coverage is below the fitting threshold.",
    metrics: {
      ...dualFitReport().metrics,
      triangulatedJointRatio: 0.2,
      acceptedAsFinalAnimation: false,
    },
    qualityGates: [
      {
        name: "triangulated_joint_ratio",
        passed: false,
        value: 0.2,
        threshold: 0.65,
        severity: "blocking",
        code: "triangulated_joint_ratio_low",
        reason: "Triangulated joint coverage is below the fitting threshold.",
      },
    ],
    acceptedAsFinalAnimation: false,
    finalAnimationSourceCandidate: "primary_wham",
    warnings: [
      "Triangulated joint coverage is below the fitting threshold.",
      "dual_fit_rejected_primary_wham_final",
    ],
  };
  const stages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "multi_view_reconstruction",
    reconstructionAvailable: true,
    reconstructionStatus: "ready",
    artifactRefs: {
      dual_fit_report_json: "takes/take/jobs/job/dual_fit_report.json",
      triangulated_joint_track_json:
        "takes/take/jobs/job/triangulated_joint_track.json",
    },
    triangulatedJointTrack: triangulatedJointTrack(),
    dualFitReport: rejectedFitReport,
  });
  const fittingStage = stages.find(
    (stage) => stage.stageName === "dual_camera_fitting",
  );

  assert.equal(fittingStage?.status, "diagnostic_only");
  assert.equal(fittingStage?.acceptedAsFinalAnimation, false);
  assert.equal(fittingStage?.finalAnimationSource, "primary_wham");
  assert.equal(fittingStage?.qualityGateSummary?.accepted, false);
  assert.deepEqual(fittingStage?.qualityGateSummary?.blockingFailures, [
    "triangulated_joint_ratio_low",
  ]);
  assert.equal(
    fittingStage?.qualityGateSummary?.finalAnimationSourceRecommendation,
    "primary_wham",
  );
}

function testAcceptedDualFitWithoutOptimizedArtifactsKeepsPrimaryWham() {
  const acceptedButMissingArtifacts: DualFitReportArtifact = {
    ...dualFitReport(),
    status: "ready",
    reason: "Accepted gates but optimized artifacts are missing.",
    metrics: {
      ...dualFitReport().metrics,
      acceptedAsFinalAnimation: true,
      reliableConstraintRatio: 0.72,
      optimizedMotionDelta: 0.03,
    },
    acceptedAsFinalAnimation: true,
    finalAnimationSourceCandidate: "true_dual_solve",
    artifactRefs: {
      dual_fit_report_json: "takes/take/jobs/job/dual_fit_report.json",
    },
    warnings: ["dual_fit_accepted_true_dual_solve_candidate"],
  };
  const stages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "multi_view_reconstruction",
    reconstructionAvailable: true,
    reconstructionStatus: "ready",
    artifactRefs: {
      dual_fit_report_json: "takes/take/jobs/job/dual_fit_report.json",
      triangulated_joint_track_json:
        "takes/take/jobs/job/triangulated_joint_track.json",
    },
    triangulatedJointTrack: triangulatedJointTrack(),
    dualFitReport: acceptedButMissingArtifacts,
  });
  const fittingStage = stages.find(
    (stage) => stage.stageName === "dual_camera_fitting",
  );

  assert.equal(fittingStage?.status, "diagnostic_only");
  assert.equal(fittingStage?.acceptedAsFinalAnimation, false);
  assert.equal(fittingStage?.finalAnimationSource, "primary_wham");
  assert.equal(fittingStage?.qualityGateSummary?.accepted, false);
  assert.ok(
    fittingStage?.qualityGateSummary?.blockingFailures?.includes(
      "optimized_artifacts_missing",
    ),
  );
}

function testFinalExportStageRecordsTrueFinalSource() {
  const acceptedStages = sortMotionPipelineStages([
    buildMotionPipelineStage({
      stageName: "primary_wham",
      status: "completed",
      reason: "WHAM produced the primary initialization.",
    }),
    buildMotionPipelineStage({
      stageName: "dual_camera_fitting",
      status: "ready",
      reason: "Dual-camera fitting was accepted.",
      dualFitStatus: "ready",
      acceptedAsFinalAnimation: true,
      finalAnimationSource: "true_dual_solve",
      qualityGateSummary: {
        passed: 1,
        failed: 0,
        blockingFailed: 0,
        warningFailed: 0,
        accepted: true,
        blockingFailures: [],
        warnings: [],
        unavailableMetrics: [],
        metrics: { acceptedAsFinalAnimation: true },
        finalAnimationSourceRecommendation: "true_dual_solve",
      },
    }),
    buildMotionPipelineStage({
      stageName: "final_animation_export",
      status: "completed",
      reason: "Final BVH export was generated from the accepted optimized dual-camera solve.",
      finalAnimationSource: "true_dual_solve",
    }),
  ]);
  assert.deepEqual(
    acceptedStages.map((stage) => stage.stageName),
    ["primary_wham", "dual_camera_fitting", "final_animation_export"],
  );
  assert.equal(acceptedStages[1].acceptedAsFinalAnimation, true);
  assert.equal(acceptedStages[2].finalAnimationSource, "true_dual_solve");

  const rejectedStages = sortMotionPipelineStages([
    buildMotionPipelineStage({
      stageName: "primary_wham",
      status: "completed",
      reason: "WHAM produced the primary final motion.",
    }),
    buildMotionPipelineStage({
      stageName: "dual_camera_fitting",
      status: "diagnostic_only",
      reason: "Dual-camera fitting was rejected.",
      dualFitStatus: "insufficient_quality",
      acceptedAsFinalAnimation: false,
      finalAnimationSource: "primary_wham",
      qualityGateSummary: {
        passed: 0,
        failed: 1,
        blockingFailed: 1,
        warningFailed: 0,
        accepted: false,
        blockingFailures: ["triangulated_joint_ratio_low"],
        warnings: [],
        unavailableMetrics: [],
        metrics: { acceptedAsFinalAnimation: false },
        finalAnimationSourceRecommendation: "primary_wham",
      },
    }),
    buildMotionPipelineStage({
      stageName: "final_animation_export",
      status: "completed",
      reason: "Final BVH export was generated from the primary WHAM motion path.",
      finalAnimationSource: "primary_wham",
    }),
  ]);
  assert.deepEqual(
    rejectedStages.map((stage) => stage.stageName),
    ["primary_wham", "dual_camera_fitting", "final_animation_export"],
  );
  assert.equal(rejectedStages[1].acceptedAsFinalAnimation, false);
  assert.equal(rejectedStages[2].finalAnimationSource, "primary_wham");
}

function testDualDiagnosticFailureDoesNotRemovePrimaryWhamStage() {
  const reconstructionStages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "multi_view_reconstruction",
    reconstructionAvailable: false,
    errorCode: "multi_view_pose_extraction_failed",
    errorMessage: "Pose detector adapter unavailable.",
    warnings: ["multi_view_pose_extraction_failed"],
  });
  const reportStages = sortMotionPipelineStages([
    buildMotionPipelineStage({
      stageName: "video_normalization",
      status: "completed",
      reason: "Normalized selected videos.",
    }),
    ...reconstructionStages,
    buildMotionPipelineStage({
      stageName: "primary_wham",
      status: "completed",
      reason: "WHAM continued from the primary selected video.",
      warnings: ["single_camera_solver_fallback_used"],
    }),
    buildMotionPipelineStage({
      stageName: "quality_report",
      status: "completed",
      reason: "Quality report was generated.",
    }),
    buildMotionPipelineStage({
      stageName: "final_animation_export",
      status: "completed",
      reason: "BVH export was generated from primary WHAM.",
    }),
  ]);

  const poseStage = reportStages.find(
    (stage) => stage.stageName === "per_camera_pose_extraction",
  );
  const whamStage = reportStages.find((stage) => stage.stageName === "primary_wham");

  assert.equal(poseStage?.status, "missing_pose_frames");
  assert.equal(whamStage?.status, "completed");
  assert.ok(whamStage?.warnings.includes("single_camera_solver_fallback_used"));
}

function testFeatureDisabledStagesAreExplicitlySkipped() {
  const stages = buildReconstructionDiagnosticStages({
    source: "dual_camera",
    branchKind: "primary_wham_fallback",
    reconstructionAvailable: false,
    warnings: ["multi_view_reconstruction_disabled"],
  });

  assert.equal(stages.length, 11);
  assert.ok(stages.every((stage) => stage.status === "skipped"));
  assert.ok(stages[0].warnings.includes("multi_view_reconstruction_disabled"));
}

function testMotionPipelineStageSortOrder() {
  const stages = sortMotionPipelineStages([
    buildMotionPipelineStage({
      stageName: "final_animation_export",
      status: "completed",
      reason: "final",
    }),
    buildMotionPipelineStage({
      stageName: "video_normalization",
      status: "completed",
      reason: "normalization",
    }),
    buildMotionPipelineStage({
      stageName: "primary_wham",
      status: "completed",
      reason: "wham",
    }),
  ]);

  assert.deepEqual(stageNames(stages), [
    "video_normalization",
    "primary_wham",
    "final_animation_export",
  ]);
}

testSelectedVideoCountAtMostOneSkipsReconstructionBranch();
testDualSuccessIncludesAllReconstructionStages();
testAcceptedDualFitStageReferencesOptimizedArtifacts();
testRejectedDualFitStageKeepsPrimaryWham();
testAcceptedDualFitWithoutOptimizedArtifactsKeepsPrimaryWham();
testFinalExportStageRecordsTrueFinalSource();
testDualDiagnosticFailureDoesNotRemovePrimaryWhamStage();
testFeatureDisabledStagesAreExplicitlySkipped();
testMotionPipelineStageSortOrder();
console.log("motion pipeline stage tests passed");
