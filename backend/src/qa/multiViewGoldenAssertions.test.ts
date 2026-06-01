import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  CleanupReport,
  Matrix3x3,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  ProjectionMatrix3x4,
  SmplParametersArtifact,
  SolvedMotionArtifact,
  Vector3,
} from "../worker/types";
import { buildQualityReport } from "../worker/export/exportValidation";
import { runDualCameraFittingFoundation } from "../worker/fitting/dualCameraFitting";
import { buildCameraCalibrationArtifact } from "../worker/reconstruction/cameraCalibration";
import { buildMultiViewSyncReport } from "../worker/reconstruction/frameSync";
import { buildMultiViewReconstructionArtifact } from "../worker/reconstruction/multiViewReconstruction";
import { buildTriangulatedJointTrackArtifact } from "../worker/reconstruction/triangulatedJointTrack";
import { persistMultiViewArtifacts } from "../worker/reconstruction/multiViewArtifacts";
import { buildPerCameraPoseArtifact } from "../worker/pose/poseExtraction";
import { buildWhamInputUsageMetrics } from "../worker/whamInputUsage";
import { projectPoint } from "../worker/reconstruction/triangulation";

const GOLDEN_THRESHOLDS = {
  minMatchedFrameCount: 1,
  minTriangulatedLandmarkRatio: 0.5,
  maxReprojectionErrorPx: 10,
  minCalibrationQualityScore: 0,
} as const;

const TAKE_ID = "take_multiview_golden";
const JOB_ID = "job_multiview_golden";
const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SYNTHETIC_POINT: Vector3 = [0.2, 0.1, 4];

function basePose(): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/device_0.mov`,
      normalizedStorageKey: `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 1000,
    },
    detector: {
      name: "wham_internal_vitpose",
      version: "fixture_v1",
      landmarkSchema: "wham_internal",
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

function smplParameters(): SmplParametersArtifact {
  return {
    schema: "mocap.smpl_parameters.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "wham",
    model: { family: "SMPL" },
    fps: 30,
    frameCount: 30,
    bodyPose: [],
    globalOrient: [],
    betas: [],
    translation: [],
    smplify: {
      enabled: true,
      status: "completed",
    },
    frames: [],
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
    smpl: smplParameters(),
  };
}

function validFittingWhamInitialization(): SolvedMotionArtifact {
  return {
    ...baseSolved(),
    frameCount: 1,
    durationMs: 33,
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        rootTranslation: [0, 0, 0],
        joints: {},
      },
    ],
    smpl: {
      ...smplParameters(),
      frameCount: 1,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          bodyPose: [],
          globalOrient: [0, 0, 0],
          translation: [0, 0, 0],
        },
      ],
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

function validation() {
  return {
    ok: true,
    errors: [],
    warnings: [],
    blenderOk: true,
    blenderSkipped: false,
  };
}

function calibration(
  devices: readonly {
    deviceIndex: number;
    deviceRole: string;
    translation: Vector3;
  }[],
): CameraCalibrationArtifact {
  return buildCameraCalibrationArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    devices: devices.map((device) => ({
      deviceIndex: device.deviceIndex,
      deviceRole: device.deviceRole,
      imageWidth: 1280,
      imageHeight: 720,
      intrinsics: {
        matrix: IDENTITY_INTRINSIC,
      },
      extrinsics: {
        rotation: IDENTITY_ROTATION,
        translation: device.translation,
      },
    })),
  });
}

function poseArtifact(input: {
  deviceIndex: number;
  deviceRole: string;
  projection: ProjectionMatrix3x4;
}): PerCameraPoseArtifact {
  const point = projectPoint({
    projection: input.projection,
    point: SYNTHETIC_POINT,
  });
  return buildPerCameraPoseArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    cameraId: `camera_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/device_${input.deviceIndex}.mov`,
      normalizedStorageKey: `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/device_${input.deviceIndex}.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 33,
    },
    detectorResult: {
      detector: {
        name: "fixture_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "body_33",
      },
      expectedFrameCount: 1,
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          keypoints2d: [point],
          confidence: [0.95],
          poseConfidence: 0.95,
        },
      ],
    },
  });
}

function dualFixture() {
  const cameraCalibration = calibration([
    { deviceIndex: 0, deviceRole: "front", translation: [0, 0, 0] },
    { deviceIndex: 1, deviceRole: "right", translation: [-1, 0, 0] },
  ]);
  const poseArtifacts = cameraCalibration.devices.map((camera) =>
    poseArtifact({
      deviceIndex: camera.deviceIndex,
      deviceRole: camera.deviceRole,
      projection: camera.projection,
    }),
  );
  const syncReport = buildMultiViewSyncReport({ poseArtifacts });
  const reconstruction = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: cameraCalibration,
    source: "dual_camera",
  });
  const jointTrack = buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    syncReport,
    cameraCalibration,
    options: { smoothingWindowFrames: 1 },
  });
  const dualFitReport = runDualCameraFittingFoundation({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    whamInitialization: validFittingWhamInitialization(),
    jointTrack,
    poseArtifacts,
    cameraCalibration,
  });
  return {
    cameraCalibration,
    poseArtifacts,
    syncReport,
    reconstruction,
    jointTrack,
    dualFitReport,
  };
}

function proFixture() {
  const cameraCalibration = calibration([
    { deviceIndex: 0, deviceRole: "front", translation: [0, 0, 0] },
    { deviceIndex: 1, deviceRole: "right", translation: [-1, 0, 0] },
    { deviceIndex: 2, deviceRole: "back", translation: [0, -1, 0] },
    { deviceIndex: 3, deviceRole: "left", translation: [1, 0, 0] },
  ]);
  const poseArtifacts = cameraCalibration.devices.map((camera) =>
    poseArtifact({
      deviceIndex: camera.deviceIndex,
      deviceRole: camera.deviceRole,
      projection: camera.projection,
    }),
  );
  const syncReport = buildMultiViewSyncReport({ poseArtifacts });
  const reconstruction = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: cameraCalibration,
    source: "multi_view",
  });
  return {
    cameraCalibration,
    poseArtifacts,
    syncReport,
    reconstruction,
    jointTrack: undefined,
    dualFitReport: undefined,
  };
}

function assertGoldenMetrics(metrics: {
  matchedFrameCount: number;
  triangulatedLandmarkRatio: number;
  reprojectionErrorPx: number;
  calibrationQualityScore: number;
}) {
  assert.ok(metrics.matchedFrameCount >= GOLDEN_THRESHOLDS.minMatchedFrameCount);
  assert.ok(
    metrics.triangulatedLandmarkRatio >=
      GOLDEN_THRESHOLDS.minTriangulatedLandmarkRatio,
  );
  assert.ok(metrics.reprojectionErrorPx <= GOLDEN_THRESHOLDS.maxReprojectionErrorPx);
  assert.ok(Number.isFinite(metrics.calibrationQualityScore));
  assert.ok(
    metrics.calibrationQualityScore >=
      GOLDEN_THRESHOLDS.minCalibrationQualityScore,
  );
}

async function persistFixture(input: ReturnType<typeof dualFixture | typeof proFixture>, source: "dual_camera" | "pro_4_camera") {
  const exports: Array<{ format: string; artifactName: string; storageKey: string }> = [];
  const uploads: string[] = [];
  await persistMultiViewArtifacts({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source,
    poseArtifacts: input.poseArtifacts,
    syncReport: input.syncReport,
    cameraCalibration: input.cameraCalibration,
    triangulatedJointTrack: input.jointTrack,
    dualFitReport: input.dualFitReport,
    reconstruction: input.reconstruction,
    storage: {
      async uploadJson(key) {
        uploads.push(key);
        return { storageKey: key, sizeBytes: 1 };
      },
    },
    exportsRepository: {
      async createExportFile(record) {
        exports.push({
          format: record.format,
          artifactName: record.artifactName,
          storageKey: record.storageKey,
        });
      },
    },
  });
  return { exports, uploads };
}

async function testDualSyntheticGolden() {
  const fixture = dualFixture();
  const whamInputUsage = buildWhamInputUsageMetrics({
    source: "dual_camera",
    selectedVideos: [
      { deviceIndex: 0, storageKey: `takes/${TAKE_ID}/original/device_0.mov` },
      { deviceIndex: 1, storageKey: `takes/${TAKE_ID}/original/device_1.mov` },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: true,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
  });
  const quality = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    validation(),
    "dual_camera",
    {
      whamInputUsage,
      multiViewDiagnostic: {
        reconstructionAvailable: true,
        syncReport: fixture.syncReport,
        cameraCalibration: fixture.cameraCalibration,
        reconstruction: fixture.reconstruction,
        jointTrack: fixture.jointTrack,
        dualFitReport: fixture.dualFitReport,
      },
    },
  );

  assert.ok(quality.multiView);
  assert.equal(quality.multiView.reconstructionAvailable, true);
  assert.equal(quality.multiView.reconstructionUsedForConstraints, false);
  assert.equal(quality.multiView.primaryWhamFallbackUsed, true);
  assert.equal(quality.multiView.jointTrackStatus, "ready");
  assert.equal(quality.multiView.dualFitStatus, "optimization_not_implemented");
  assert.equal(quality.multiView.dualFitAcceptedAsFinal, false);
  assert.equal(quality.multiView.optimizedBvhAvailable, false);
  assert.equal(
    quality.multiView.primaryWhamFallbackReason,
    "multi_view_reconstruction_diagnostic_only",
  );
  assertGoldenMetrics({
    matchedFrameCount: quality.multiView.metrics?.matchedFrameCount ?? 0,
    triangulatedLandmarkRatio:
      quality.multiView.metrics?.triangulatedLandmarkRatio ?? 0,
    reprojectionErrorPx: quality.multiView.metrics?.reprojectionErrorPx ?? Infinity,
    calibrationQualityScore:
      quality.multiView.metrics?.calibrationQualityScore ?? NaN,
  });
}

async function testDualExportArtifacts() {
  const persisted = await persistFixture(dualFixture(), "dual_camera");
  const artifactNames = persisted.exports.map((item) => item.artifactName);

  assert.deepEqual(artifactNames, [
    "pose_frames_device_0_json",
    "pose_frames_device_1_json",
    "multi_view_sync_json",
    "camera_calibration_json",
    "triangulated_joint_track_json",
    "dual_fit_report_json",
    "dual_reconstruction_json",
  ]);
  assert.equal(
    persisted.exports.filter((item) => item.format === "pose_frames_device_json")
      .length,
    2,
  );
}

async function testProFourCameraGolden() {
  const fixture = proFixture();
  const persisted = await persistFixture(fixture, "pro_4_camera");
  const artifactNames = persisted.exports.map((item) => item.artifactName);

  assert.ok(artifactNames.includes("multi_view_reconstruction_json"));
  for (const deviceIndex of [0, 1, 2, 3]) {
    assert.ok(artifactNames.includes(`pose_frames_device_${deviceIndex}_json`));
  }
  assert.equal(new Set(artifactNames).size, artifactNames.length);
  assert.equal(
    persisted.exports.filter((item) => item.format === "pose_frames_device_json")
      .length,
    4,
  );
  assertGoldenMetrics(fixture.reconstruction.metrics);
}

function testFallbackGolden() {
  const whamInputUsage = buildWhamInputUsageMetrics({
    source: "dual_camera",
    selectedVideos: [
      { deviceIndex: 0, storageKey: `takes/${TAKE_ID}/original/device_0.mov` },
      { deviceIndex: 1, storageKey: `takes/${TAKE_ID}/original/device_1.mov` },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "multi_view_reconstruction_disabled",
  });
  const quality = buildQualityReport(
    basePose(),
    baseSolved(),
    baseCleanup(),
    validation(),
    "dual_camera",
    {
      whamInputUsage,
      multiViewDiagnostic: {
        reconstructionAvailable: false,
        warnings: ["multi_view_reconstruction_disabled"],
        errorCode: "multi_view_reconstruction_disabled",
      },
    },
  );

  assert.ok(quality.multiView);
  assert.equal(quality.multiView.reconstructionAvailable, false);
  assert.equal(quality.multiView.reconstructionUsedForConstraints, false);
  assert.equal(quality.multiView.primaryWhamFallbackUsed, true);
  assert.equal(
    quality.multiView.primaryWhamFallbackReason,
    "multi_view_reconstruction_disabled",
  );
  assert.equal(quality.multiView.whamInputUsage?.multiViewConstraintsUsed, false);
}

async function main() {
  await testDualSyntheticGolden();
  await testDualExportArtifacts();
  await testProFourCameraGolden();
  testFallbackGolden();
  console.log("multi-view golden assertion tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
