import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  Matrix3x3,
  ProjectionMatrix3x4,
} from "../types";
import {
  CameraCalibrationError,
  type CameraCalibrationDeviceInput,
  buildCameraCalibrationArtifact,
  buildCameraProjection,
  buildIntrinsicsFromFov,
  validateCameraCalibrationArtifact,
} from "./cameraCalibration";

const METADATA_INTRINSICS = {
  fx: 1000,
  fy: 990,
  cx: 640,
  cy: 360,
  width: 1280,
  height: 720,
};

function device(input: {
  deviceIndex: number;
  deviceRole: string;
  intrinsics?: CameraCalibrationDeviceInput["intrinsics"];
  approxCameraAngleDegrees?: number;
}): CameraCalibrationDeviceInput {
  return {
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    imageWidth: 1280,
    imageHeight: 720,
    intrinsics: input.intrinsics,
    approxCameraAngleDegrees: input.approxCameraAngleDegrees,
  };
}

function assertCalibrationError(error: unknown, code: string) {
  assert.ok(error instanceof CameraCalibrationError);
  assert.equal(error.code, code);
}

function assertFiniteUnitInterval(value: number) {
  assert.ok(Number.isFinite(value));
  assert.ok(value >= 0);
  assert.ok(value <= 1);
}

function testMetadataIntrinsicsPath() {
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({
        deviceIndex: 0,
        deviceRole: "primary",
        intrinsics: METADATA_INTRINSICS,
      }),
      device({
        deviceIndex: 1,
        deviceRole: "secondary",
        intrinsics: METADATA_INTRINSICS,
      }),
    ],
  });

  assert.equal(artifact.schema, "mocap.camera_calibration.v1");
  assert.equal(artifact.source, "capture_metadata");
  assert.equal(artifact.intrinsicsSource, "capture_metadata");
  assert.equal(artifact.devices.length, 2);
  assert.equal(artifact.devices[0].intrinsicsSource, "capture_metadata");
  assert.deepEqual(artifact.devices[0].intrinsic, [
    1000,
    0,
    640,
    0,
    990,
    360,
    0,
    0,
    1,
  ]);
  assert.deepEqual(artifact.warnings, []);
  assertFiniteUnitInterval(artifact.quality.score);
  assert.ok(artifact.quality.baseline > 0);
  assert.deepEqual(validateCameraCalibrationArtifact(artifact), { ok: true });
}

function testFovFallbackPath() {
  const intrinsic = buildIntrinsicsFromFov({
    width: 1280,
    height: 720,
    fovDegrees: 69,
  });
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({ deviceIndex: 0, deviceRole: "front" }),
      device({ deviceIndex: 1, deviceRole: "right" }),
    ],
    defaultFovDegrees: 69,
  });

  assert.ok(intrinsic[0] > 0);
  assert.equal(intrinsic[2], 640);
  assert.equal(intrinsic[5], 360);
  assert.equal(artifact.source, "metadata_and_fov_fallback");
  assert.equal(artifact.intrinsicsSource, "fov_fallback");
  assert.ok(artifact.warnings.includes("camera_intrinsics_missing"));
  assert.ok(artifact.warnings.includes("camera_intrinsics_fov_fallback_used"));
  assert.ok(
    artifact.devices.every((camera) => camera.intrinsicsSource === "fov_fallback"),
  );
  assert.deepEqual(validateCameraCalibrationArtifact(artifact), { ok: true });
}

function testProjectionMatrixProducedForEveryCamera() {
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({ deviceIndex: 0, deviceRole: "front" }),
      device({ deviceIndex: 1, deviceRole: "right" }),
      device({ deviceIndex: 2, deviceRole: "back" }),
      device({ deviceIndex: 3, deviceRole: "left" }),
    ],
  });

  assert.equal(artifact.devices.length, 4);
  for (const camera of artifact.devices) {
    assert.equal(camera.projection.length, 12);
    assert.ok(camera.projection.every(Number.isFinite));
    assert.equal(camera.intrinsic.length, 9);
    assert.equal(camera.rotation.length, 9);
    assert.equal(camera.translation.length, 3);
  }
  assert.ok(artifact.quality.baseline > 0);
  assert.ok(artifact.quality.convergenceAngle > 0);
  assertFiniteUnitInterval(artifact.quality.score);
  assert.deepEqual(validateCameraCalibrationArtifact(artifact), { ok: true });
}

function testInvalidProjectionValidation() {
  const valid = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({
        deviceIndex: 0,
        deviceRole: "primary",
        intrinsics: METADATA_INTRINSICS,
      }),
      device({
        deviceIndex: 1,
        deviceRole: "secondary",
        intrinsics: METADATA_INTRINSICS,
      }),
    ],
  });
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
  const invalidArtifact: CameraCalibrationArtifact = {
    ...valid,
    devices: [
      {
        ...valid.devices[0],
        projection: invalidProjection,
      },
      valid.devices[1],
    ],
  };
  const validation = validateCameraCalibrationArtifact(invalidArtifact);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.errors.some((error) =>
        error.includes("camera_projection_invalid"),
      ),
    );
  }
}

function testInvalidProjectionThrows() {
  const zeroIntrinsic: Matrix3x3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  assert.throws(
    () =>
      buildCameraProjection({
        device: device({
          deviceIndex: 0,
          deviceRole: "primary",
          intrinsics: {
            matrix: zeroIntrinsic,
          },
        }),
      }),
    (error) => {
      assertCalibrationError(error, "camera_projection_invalid");
      return true;
    },
  );
}

function testWarningGenerationAndQualityBounds() {
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({
        deviceIndex: 0,
        deviceRole: "front",
        intrinsics: METADATA_INTRINSICS,
      }),
      device({ deviceIndex: 1, deviceRole: "right" }),
    ],
  });

  assert.equal(artifact.intrinsicsSource, "capture_metadata_or_fov");
  assert.ok(artifact.warnings.includes("camera_intrinsics_missing"));
  assert.ok(artifact.warnings.includes("camera_intrinsics_fov_fallback_used"));
  assert.equal(
    artifact.warnings.filter((warning) => warning === "camera_intrinsics_missing")
      .length,
    1,
  );
  assertFiniteUnitInterval(artifact.quality.score);
  assert.ok(Number.isFinite(artifact.quality.averageReprojectionErrorPx));
  assert.equal(artifact.quality.averageReprojectionErrorPx, 0);
}

function testDualCameraBaselinePositive() {
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({ deviceIndex: 0, deviceRole: "front" }),
      device({ deviceIndex: 1, deviceRole: "right" }),
    ],
    baselineMeters: 1.2,
  });

  assert.ok(artifact.quality.baseline >= 1.19);
  assert.ok(artifact.quality.baseline <= 1.21);
}

function testFourCameraProStyleCalibration() {
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({ deviceIndex: 0, deviceRole: "front", approxCameraAngleDegrees: 0 }),
      device({ deviceIndex: 1, deviceRole: "right", approxCameraAngleDegrees: -25 }),
      device({ deviceIndex: 2, deviceRole: "back", approxCameraAngleDegrees: 180 }),
      device({ deviceIndex: 3, deviceRole: "left", approxCameraAngleDegrees: 25 }),
    ],
  });

  assert.equal(artifact.devices.length, 4);
  assert.deepEqual(
    artifact.devices.map((camera) => camera.deviceIndex),
    [0, 1, 2, 3],
  );
  assert.ok(artifact.quality.baseline > 0);
  assert.ok(artifact.quality.convergenceAngle > 0);
  assert.deepEqual(validateCameraCalibrationArtifact(artifact), { ok: true });
}

testMetadataIntrinsicsPath();
testFovFallbackPath();
testProjectionMatrixProducedForEveryCamera();
testInvalidProjectionValidation();
testInvalidProjectionThrows();
testWarningGenerationAndQualityBounds();
testDualCameraBaselinePositive();
testFourCameraProStyleCalibration();

console.log("camera calibration synthetic tests passed");
