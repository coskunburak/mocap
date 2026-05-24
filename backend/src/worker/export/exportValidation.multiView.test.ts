import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  CleanupReport,
  Matrix3x3,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PoseFramesArtifact,
  ProjectionMatrix3x4,
  SolvedMotionArtifact,
  Vector3,
  WhamInputUsageMetrics,
  WhamInputUsageSource,
} from "../types";
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
    referenceDeviceIndex: 0,
    devices: [
      {
        deviceIndex: 0,
        offsetMs: 0,
        confidence: 1,
        method: "video_timestamps",
        matchedFrameCount: input?.matchedFrameCount ?? 10,
        droppedFrameCount: 0,
        averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
        maxTimeDeltaMs: 8,
      },
      {
        deviceIndex: 1,
        offsetMs: input?.offsetMs ?? 12,
        confidence: input?.syncConfidence ?? 0.92,
        method: "video_timestamps",
        matchedFrameCount: input?.matchedFrameCount ?? 10,
        droppedFrameCount: input?.droppedFrameCount ?? 2,
        averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
        maxTimeDeltaMs: 8,
      },
    ],
    matchedFrames: [],
    metrics: {
      matchedFrameCount: input?.matchedFrameCount ?? 10,
      droppedFrameCount: input?.droppedFrameCount ?? 2,
      averageTimeDeltaMs: input?.averageTimeDeltaMs ?? 4.2,
      maxTimeDeltaMs: 8,
      syncConfidence: input?.syncConfidence ?? 0.92,
    },
    warnings: ["sync_confidence_low"],
  };
}

function cameraCalibration(input?: {
  score?: number;
  fallbackIntrinsics?: boolean;
}): CameraCalibrationArtifact {
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
    })),
    quality: {
      score: input?.score ?? 0.87,
      averageReprojectionErrorPx: 1.5,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings: input?.fallbackIntrinsics
      ? ["camera_intrinsics_fov_fallback_used"]
      : [],
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
        cameraCalibration: cameraCalibration({ fallbackIntrinsics: true }),
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
  assert.equal(multiView.metrics?.reprojectionErrorPx, 2.3);
  assert.equal(multiView.metrics?.triangulatedLandmarkRatio, 0.76);
  assert.equal(multiView.metrics?.calibrationQualityScore, 0.87);
  assert.equal(multiView.metrics?.intrinsicsFallbackUsed, 1);
  assert.ok(multiView.warnings?.includes("reprojection_error_high"));
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
  assert.ok(multiView.warnings?.includes("multi_view_pose_extraction_failed"));
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
testAdapterFailureFallback();
testNonFiniteMetricsAreDropped();
testScoreUnchangedWhenMultiViewSectionIsAdded();
console.log("Quality report multi-view tests passed");
