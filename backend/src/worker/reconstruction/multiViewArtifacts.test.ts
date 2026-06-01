import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  CalibrationObservationsArtifact,
  CaptureVolumeArtifact,
  DualFitReportArtifact,
  Matrix3x3,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  ProjectionMatrix3x4,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
  Vector3,
} from "../types";
import {
  type MultiViewArtifactFormat,
  persistMultiViewArtifacts,
  poseArtifactStorageKey,
} from "./multiViewArtifacts";

const TAKE_ID = "take_multiview_artifacts";
const JOB_ID = "job_multiview_artifacts";
const IDENTITY: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PROJECTION: ProjectionMatrix3x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const ZERO: Vector3 = [0, 0, 0];

type UploadCall = {
  key: string;
  value: unknown;
};

type ExportCall = {
  jobId: string;
  format: MultiViewArtifactFormat;
  artifactName: string;
  storageKey: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
};

function poseArtifact(deviceIndex: number): PerCameraPoseArtifact {
  return {
    schema: "mocap.pose_frames_device.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    cameraId: `camera_${deviceIndex}`,
    deviceIndex,
    deviceRole: deviceIndex === 0 ? "front" : "right",
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/device_${deviceIndex}.mov`,
      normalizedStorageKey: `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/device_${deviceIndex}.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 1000,
    },
    detector: {
      name: "fixture_pose_detector",
      version: "fixture_v1",
      landmarkSchema: "body_33",
    },
    frames: [],
    quality: {
      frameCount: 10,
      detectedFrameCount: 10,
      missingFrameCount: 0,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 0.95,
    },
    warnings: [],
  };
}

function syncReport(): MultiViewSyncReport {
  return {
    schema: "mocap.multiview_sync.v1",
    schemaVersion: "mocap.multi_view_sync.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    syncMethod: "frame_presentation_timestamp_sync",
    referenceDeviceId: "camera_0",
    targetDeviceIds: ["camera_1"],
    referenceDeviceIndex: 0,
    devices: [0, 1].map((deviceIndex) => ({
      deviceIndex,
      offsetMs: deviceIndex === 0 ? 0 : 11,
      confidence: 0.94,
      method: "frame_presentation_timestamp_sync",
      matchedFrameCount: 10,
      droppedFrameCount: 1,
      averageTimeDeltaMs: 3.5,
      maxTimeDeltaMs: 7,
    })),
    matchedFrames: [],
    framePairs: [],
    matchedFrameCount: 10,
    averageTimeDeltaMs: 3.5,
    p95TimeDeltaMs: 7,
    syncConfidence: 0.94,
    droppedFrameCount: 1,
    clockOffsetMs: null,
    manualOffsetMs: null,
    status: "ready",
    metrics: {
      matchedFrameCount: 10,
      droppedFrameCount: 1,
      averageTimeDeltaMs: 3.5,
      maxTimeDeltaMs: 7,
      p95TimeDeltaMs: 7,
      syncConfidence: 0.94,
    },
    warnings: [],
  };
}

function calibrationObservations(): CalibrationObservationsArtifact {
  return {
    schemaVersion: "mocap.calibration_observations.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sessionId: "session_multiview_artifacts",
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

function cameraCalibration(): CameraCalibrationArtifact {
  return {
    schema: "mocap.camera_calibration.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "metadata_and_fov_fallback",
    intrinsicsSource: "capture_metadata_or_fov",
    devices: [0, 1].map((deviceIndex) => ({
      deviceIndex,
      deviceRole: deviceIndex === 0 ? "front" : "right",
      intrinsic: IDENTITY,
      rotation: IDENTITY,
      translation: ZERO,
      projection: PROJECTION,
      intrinsicsSource:
        deviceIndex === 1 ? "fov_fallback" : "capture_metadata",
    })),
    quality: {
      score: 0.82,
      averageReprojectionErrorPx: 2,
      baseline: 1,
      convergenceAngle: 30,
    },
    warnings: ["camera_intrinsics_fov_fallback_used"],
  };
}

function captureVolume(): CaptureVolumeArtifact {
  return {
    schemaVersion: "mocap.capture_volume.v1",
    volumeId: TAKE_ID,
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sessionId: "session_multiview_artifacts",
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

function reconstruction(source: "dual_camera" | "multi_view"): MultiViewReconstructionArtifact {
  return {
    schema: "mocap.multiview_reconstruction.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source,
    frameCount: 0,
    landmarkSchema: "body_33",
    frames: [],
    metrics: {
      syncOffsetMs: 11,
      syncConfidence: 0.94,
      matchedFrameCount: 10,
      droppedFrameCount: 1,
      averageTimeDeltaMs: 3.5,
      reprojectionErrorPx: 2.1,
      reprojectionP95Px: 4.8,
      triangulatedLandmarkRatio: 0.78,
      fallbackLandmarkRatio: 0.22,
      calibrationQualityScore: 0.82,
      intrinsicsFallbackUsed: 1,
      multiViewQualityGain: 0.5,
    },
    warnings: [],
  };
}

function triangulatedJointTrack(): TriangulatedJointTrackArtifact {
  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    status: "ready",
    coordinateSystem: "right_handed_y_up",
    jointSet: "body33",
    cameraIds: ["camera_0", "camera_1"],
    frameCount: 10,
    trackedFrameCount: 9,
    metrics: {
      matchedFrameCount: 10,
      triangulatedJointRatio: 0.78,
      averageReprojectionErrorPx: 2.1,
      reprojectionP95Px: 4.8,
      temporalJitterAfter: 0.04,
    },
    frames: [],
    warnings: [],
  };
}

function dualFitReport(): DualFitReportArtifact {
  return {
    schema: "mocap.dual_fit_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    status: "optimization_not_implemented",
    reason:
      "Phase 5A evaluates dual fitting readiness without replacing primary WHAM.",
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
      boneLengthLoss: null,
      jointLimitLoss: null,
      footContactLoss: null,
      temporalSmoothnessLoss: 0.04,
      totalLoss: null,
    },
    metrics: {
      triangulatedJointRatio: 0.78,
      averageReprojectionErrorPxBefore: 2.1,
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
        value: 0.78,
        threshold: 0.65,
        severity: "blocking",
        reason: null,
      },
      {
        name: "joint_limit_violations",
        passed: false,
        value: null,
        threshold: 0,
        severity: "warning",
        reason: "Joint limit evaluation is not implemented in Phase 5A.",
      },
    ],
    acceptedAsFinalAnimation: false,
    finalAnimationSourceCandidate: "primary_wham",
    artifactRefs: {},
    warnings: ["dual_fit_optimizer_not_implemented"],
  };
}

function optimizedSolvedMotion(): SolvedMotionArtifact {
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
    frameCount: 1,
    durationMs: 33,
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        rootTranslation: [0.1, 0, 0],
        joints: {},
      },
    ],
    validation: {
      ok: true,
      warnings: ["dual_camera_constrained_skeleton_adjustment"],
      errors: [],
    },
    optimizedFrom: {
      source: "primary_wham",
      method: "dual_camera_constrained_skeleton_adjustment",
      constraintsApplied: 3,
      acceptedAsFinalAnimation: true,
      warnings: ["This is not full SMPL optimization."],
    },
  };
}

function createMocks(input?: {
  failUploadKey?: string;
  failExportArtifactName?: string;
}) {
  const uploadCalls: UploadCall[] = [];
  const exportCalls: ExportCall[] = [];

  return {
    uploadCalls,
    exportCalls,
    storage: {
      async uploadJson(key: string, value: unknown) {
        uploadCalls.push({ key, value });
        if (key === input?.failUploadKey) {
          throw new Error(`upload failed: ${key}`);
        }
        return {
          storageKey: key,
          sizeBytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
        };
      },
    },
    exportsRepository: {
      async createExportFile(record: ExportCall) {
        exportCalls.push(record);
        if (record.artifactName === input?.failExportArtifactName) {
          throw new Error(`export failed: ${record.artifactName}`);
        }
        return record;
      },
    },
  };
}

async function testDualSuccessPersistence() {
  const mocks = createMocks();
  const result = await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts: [poseArtifact(0), poseArtifact(1)],
    syncReport: syncReport(),
    calibrationObservations: calibrationObservations(),
    cameraCalibration: cameraCalibration(),
    captureVolume: captureVolume(),
    reconstruction: reconstruction("dual_camera"),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.deepEqual(
    mocks.uploadCalls.map((call) => call.key),
    [
      `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_0.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_1.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/multi_view_sync.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/calibration_observations.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/camera_calibration.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/capture_volume.json`,
      `takes/${TAKE_ID}/jobs/${JOB_ID}/dual_reconstruction.json`,
    ],
  );
  assert.deepEqual(
    mocks.exportCalls.map((call) => [call.format, call.artifactName]),
    [
      ["pose_frames_device_json", "pose_frames_device_0_json"],
      ["pose_frames_device_json", "pose_frames_device_1_json"],
      ["multi_view_sync_json", "multi_view_sync_json"],
      ["calibration_observations_json", "calibration_observations_json"],
      ["camera_calibration_json", "camera_calibration_json"],
      ["capture_volume_json", "capture_volume_json"],
      ["dual_reconstruction_json", "dual_reconstruction_json"],
    ],
  );
  assert.equal(result.artifacts.length, 7);
  assert.equal(result.warnings.length, 0);
  assert.equal(mocks.exportCalls[0].metadata?.deviceIndex, 0);
  assert.equal(mocks.exportCalls[1].metadata?.deviceIndex, 1);
  assert.equal(mocks.exportCalls[3].metadata?.targetType, "apriltag");
  assert.equal(mocks.exportCalls[3].metadata?.detectorSource, "fixture");
  assert.equal(mocks.exportCalls[3].metadata?.observationCount, 1);
  assert.equal(mocks.exportCalls[3].metadata?.averageConfidence, 0.9);
  assert.equal(mocks.exportCalls[5].metadata?.status, "ready");
  assert.equal(mocks.exportCalls[5].metadata?.validCameraCount, 2);
  assert.notEqual(
    mocks.exportCalls[0].artifactName,
    mocks.exportCalls[1].artifactName,
  );
}

async function testProMultiViewSuccessPersistence() {
  const mocks = createMocks();
  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "pro_4_camera",
    poseArtifacts: [0, 1, 2, 3].map(poseArtifact),
    syncReport: syncReport(),
    cameraCalibration: cameraCalibration(),
    reconstruction: reconstruction("multi_view"),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.ok(
    mocks.uploadCalls.some((call) =>
      call.key.endsWith("/multi_view_reconstruction.json"),
    ),
  );
  assert.ok(
    mocks.exportCalls.some(
      (call) =>
        call.format === "multi_view_reconstruction_json" &&
        call.artifactName === "multi_view_reconstruction_json",
    ),
  );
  assert.equal(
    mocks.exportCalls.filter((call) => call.format === "pose_frames_device_json")
      .length,
    4,
  );
}

async function testTriangulatedJointTrackArtifactPersistence() {
  const mocks = createMocks();
  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    triangulatedJointTrack: triangulatedJointTrack(),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(
    mocks.uploadCalls[0].key,
    `takes/${TAKE_ID}/jobs/${JOB_ID}/triangulated_joint_track.json`,
  );
  assert.equal(mocks.exportCalls[0].format, "triangulated_joint_track_json");
  assert.equal(
    mocks.exportCalls[0].artifactName,
    "triangulated_joint_track_json",
  );
  assert.equal(mocks.exportCalls[0].metadata?.status, "ready");
  assert.equal(mocks.exportCalls[0].metadata?.trackedFrameCount, 9);
  assert.equal(mocks.exportCalls[0].metadata?.temporalJitterAfter, 0.04);
}

async function testDualFitReportArtifactPersistence() {
  const mocks = createMocks();
  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    dualFitReport: dualFitReport(),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(
    mocks.uploadCalls[0].key,
    `takes/${TAKE_ID}/jobs/${JOB_ID}/dual_fit_report.json`,
  );
  assert.equal(mocks.exportCalls[0].format, "dual_fit_report_json");
  assert.equal(mocks.exportCalls[0].artifactName, "dual_fit_report_json");
  assert.equal(mocks.exportCalls[0].metadata?.status, "optimization_not_implemented");
  assert.equal(mocks.exportCalls[0].metadata?.acceptedAsFinalAnimation, false);
  assert.equal(
    mocks.exportCalls[0].metadata?.finalAnimationSourceCandidate,
    "primary_wham",
  );
  assert.equal(mocks.exportCalls[0].metadata?.blockingFailedGateCount, 0);
  assert.equal(mocks.exportCalls[0].metadata?.temporalJitterAfter, 0.04);
}

async function testOptimizedSolvedMotionArtifactPersistence() {
  const mocks = createMocks();
  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    optimizedSolvedMotion: optimizedSolvedMotion(),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(
    mocks.uploadCalls[0].key,
    `takes/${TAKE_ID}/jobs/${JOB_ID}/optimized_solved_motion.json`,
  );
  assert.equal(mocks.exportCalls[0].format, "optimized_solved_motion_json");
  assert.equal(
    mocks.exportCalls[0].artifactName,
    "optimized_solved_motion_json",
  );
  assert.equal(mocks.exportCalls[0].metadata?.frameCount, 1);
  assert.equal(
    mocks.exportCalls[0].metadata?.method,
    "dual_camera_constrained_skeleton_adjustment",
  );
  assert.equal(mocks.exportCalls[0].metadata?.acceptedAsFinalAnimation, true);
}

async function testMissingOptionalArtifacts() {
  const mocks = createMocks();
  const result = await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    reconstruction: reconstruction("dual_camera"),
    storage: mocks.storage,
    exportsRepository: mocks.exportsRepository,
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(mocks.exportCalls.length, 1);
  assert.equal(mocks.exportCalls[0].artifactName, "dual_reconstruction_json");
}

async function testStorageUploadFailureDoesNotCreateExportRecord() {
  const failKey = `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_0.json`;
  const mocks = createMocks({ failUploadKey: failKey });

  await assert.rejects(
    () =>
      persistMultiViewArtifacts({
        takeId: TAKE_ID,
        jobId: JOB_ID,
        source: "dual_camera",
        poseArtifacts: [poseArtifact(0)],
        storage: mocks.storage,
        exportsRepository: mocks.exportsRepository,
      }),
    /upload failed/,
  );
  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(mocks.exportCalls.length, 0);
}

async function testExportRecordFailureIsExplicit() {
  const mocks = createMocks({
    failExportArtifactName: "dual_reconstruction_json",
  });

  await assert.rejects(
    () =>
      persistMultiViewArtifacts({
        takeId: TAKE_ID,
        jobId: JOB_ID,
        source: "dual_camera",
        reconstruction: reconstruction("dual_camera"),
        storage: mocks.storage,
        exportsRepository: mocks.exportsRepository,
      }),
    /export failed/,
  );
  assert.equal(mocks.uploadCalls.length, 1);
  assert.equal(mocks.exportCalls.length, 1);
}

function testArtifactKeyDeterminism() {
  const first = poseArtifactStorageKey({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    deviceIndex: 2,
  });
  const second = poseArtifactStorageKey({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    deviceIndex: 2,
  });

  assert.equal(first, second);
  assert.equal(
    first,
    `takes/${TAKE_ID}/jobs/${JOB_ID}/pose_frames_device_2.json`,
  );
}

async function main() {
  await testDualSuccessPersistence();
  await testProMultiViewSuccessPersistence();
  await testTriangulatedJointTrackArtifactPersistence();
  await testDualFitReportArtifactPersistence();
  await testOptimizedSolvedMotionArtifactPersistence();
  await testMissingOptionalArtifacts();
  await testStorageUploadFailureDoesNotCreateExportRecord();
  await testExportRecordFailureIsExplicit();
  testArtifactKeyDeterminism();
  console.log("multi-view artifact persistence tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
