import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  CalibrationObservationsArtifact,
  CaptureVolumeArtifact,
  CaptureMetadataDiagnostics,
  CleanupReport,
  DualFitReportArtifact,
  Matrix3x3,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  ProjectionMatrix3x4,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
  Vector3,
  WhamInputUsageMetrics,
  WhamInputUsageSource,
} from "../types";
import { buildMissingCalibrationArtifact } from "../reconstruction/cameraCalibration";
import {
  buildMissingPoseFramesArtifact,
  buildPerCameraPoseArtifact,
} from "../pose/poseExtraction";
import { buildQualityReport } from "./exportValidation";

const TAKE_ID = "take_quality_multiview";
const JOB_ID = "job_quality_multiview";
const IDENTITY_MATRIX: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO_TRANSLATION: Vector3 = [0, 0, 0];
const PROJECTION: ProjectionMatrix3x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function basePose(): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sourceVideo: {
      storageKey: "takes/take_quality_multiview/original/device_0.mov",
      normalizedStorageKey:
        "takes/take_quality_multiview/jobs/job_quality_multiview/normalized.mp4",
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 1000,
    },
    detector: {
      name: "fixture_detector",
      version: "fixture_v1",
      landmarkSchema: "body_33",
    },
    frames: [],
    quality: {
      frameCount: 30,
      detectedFrameCount: 30,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 1,
    },
  };
}

function baseSolved(): SolvedMotionArtifact {
  return {
    schema: "mocap.solved_motion.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    skeleton: {
      name: "mocap_humanoid_v1",
      rotationOrder: "XYZ",
      coordinateSystem: "right_handed_y_up",
    },
    fps: 30,
    frameCount: 30,
    durationMs: 1000,
    frames: [],
    validation: {
      ok: true,
      warnings: [],
      errors: [],
    },
  };
}

function baseCleanup(): CleanupReport {
  return {
    schema: "mocap.cleanup_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    algorithm: {
      name: "cleanup_quality_v1_5",
      smoothing: "confidence_aware_exponential",
      interpolation: "nearest_linear",
      footLocking: "basic_contact_anchor",
    },
    metrics: {
      sourceFrameCount: 30,
      solvedFrameCount: 30,
      cleanedFrameCount: 30,
      interpolatedFrameCount: 0,
      outlierFrameCount: 0,
      missingLandmarkRatio: 0,
      jitterScore: 1,
      jitterRms: 0,
      rootStability: 1,
      rootVerticalJitter: 0,
      footSlidingScore: 1,
      footSlidingDistance: 0,
      footContactFrameCount: 20,
      footLockFrameCount: 20,
      boneLengthConsistency: 1,
      boneLengthVariation: 0,
      leftRightSwapCount: 0,
      smoothingStrength: 0.5,
    },
    warnings: [],
    actions: [],
  };
}

function baseValidation() {
  return {
    ok: true,
    errors: [],
    warnings: [],
    blenderOk: true,
    blenderSkipped: false,
  };
}

function perCameraPoseArtifact(
  deviceIndex: number,
  input: { status?: "ready" | "low_confidence"; confidence?: number } = {},
): PerCameraPoseArtifact {
  const confidence = input.confidence ?? 0.85;
  return buildPerCameraPoseArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    deviceIndex,
    deviceRole: deviceIndex === 0 ? "primary" : "secondary",
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/device_${deviceIndex}.mov`,
      normalizedStorageKey: `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/device_${deviceIndex}.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 100,
    },
    detectorResult: {
      detector: {
        name: "rtmpose_mmpose",
        version: "fixture_v1",
        landmarkSchema: "custom",
      },
      detectorSource: "rtmpose_mmpose",
      expectedFrameCount: 3,
      status: input.status,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          keypoints: [
            {
              jointId: "nose",
              x: 100 + deviceIndex,
              y: 200,
              confidence,
            },
          ],
          poseConfidence: confidence,
        },
      ],
    },
  });
}

function missingPoseArtifact(deviceIndex: number): PerCameraPoseArtifact {
  return buildMissingPoseFramesArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    deviceIndex,
    deviceRole: deviceIndex === 0 ? "primary" : "secondary",
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/device_${deviceIndex}.mov`,
      normalizedStorageKey: `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/device_${deviceIndex}.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 100,
    },
    detectorSource: "rtmpose_mmpose",
    reason: "RTMPose/MMPose runtime is not configured.",
  });
}

function whamUsage(
  input: Partial<WhamInputUsageMetrics> & { source?: WhamInputUsageSource } = {},
): WhamInputUsageMetrics {
  return {
    source: input.source ?? "dual_camera",
    primaryVideoUsed: input.primaryVideoUsed ?? true,
    primaryDeviceIndex: input.primaryDeviceIndex ?? 0,
    primaryVideoStorageKey:
      input.primaryVideoStorageKey ??
      "takes/take_quality_multiview/original/device_0.mov",
    additionalVideosProvided: input.additionalVideosProvided ?? 1,
    additionalDeviceIndexes: input.additionalDeviceIndexes ?? [1],
    multiViewReconstructionAvailable:
      input.multiViewReconstructionAvailable ?? false,
    multiViewConstraintsUsed: input.multiViewConstraintsUsed ?? false,
    primaryWhamFallbackUsed: input.primaryWhamFallbackUsed ?? true,
    primaryWhamFallbackReason:
      input.primaryWhamFallbackReason ??
      "multi_view_reconstruction_disabled",
  };
}

function metadataDiagnostics(): CaptureMetadataDiagnostics {
  return {
    metadataCompleteness: {
      status: "partial",
      ratio: 0.5,
      presentFieldCount: 12,
      expectedFieldCount: 24,
      missingFieldCount: 12,
      perDevice: [
        {
          deviceIndex: 0,
          deviceId: "device_0",
          deviceRole: "primary",
          presentFields: ["deviceId", "cameraId"],
          missingFields: ["framePresentationTimestampsMs"],
          hasAudioTrack: false,
          hasIntrinsics: true,
          hasFrameTimestamps: false,
        },
        {
          deviceIndex: 1,
          deviceId: "device_1",
          deviceRole: "secondary",
          presentFields: ["deviceId", "cameraId"],
          missingFields: ["cameraIntrinsics"],
          hasAudioTrack: false,
          hasIntrinsics: false,
          hasFrameTimestamps: false,
        },
      ],
    },
    availableTimestampFields: ["recordingStartedAt", "sync.clockOffsetMs"],
    availableCameraMetadataFields: ["cameraId", "camera.intrinsics"],
    hasAudioTrack: false,
    hasIntrinsics: false,
    hasFrameTimestamps: false,
    missingMetadataWarnings: [
      "metadata_audio_sync_unavailable",
      "metadata_camera_intrinsics_incomplete",
      "metadata_frame_timestamps_incomplete",
    ],
    audioTrackDeviceCount: 0,
    intrinsicsDeviceCount: 1,
    frameTimestampDeviceCount: 0,
  };
}

function calibrationObservations(): CalibrationObservationsArtifact {
  return {
    schemaVersion: "mocap.calibration_observations.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sessionId: "session_quality_multiview",
    targetType: "apriltag",
    detectorSource: "fixture",
    status: "ready",
    reason: null,
    cameras: [
      {
        cameraId: "camera_0",
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
        cameraId: "camera_0",
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

function captureVolume(): CaptureVolumeArtifact {
  return {
    schemaVersion: "mocap.capture_volume.v1",
    volumeId: TAKE_ID,
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sessionId: "session_quality_multiview",
    cameraIds: ["camera_0", "camera_1"],
    validCameraCount: 2,
    worldOrigin: {
      source: "capture_metadata",
      description: "camera_0_origin",
    },
    coordinateSystem: {
      upAxis: "Y",
      forwardAxis: "Z",
      unit: "meter",
    },
    floorPlane: null,
    baselineEstimate: 1,
    captureBounds: null,
    status: "ready",
    warnings: [],
  };
}

function syncReport(input?: {
  syncConfidence?: number;
  matchedFrameCount?: number;
  droppedFrameCount?: number;
  averageTimeDeltaMs?: number;
  offsetMs?: number;
}): MultiViewSyncReport {
  return {
    schema: "mocap.multiview_sync.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    schemaVersion: "mocap.multi_view_sync.v1",
    syncMethod: "frame_presentation_timestamp_sync",
    referenceDeviceId: "camera_0",
    targetDeviceIds: ["camera_1"],
    referenceDeviceIndex: 0,
    devices: [
      {
        deviceIndex: 0,
        offsetMs: 0,
        confidence: 1,
        method: "frame_presentation_timestamp_sync",
        matchedFrameCount: input?.matchedFrameCount ?? 10,
        droppedFrameCount: 0,
        averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
        maxTimeDeltaMs: 8,
      },
      {
        deviceIndex: 1,
        offsetMs: input?.offsetMs ?? 12,
        confidence: input?.syncConfidence ?? 0.92,
        method: "frame_presentation_timestamp_sync",
        matchedFrameCount: input?.matchedFrameCount ?? 10,
        droppedFrameCount: input?.droppedFrameCount ?? 2,
        averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
        maxTimeDeltaMs: 8,
      },
    ],
    matchedFrames: [],
    framePairs: [],
    matchedFrameCount: input?.matchedFrameCount ?? 10,
    averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
    p95TimeDeltaMs: 8,
    syncConfidence: input?.syncConfidence ?? 0.92,
    droppedFrameCount: input?.droppedFrameCount ?? 2,
    clockOffsetMs: null,
    manualOffsetMs: null,
    metadataCompleteness: {
      device_0: {
        hasFrameTimestamps: true,
        hasFirstFrameTimestamp: false,
        hasMonotonicStart: false,
        hasWallClockStart: false,
        hasAudioTrack: false,
        hasNetworkClockOffset: false,
        hasManualOffset: false,
      },
      device_1: {
        hasFrameTimestamps: true,
        hasFirstFrameTimestamp: false,
        hasMonotonicStart: false,
        hasWallClockStart: false,
        hasAudioTrack: false,
        hasNetworkClockOffset: false,
        hasManualOffset: false,
      },
    },
    status: "ready",
    metrics: {
      matchedFrameCount: input?.matchedFrameCount ?? 10,
      droppedFrameCount: input?.droppedFrameCount ?? 2,
      averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
      maxTimeDeltaMs: 8,
      p95TimeDeltaMs: 8,
      syncConfidence: input?.syncConfidence ?? 0.92,
    },
    warnings: ["sync_confidence_low"],
  };
}

function cameraCalibration(input?: {
  score?: number;
  fallbackIntrinsics?: boolean;
  fallbackExtrinsics?: boolean;
}): CameraCalibrationArtifact {
  const warnings: CameraCalibrationArtifact["warnings"] = [];
  if (input?.fallbackIntrinsics) {
    warnings.push("camera_intrinsics_fov_fallback_used");
  }
  if (input?.fallbackExtrinsics) {
    warnings.push("camera_extrinsics_role_angle_fallback_used");
  }

  return {
    schema: "mocap.camera_calibration.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "capture_metadata",
    intrinsicsSource: input?.fallbackIntrinsics
      ? "capture_metadata_or_fov"
      : "capture_metadata",
    devices: [0, 1].map((deviceIndex) => ({
      deviceIndex,
      deviceRole: deviceIndex === 0 ? "front" : "right",
      intrinsic: IDENTITY_MATRIX,
      rotation: IDENTITY_MATRIX,
      translation: ZERO_TRANSLATION,
      projection: PROJECTION,
      intrinsicsSource:
        input?.fallbackIntrinsics && deviceIndex === 1
          ? "fov_fallback"
          : "capture_metadata",
      extrinsicsSource:
        input?.fallbackExtrinsics && deviceIndex === 1
          ? "role_angle_fallback"
          : "capture_metadata",
    })),
    status:
      input?.fallbackIntrinsics || input?.fallbackExtrinsics
        ? "approximate"
        : "ready",
    quality: {
      score: input?.score ?? 0.87,
      averageReprojectionErrorPx: 1.5,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings,
  };
}

function reconstructionArtifact(
  input: Partial<MultiViewReconstructionArtifact["metrics"]> = {},
): MultiViewReconstructionArtifact {
  return {
    schema: "mocap.multiview_reconstruction.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    frameCount: 0,
    landmarkSchema: "body_33",
    frames: [],
    metrics: {
      syncOffsetMs: input.syncOffsetMs ?? 12,
      syncConfidence: input.syncConfidence ?? 0.92,
      matchedFrameCount: input.matchedFrameCount ?? 10,
      droppedFrameCount: input.droppedFrameCount ?? 2,
      averageTimeDeltaMs: input.averageTimeDeltaMs ?? 4.2,
      reprojectionErrorPx: input.reprojectionErrorPx ?? 2.3,
      reprojectionP95Px: input.reprojectionP95Px ?? 4.5,
      triangulatedLandmarkRatio: input.triangulatedLandmarkRatio ?? 0.76,
      fallbackLandmarkRatio: input.fallbackLandmarkRatio ?? 0.24,
      calibrationQualityScore: input.calibrationQualityScore ?? 0.87,
      intrinsicsFallbackUsed: input.intrinsicsFallbackUsed ?? 1,
      multiViewQualityGain: input.multiViewQualityGain ?? 0.55,
    },
    warnings: ["reprojection_error_high"],
  };
}

function reconstructionArtifactWithoutQualityGain(): MultiViewReconstructionArtifact {
  const artifact = reconstructionArtifact();
  const metrics = { ...artifact.metrics };
  delete (metrics as Partial<MultiViewReconstructionArtifact["metrics"]>)
    .multiViewQualityGain;
  return {
    ...artifact,
    metrics: metrics as MultiViewReconstructionArtifact["metrics"],
  };
}

function jointTrackArtifact(): TriangulatedJointTrackArtifact {
  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    status: "diagnostic_only",
    reason: "Triangulated joint coverage is diagnostic.",
    coordinateSystem: "right_handed_y_up",
    jointSet: "body33",
    cameraIds: ["device_0", "device_1"],
    frameCount: 10,
    trackedFrameCount: 8,
    metrics: {
      matchedFrameCount: 10,
      triangulatedJointRatio: 0.8,
      averageReprojectionErrorPx: 2.1,
      reprojectionP95Px: 4.2,
      averageJointConfidence: 0.84,
      lowConfidenceJointRatio: 0.05,
      occludedJointRatio: 0.1,
      smoothedJointRatio: 0.6,
      interpolatedJointRatio: 0.04,
      droppedJointRatio: 0.06,
      temporalJitterBefore: 0.18,
      temporalJitterAfter: 0.09,
      temporalSmoothingGain: 0.5,
    },
    frames: [],
    warnings: ["joint_track_coverage_low"],
  };
}

function dualFitReportArtifact(
  input: Partial<DualFitReportArtifact["metrics"]> = {},
): DualFitReportArtifact {
  return {
    schema: "mocap.dual_fit_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    status: "optimization_not_implemented",
    reason:
      "Phase 5A evaluates constrained fitting readiness but final animation remains primary WHAM.",
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
      reprojectionLoss: 2.1,
      boneLengthLoss: 0.04,
      jointLimitLoss: null,
      footContactLoss: null,
      temporalSmoothnessLoss: 0.09,
      totalLoss: null,
    },
    metrics: {
      triangulatedJointRatio: input.triangulatedJointRatio ?? 0.8,
      averageReprojectionErrorPxBefore:
        input.averageReprojectionErrorPxBefore ?? 2.1,
      averageReprojectionErrorPxAfter: null,
      reprojectionImprovementRatio: null,
      temporalJitterBefore: input.temporalJitterBefore ?? 0.18,
      temporalJitterAfter: input.temporalJitterAfter ?? 0.09,
      temporalSmoothingGain: input.temporalSmoothingGain ?? 0.5,
      boneLengthConsistencyScore: input.boneLengthConsistencyScore ?? 0.96,
      jointLimitViolationCount: null,
      footContactStabilityScore: null,
      acceptedAsFinalAnimation: false,
    },
    qualityGates: [
      {
        name: "triangulated_joint_ratio",
        passed: true,
        value: input.triangulatedJointRatio ?? 0.8,
        threshold: 0.65,
        severity: "blocking",
        reason: null,
      },
    ],
    acceptedAsFinalAnimation: false,
    finalAnimationSourceCandidate: "primary_wham",
    artifactRefs: {},
    warnings: ["dual_fit_optimizer_not_implemented"],
  };
}

function baseQualityScore() {
  return buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
  ).score;
}

function assertMultiView(report: ReturnType<typeof buildQualityReport>) {
  assert.ok(report.multiView);
  return report.multiView;
}

function testSingleCameraBackwardCompatible() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "single_camera",
    {
      whamInputUsage: whamUsage({
        source: "single_camera",
        additionalVideosProvided: 0,
        additionalDeviceIndexes: [],
        primaryWhamFallbackUsed: false,
        primaryWhamFallbackReason: "none",
      }),
    },
  );

  assert.equal(report.schema, "mocap.quality_report.v1");
  assert.equal(report.score, 100);
  assert.equal(report.grade, "excellent");
  assert.equal(report.multiView, undefined);
  assert.equal(report.inputSource.source, "single_camera");
}

function testDualFeatureDisabledFallback() {
  const score = baseQualityScore();
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: false,
        multiViewConstraintsUsed: false,
        primaryWhamFallbackUsed: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_disabled",
      }),
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(report.score, score);
  assert.equal(multiView.enabled, true);
  assert.equal(multiView.source, "dual_camera");
  assert.equal(multiView.reconstructionAvailable, false);
  assert.equal(multiView.reconstructionUsedForConstraints, false);
  assert.equal(multiView.primaryWhamFallbackUsed, true);
  assert.equal(
    multiView.primaryWhamFallbackReason,
    "multi_view_reconstruction_disabled",
  );
  assert.equal(multiView.whamInputUsage?.multiViewConstraintsUsed, false);
}

function testDualDiagnosticReconstructionSuccess() {
  const score = baseQualityScore();
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        multiViewConstraintsUsed: false,
        primaryWhamFallbackUsed: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        calibrationObservations: calibrationObservations(),
        cameraCalibration: cameraCalibration({ fallbackIntrinsics: true }),
        captureVolume: captureVolume(),
        reconstruction: reconstructionArtifact(),
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(report.score, score);
  assert.equal(multiView.reconstructionAvailable, true);
  assert.equal(multiView.reconstructionUsedForConstraints, false);
  assert.equal(
    multiView.primaryWhamFallbackReason,
    "multi_view_reconstruction_diagnostic_only",
  );
  assert.equal(multiView.metrics?.matchedFrameCount, 10);
  assert.equal(multiView.metrics?.averageTimeDeltaMs, 4.2);
  assert.equal(multiView.metrics?.p95TimeDeltaMs, 8);
  assert.equal(multiView.syncStatus, "ready");
  assert.equal(multiView.syncMethod, "frame_presentation_timestamp_sync");
  assert.equal(multiView.syncConfidence, 0.92);
  assert.equal(multiView.averageTimeDeltaMs, 4.2);
  assert.equal(multiView.p95TimeDeltaMs, 8);
  assert.equal(multiView.syncDiagnosticOnly, false);
  assert.equal(multiView.calibrationObservationStatus, "ready");
  assert.equal(multiView.calibrationTargetType, "apriltag");
  assert.equal(multiView.calibrationDetectorSource, "fixture");
  assert.equal(multiView.calibrationObservationCount, 1);
  assert.equal(multiView.calibrationObservationConfidence, 0.9);
  assert.equal(multiView.intrinsicsStatus, "missing_intrinsics");
  assert.equal(multiView.extrinsicsStatus, "ready");
  assert.equal(multiView.captureVolumeStatus, "ready");
  assert.equal(multiView.baselineEstimate, 1);
  assert.equal(multiView.calibrationQualityScore, 0.87);
  assert.equal(multiView.dualReconstructionStatus, "ready");
  assert.equal(multiView.trueDualSolveAvailable, false);
  assert.equal(multiView.metrics?.reprojectionErrorPx, 2.3);
  assert.equal(multiView.metrics?.reprojectionP95Px, 4.5);
  assert.equal(multiView.metrics?.triangulatedLandmarkRatio, 0.76);
  assert.equal(multiView.metrics?.calibrationQualityScore, 0.87);
  assert.equal(multiView.metrics?.intrinsicsFallbackUsed, 1);
  assert.equal(multiView.metrics?.calibrationObservationCount, 1);
  assert.equal(multiView.metrics?.calibrationObservationConfidence, 0.9);
  assert.equal(multiView.metrics?.baselineEstimate, 1);
  assert.equal(multiView.finalAnimationSource, "primary_wham");
  assert.equal(multiView.primaryCameraFallbackUsed, true);
  assert.equal(multiView.reconstructionStatus, "ready");
  assert.equal(report.metrics.multiViewMatchedFrameCount, 10);
  assert.equal(report.metrics.multiViewReprojectionP95Px, 4.5);
  assert.equal(report.metrics.multiViewCalibrationObservationCount, 1);
  assert.equal(report.metrics.multiViewCalibrationObservationConfidence, 0.9);
  assert.equal(report.metrics.multiViewBaselineEstimate, 1);
  assert.ok(multiView.warnings?.includes("reprojection_error_high"));
}

function testMissingCalibrationReportsCalibrationFailure() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: false,
        primaryWhamFallbackUsed: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_failed",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: false,
        syncReport: syncReport(),
        cameraCalibration: buildMissingCalibrationArtifact({
          takeId: TAKE_ID,
          jobId: JOB_ID,
          reason: "Calibration payload unavailable.",
        }),
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.reconstructionStatus, "missing_calibration");
  assert.equal(multiView.finalAnimationSource, "primary_wham");
  assert.equal(multiView.primaryCameraFallbackUsed, true);
  assert.ok(multiView.warnings?.includes("missing_calibration"));
  assert.equal(multiView.metrics?.matchedFrameCount, 10);
  assert.equal(
    "calibrationQualityScore" in (multiView.metrics ?? {}),
    false,
  );
}

function testApproximateCalibrationReportsFallbackUsage() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration({
          fallbackIntrinsics: true,
          fallbackExtrinsics: true,
        }),
        reconstruction: reconstructionArtifact(),
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.metrics?.intrinsicsFallbackUsed, 1);
  assert.equal(multiView.metrics?.extrinsicsFallbackUsed, 1);
  assert.equal(report.metrics.multiViewExtrinsicsFallbackUsed, 1);
  assert.ok(multiView.warnings?.includes("camera_intrinsics_fov_fallback_used"));
  assert.ok(
    multiView.warnings?.includes("camera_extrinsics_role_angle_fallback_used"),
  );
}

function testAdapterFailureFallback() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: false,
        primaryWhamFallbackUsed: true,
        primaryWhamFallbackReason: "multi_view_pose_extraction_failed",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: false,
        poseArtifacts: [missingPoseArtifact(0), missingPoseArtifact(1)],
        warnings: ["multi_view_pose_extraction_failed"],
        errorCode: "multi_view_pose_extraction_failed",
        errorMessage: "Multi-view pose detector adapter is not configured.",
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.reconstructionAvailable, false);
  assert.equal(
    multiView.primaryWhamFallbackReason,
    "multi_view_pose_extraction_failed",
  );
  assert.equal(multiView.poseExtraction?.status, "missing_pose_frames");
  assert.equal(
    multiView.poseExtraction?.poseFramesDevice0Status,
    "missing_pose_frames",
  );
  assert.equal(
    multiView.poseExtraction?.poseFramesDevice1Status,
    "missing_pose_frames",
  );
  assert.equal(multiView.poseExtraction?.poseDetectorSource, "rtmpose_mmpose");
  assert.equal(multiView.metrics?.missingPoseFrameRatio, 1);
  assert.equal("multiViewAverageKeypointConfidence" in report.metrics, false);
  assert.ok(multiView.warnings?.includes("multi_view_pose_extraction_failed"));
}

function testMetadataDiagnosticsAreReportedAdditively() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage(),
      multiViewDiagnostic: {
        reconstructionAvailable: false,
        captureMetadataDiagnostics: metadataDiagnostics(),
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.metadataCompleteness?.status, "partial");
  assert.deepEqual(multiView.availableTimestampFields, [
    "recordingStartedAt",
    "sync.clockOffsetMs",
  ]);
  assert.deepEqual(multiView.availableCameraMetadataFields, [
    "cameraId",
    "camera.intrinsics",
  ]);
  assert.equal(multiView.hasAudioTrack, false);
  assert.equal(multiView.hasIntrinsics, false);
  assert.equal(multiView.hasFrameTimestamps, false);
  assert.ok(
    multiView.missingMetadataWarnings?.includes(
      "metadata_audio_sync_unavailable",
    ),
  );
  assert.ok(
    multiView.warnings?.includes("metadata_camera_intrinsics_incomplete"),
  );
}

function testPoseExtractionMetricsAreReportedAdditively() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifact(),
        poseArtifacts: [
          perCameraPoseArtifact(0, { confidence: 0.9 }),
          perCameraPoseArtifact(1, { confidence: 0.8 }),
        ],
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.poseExtraction?.status, "ready");
  assert.equal(multiView.poseExtraction?.poseExtractionStatus, "ready");
  assert.equal(multiView.poseExtraction?.poseFramesDevice0Status, "ready");
  assert.equal(multiView.poseExtraction?.poseFramesDevice1Status, "ready");
  assert.ok(
    Math.abs((multiView.poseExtraction?.averageKeypointConfidence ?? 0) - 0.85) < 1e-9,
  );
  assert.ok(
    Math.abs((multiView.metrics?.averageKeypointConfidence ?? 0) - 0.85) < 1e-9,
  );
  assert.ok(
    Math.abs((report.metrics.multiViewAverageKeypointConfidence ?? 0) - 0.85) <
      1e-9,
  );
  assert.ok((multiView.metrics?.missingPoseFrameRatio ?? 1) > 0);
}

function testTriangulatedJointTrackMetricsAreReportedAdditively() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        multiViewConstraintsUsed: false,
        primaryWhamFallbackUsed: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifact(),
        jointTrack: jointTrackArtifact(),
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.jointTrackStatus, "diagnostic_only");
  assert.equal(multiView.finalAnimationSource, "primary_wham");
  assert.equal(multiView.primaryCameraFallbackUsed, true);
  assert.equal(multiView.reconstructionUsedForConstraints, false);
  assert.equal(multiView.metrics?.triangulatedLandmarkRatio, 0.8);
  assert.equal(multiView.metrics?.averageJointConfidence, 0.84);
  assert.equal(multiView.metrics?.occludedJointRatio, 0.1);
  assert.equal(multiView.metrics?.droppedJointRatio, 0.06);
  assert.equal(multiView.metrics?.temporalJitterBefore, 0.18);
  assert.equal(multiView.metrics?.temporalJitterAfter, 0.09);
  assert.equal(multiView.metrics?.temporalSmoothingGain, 0.5);
  assert.equal(report.metrics.multiViewAverageJointConfidence, 0.84);
  assert.equal(report.metrics.multiViewTemporalSmoothingGain, 0.5);
  assert.ok(multiView.warnings?.includes("joint_track_coverage_low"));
}

function testDualFitReportIsReportedAdditivelyWithoutChangingFinalSource() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        multiViewConstraintsUsed: false,
        primaryWhamFallbackUsed: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifact(),
        jointTrack: jointTrackArtifact(),
        dualFitReport: dualFitReportArtifact(),
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.dualFitStatus, "optimization_not_implemented");
  assert.equal(multiView.dualFitAcceptedAsFinal, false);
  assert.equal(multiView.optimizedBvhAvailable, false);
  assert.equal(multiView.finalAnimationSource, "primary_wham");
  assert.equal(multiView.primaryCameraFallbackUsed, true);
  assert.equal(multiView.reconstructionUsedForConstraints, false);
  assert.equal(multiView.metrics?.reprojectionLoss, 2.1);
  assert.equal(multiView.metrics?.boneLengthConsistencyScore, 0.96);
  assert.equal(multiView.metrics?.optimizedBvhAvailable, 0);
  assert.equal(report.metrics.multiViewReprojectionLoss, 2.1);
  assert.equal(report.metrics.multiViewBoneLengthConsistencyScore, 0.96);
  assert.equal(report.metrics.multiViewOptimizedBvhAvailable, 0);
  assert.equal("multiViewFittingTotalLoss" in report.metrics, false);
  assert.ok(multiView.warnings?.includes("dual_fit_optimizer_not_implemented"));
}

function testAcceptedDualFitReportSwitchesFinalSource() {
  const acceptedFitReport: DualFitReportArtifact = {
    ...dualFitReportArtifact({
      averageReprojectionErrorPxBefore: 2.1,
      temporalJitterAfter: 0.04,
    }),
    status: "ready",
    reason: "Accepted optimized dual-camera solve.",
    losses: {
      ...dualFitReportArtifact().losses,
      initializationLoss: 0.03,
      totalLoss: 0.12,
    },
    metrics: {
      ...dualFitReportArtifact().metrics,
      averageReprojectionErrorPxAfter: 1.8,
      reprojectionImprovementRatio: 0.14,
      reliableConstraintRatio: 0.72,
      optimizedMotionDelta: 0.03,
      acceptedAsFinalAnimation: true,
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
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        multiViewConstraintsUsed: true,
        primaryWhamFallbackUsed: false,
        primaryWhamFallbackReason: "none",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifact(),
        jointTrack: jointTrackArtifact(),
        dualFitReport: acceptedFitReport,
      },
    },
  );
  const multiView = assertMultiView(report);

  assert.equal(multiView.finalAnimationSource, "true_dual_solve");
  assert.equal(multiView.primaryCameraFallbackUsed, false);
  assert.equal(multiView.primaryWhamFallbackUsed, false);
  assert.equal(multiView.reconstructionUsedForConstraints, true);
  assert.equal(multiView.trueDualSolveAvailable, true);
  assert.equal(multiView.dualFitAcceptedAsFinal, true);
  assert.equal(multiView.optimizedBvhAvailable, true);
  assert.equal(multiView.optimizedSolvedMotionAvailable, true);
  assert.equal(multiView.metrics?.optimizedBvhAvailable, 1);
  assert.equal(multiView.metrics?.optimizedSolvedMotionAvailable, 1);
  assert.equal(multiView.metrics?.reliableConstraintRatio, 0.72);
  assert.equal(multiView.metrics?.optimizedMotionDelta, 0.03);
  assert.equal(report.metrics.multiViewOptimizedBvhAvailable, 1);
  assert.equal(report.metrics.multiViewOptimizedSolvedMotionAvailable, 1);
  assert.equal(report.metrics.multiViewReliableConstraintRatio, 0.72);
  assert.equal(report.metrics.multiViewOptimizedMotionDelta, 0.03);
  assert.equal(
    multiView.warnings?.includes("single_camera_solver_fallback_used"),
    false,
  );
}


function testNonFiniteMetricsAreDropped() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport({
          syncConfidence: Number.POSITIVE_INFINITY,
          averageTimeDeltaMs: Number.NaN,
          offsetMs: Number.POSITIVE_INFINITY,
        }),
        cameraCalibration: cameraCalibration({
          score: Number.POSITIVE_INFINITY,
          fallbackIntrinsics: true,
        }),
        reconstruction: reconstructionArtifact({
          syncOffsetMs: Number.POSITIVE_INFINITY,
          syncConfidence: Number.NaN,
          averageTimeDeltaMs: Number.NaN,
          reprojectionErrorPx: Number.POSITIVE_INFINITY,
          reprojectionP95Px: Number.NEGATIVE_INFINITY,
          triangulatedLandmarkRatio: Number.NaN,
          calibrationQualityScore: Number.POSITIVE_INFINITY,
        }),
      },
    },
  );
  const metrics = assertMultiView(report).metrics;

  assert.ok(metrics);
  assert.equal("syncOffsetMs" in metrics, false);
  assert.equal("syncConfidence" in metrics, false);
  assert.equal("averageTimeDeltaMs" in metrics, false);
  assert.equal("reprojectionErrorPx" in metrics, false);
  assert.equal("reprojectionP95Px" in metrics, false);
  assert.equal("triangulatedLandmarkRatio" in metrics, false);
  assert.equal("calibrationQualityScore" in metrics, false);
  assert.equal(metrics.intrinsicsFallbackUsed, 1);
}

function testNoFakeMultiViewQualityGainWhenUnavailable() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifactWithoutQualityGain(),
      },
    },
  );
  const metrics = assertMultiView(report).metrics ?? {};

  assert.equal("multiViewQualityGain" in metrics, false);
  assert.equal("multiViewQualityGain" in report.metrics, false);
}

function testReportRemainsParseableByExistingMobileShape() {
  const report = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifact(),
      },
    },
  );
  const parsed = JSON.parse(JSON.stringify(report)) as {
    schema: string;
    metrics: Record<string, number>;
    multiView?: {
      reconstructionAvailable: boolean;
      reconstructionUsedForConstraints: boolean;
      primaryWhamFallbackUsed: boolean;
      metrics?: {
        matchedFrameCount?: number;
        reprojectionErrorPx?: number;
        triangulatedLandmarkRatio?: number;
      };
    };
  };

  assert.equal(parsed.schema, "mocap.quality_report.v1");
  assert.equal(parsed.multiView?.reconstructionAvailable, true);
  assert.equal(parsed.multiView?.reconstructionUsedForConstraints, false);
  assert.equal(parsed.multiView?.primaryWhamFallbackUsed, true);
  assert.equal(parsed.multiView?.metrics?.matchedFrameCount, 10);
  assert.equal(parsed.multiView?.metrics?.reprojectionErrorPx, 2.3);
}

function testScoreUnchangedWhenMultiViewSectionIsAdded() {
  const baseReport = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
  );
  const multiViewReport = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    baseValidation(),
    "dual_camera",
    {
      whamInputUsage: whamUsage({
        multiViewReconstructionAvailable: true,
        primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
      }),
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: syncReport(),
        cameraCalibration: cameraCalibration(),
        reconstruction: reconstructionArtifact(),
      },
    },
  );

  assert.equal(multiViewReport.score, baseReport.score);
  assert.equal(multiViewReport.grade, baseReport.grade);
}

testSingleCameraBackwardCompatible();
testDualFeatureDisabledFallback();
testDualDiagnosticReconstructionSuccess();
testMissingCalibrationReportsCalibrationFailure();
testApproximateCalibrationReportsFallbackUsage();
testAdapterFailureFallback();
testMetadataDiagnosticsAreReportedAdditively();
testPoseExtractionMetricsAreReportedAdditively();
testTriangulatedJointTrackMetricsAreReportedAdditively();
testDualFitReportIsReportedAdditivelyWithoutChangingFinalSource();
testAcceptedDualFitReportSwitchesFinalSource();
testNonFiniteMetricsAreDropped();
testNoFakeMultiViewQualityGainWhenUnavailable();
testReportRemainsParseableByExistingMobileShape();
testScoreUnchangedWhenMultiViewSectionIsAdded();
console.log("Quality report multi-view tests passed");
