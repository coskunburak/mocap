import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  Matrix3x3,
  PerCameraPoseArtifact,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";
import { buildPerCameraPoseArtifact } from "../pose/poseExtraction";
import { buildCameraCalibrationArtifact } from "./cameraCalibration";
import { buildMultiViewSyncReport } from "./frameSync";
import {
  MultiViewReconstructionError,
  buildMultiViewReconstructionArtifact,
  validateMultiViewReconstructionArtifact,
} from "./multiViewReconstruction";
import { projectPoint } from "./triangulation";

const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SYNTHETIC_POINT: Vector3 = [0.2, 0.1, 4];

function buildExplicitCalibration(
  devices: readonly {
    deviceIndex: number;
    deviceRole: string;
    translation: Vector3;
  }[],
): CameraCalibrationArtifact {
  return buildCameraCalibrationArtifact({
    takeId: "take_reconstruction",
    jobId: "job_reconstruction",
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

function buildFallbackCalibration(): CameraCalibrationArtifact {
  return buildCameraCalibrationArtifact({
    takeId: "take_reconstruction",
    jobId: "job_reconstruction",
    devices: [
      {
        deviceIndex: 0,
        deviceRole: "front",
        imageWidth: 1280,
        imageHeight: 720,
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: [0, 0, 0],
        },
      },
      {
        deviceIndex: 1,
        deviceRole: "right",
        imageWidth: 1280,
        imageHeight: 720,
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: [-1, 0, 0],
        },
      },
    ],
  });
}

function buildPoseArtifact(input: {
  deviceIndex: number;
  deviceRole: string;
  projection: ProjectionMatrix3x4;
  confidence?: number;
  point?: Vector3;
}): PerCameraPoseArtifact {
  const point2d = projectPoint({
    projection: input.projection,
    point: input.point ?? SYNTHETIC_POINT,
  });
  return buildPerCameraPoseArtifact({
    takeId: "take_reconstruction",
    jobId: "job_reconstruction",
    cameraId: `cam_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: {
      storageKey: `takes/take_reconstruction/original/device_${input.deviceIndex}.mov`,
      normalizedStorageKey: `takes/take_reconstruction/jobs/job_reconstruction/normalized/device_${input.deviceIndex}.mp4`,
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
          keypoints2d: [point2d],
          confidence: [input.confidence ?? 0.95],
          poseConfidence: input.confidence ?? 0.95,
        },
      ],
    },
  });
}

function buildDualFixture(input?: {
  lowConfidenceDeviceIndex?: number;
  fallbackCalibration?: boolean;
}) {
  const calibration = input?.fallbackCalibration
    ? buildFallbackCalibration()
    : buildExplicitCalibration([
        { deviceIndex: 0, deviceRole: "front", translation: [0, 0, 0] },
        { deviceIndex: 1, deviceRole: "right", translation: [-1, 0, 0] },
      ]);
  const poseArtifacts = calibration.devices.map((camera) =>
    buildPoseArtifact({
      deviceIndex: camera.deviceIndex,
      deviceRole: camera.deviceRole,
      projection: camera.projection,
      confidence:
        input?.lowConfidenceDeviceIndex === camera.deviceIndex ? 0.1 : 0.95,
    }),
  );
  const syncReport = buildMultiViewSyncReport({ poseArtifacts });
  return { calibration, poseArtifacts, syncReport };
}

function buildProFixture() {
  const calibration = buildExplicitCalibration([
    { deviceIndex: 0, deviceRole: "front", translation: [0, 0, 0] },
    { deviceIndex: 1, deviceRole: "right", translation: [-1, 0, 0] },
    { deviceIndex: 2, deviceRole: "back", translation: [0, -1, 0] },
    { deviceIndex: 3, deviceRole: "left", translation: [1, 0, 0] },
  ]);
  const poseArtifacts = calibration.devices.map((camera) =>
    buildPoseArtifact({
      deviceIndex: camera.deviceIndex,
      deviceRole: camera.deviceRole,
      projection: camera.projection,
    }),
  );
  const syncReport = buildMultiViewSyncReport({ poseArtifacts });
  return { calibration, poseArtifacts, syncReport };
}

function distance(a: Vector3, b: Vector3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function assertBoundedMetric(value: number) {
  assert.ok(Number.isFinite(value));
  assert.ok(value >= 0);
  assert.ok(value <= 1);
}

function assertReconstructionError(error: unknown, code: string) {
  assert.ok(error instanceof MultiViewReconstructionError);
  assert.equal(error.code, code);
}

function testDualSyntheticReconstructionArtifact() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture();
  const artifact = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: calibration,
    source: "dual_camera",
  });

  assert.equal(artifact.schema, "mocap.multiview_reconstruction.v1");
  assert.equal(artifact.source, "dual_camera");
  assert.equal(artifact.frameCount, 1);
  assert.equal(artifact.frames.length, 1);
  assert.equal(artifact.frames[0].matchedDevices.length, 2);
  assert.equal(artifact.frames[0].landmarks3D.length, 1);
  assert.equal(artifact.frames[0].landmarks3D[0].source, "triangulated");
  assert.deepEqual(validateMultiViewReconstructionArtifact(artifact), {
    ok: true,
  });
}

function testKnownPointRoundTripReconstruction() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture();
  const artifact = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: calibration,
    source: "dual_camera",
  });
  const landmark = artifact.frames[0].landmarks3D[0];
  const reconstructed: Vector3 = [landmark.x, landmark.y, landmark.z];

  assert.ok(distance(reconstructed, SYNTHETIC_POINT) < 1e-6);
  assert.ok(landmark.reprojectionErrorPx < 1e-8);
}

function testLowConfidenceLandmarkFallback() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture({
    lowConfidenceDeviceIndex: 1,
  });
  const artifact = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: calibration,
    source: "dual_camera",
    options: {
      minKeypointConfidence: 0.3,
    },
  });
  const landmark = artifact.frames[0].landmarks3D[0];

  assert.equal(landmark.source, "fallback");
  assert.equal(artifact.metrics.triangulatedLandmarkRatio, 0);
  assert.equal(artifact.metrics.fallbackLandmarkRatio, 1);
  assert.ok(artifact.warnings.includes("triangulation_coverage_low"));
}

function testFiniteReprojectionAndBoundedAggregateMetrics() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture();
  const artifact = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: calibration,
    source: "dual_camera",
  });

  assert.ok(Number.isFinite(artifact.metrics.reprojectionErrorPx));
  assert.ok(Number.isFinite(artifact.metrics.reprojectionP95Px));
  assertBoundedMetric(artifact.metrics.syncConfidence);
  assertBoundedMetric(artifact.metrics.triangulatedLandmarkRatio);
  assertBoundedMetric(artifact.metrics.fallbackLandmarkRatio);
  assertBoundedMetric(artifact.metrics.calibrationQualityScore);
  assertBoundedMetric(artifact.metrics.intrinsicsFallbackUsed);
  assertBoundedMetric(artifact.metrics.multiViewQualityGain);
}

function testCalibrationAndSyncWarningPassThrough() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture({
    fallbackCalibration: true,
  });
  const artifact = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport: {
      ...syncReport,
      warnings: ["sync_confidence_low"],
    },
    calibrationArtifact: calibration,
    source: "dual_camera",
  });

  assert.ok(artifact.warnings.includes("sync_confidence_low"));
  assert.ok(artifact.warnings.includes("camera_intrinsics_fov_fallback_used"));
  assert.equal(artifact.metrics.intrinsicsFallbackUsed, 1);
}

function testMissingProjectionValidation() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture();
  const missingProjectionCalibration: CameraCalibrationArtifact = {
    ...calibration,
    devices: [calibration.devices[0]],
  };

  assert.throws(
    () =>
      buildMultiViewReconstructionArtifact({
        poseArtifacts,
        syncReport,
        calibrationArtifact: missingProjectionCalibration,
        source: "dual_camera",
      }),
    (error) => {
      assertReconstructionError(error, "camera_projection_invalid");
      return true;
    },
  );
}

function testInvalidProjectionValidation() {
  const { calibration, poseArtifacts, syncReport } = buildDualFixture();
  const invalidProjection = [
    Number.NaN,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
  ] as unknown as ProjectionMatrix3x4;
  const invalidCalibration: CameraCalibrationArtifact = {
    ...calibration,
    devices: [
      {
        ...calibration.devices[0],
        projection: invalidProjection,
      },
      calibration.devices[1],
    ],
  };

  assert.throws(
    () =>
      buildMultiViewReconstructionArtifact({
        poseArtifacts,
        syncReport,
        calibrationArtifact: invalidCalibration,
        source: "dual_camera",
      }),
    (error) => {
      assertReconstructionError(error, "camera_projection_invalid");
      return true;
    },
  );
}

function testProStyleFourCameraReconstruction() {
  const { calibration, poseArtifacts, syncReport } = buildProFixture();
  const artifact = buildMultiViewReconstructionArtifact({
    poseArtifacts,
    syncReport,
    calibrationArtifact: calibration,
    source: "multi_view",
  });
  const landmark = artifact.frames[0].landmarks3D[0];

  assert.equal(artifact.source, "multi_view");
  assert.equal(artifact.frames[0].matchedDevices.length, 4);
  assert.equal(landmark.source, "triangulated");
  assert.deepEqual(landmark.views, [0, 1, 2, 3]);
  assert.ok(landmark.reprojectionErrorPx < 1e-8);
  assert.deepEqual(validateMultiViewReconstructionArtifact(artifact), {
    ok: true,
  });
}

testDualSyntheticReconstructionArtifact();
testKnownPointRoundTripReconstruction();
testLowConfidenceLandmarkFallback();
testFiniteReprojectionAndBoundedAggregateMetrics();
testCalibrationAndSyncWarningPassThrough();
testMissingProjectionValidation();
testInvalidProjectionValidation();
testProStyleFourCameraReconstruction();

console.log("multi-view reconstruction synthetic tests passed");
