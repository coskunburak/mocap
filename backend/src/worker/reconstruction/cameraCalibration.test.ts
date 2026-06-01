import assert from "node:assert/strict";
import type {
  CameraCalibrationArtifact,
  Matrix3x3,
  ProjectionMatrix3x4,
  Vector3,
} from "../types";
import {
  CameraCalibrationError,
  type CameraCalibrationDeviceInput,
  buildCameraCalibrationArtifact,
  buildMissingCalibrationArtifact,
  buildCameraProjection,
  buildIntrinsicsFromFov,
  validateCameraCalibrationArtifact,
} from "./cameraCalibration";
import { resolveWorkerPipelineBranch } from "./multiViewOrchestrator";

const METADATA_INTRINSICS = {
  fx: 1000,
  fy: 990,
  cx: 640,
  cy: 360,
  width: 1280,
  height: 720,
};
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const REFERENCE_TRANSLATION: Vector3 = [0, 0, 0];
const SECONDARY_TRANSLATION: Vector3 = [-1, 0, 0];

function device(input: {
  deviceIndex: number;
  deviceRole: string;
  intrinsics?: CameraCalibrationDeviceInput["intrinsics"];
  extrinsics?: CameraCalibrationDeviceInput["extrinsics"];
  approxCameraAngleDegrees?: number;
}): CameraCalibrationDeviceInput {
  return {
    cameraId: `camera_${input.deviceIndex}`,
    deviceId: `device_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    imageWidth: 1280,
    imageHeight: 720,
    intrinsics: input.intrinsics,
    extrinsics: input.extrinsics,
    approxCameraAngleDegrees: input.approxCameraAngleDegrees,
  };
}

function extrinsics(input: {
  translation: Vector3;
  source?: NonNullable<CameraCalibrationDeviceInput["extrinsics"]>["source"];
}): NonNullable<CameraCalibrationDeviceInput["extrinsics"]> {
  return {
    rotation: IDENTITY_ROTATION,
    translation: input.translation,
    source: input.source ?? "capture_metadata",
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
        extrinsics: extrinsics({ translation: REFERENCE_TRANSLATION }),
      }),
      device({
        deviceIndex: 1,
        deviceRole: "secondary",
        intrinsics: METADATA_INTRINSICS,
        extrinsics: extrinsics({ translation: SECONDARY_TRANSLATION }),
      }),
    ],
  });

  assert.equal(artifact.schema, "mocap.camera_calibration.v1");
  assert.equal(artifact.source, "capture_metadata");
  assert.equal(artifact.intrinsicsSource, "capture_metadata");
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.reason?.includes("valid intrinsics"), true);
  assert.equal(artifact.coordinateSystem, "right_handed_y_up");
  assert.equal(artifact.devices.length, 2);
  assert.equal(artifact.cameras?.length, 2);
  assert.equal(artifact.baselineEstimate, artifact.quality.baseline);
  assert.equal(artifact.devices[0].intrinsicsSource, "capture_metadata");
  assert.equal(artifact.devices[0].extrinsicsSource, "capture_metadata");
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
  assert.deepEqual(artifact.devices[0].intrinsicMatrixK, artifact.devices[0].intrinsic);
  assert.deepEqual(artifact.devices[0].rotationR, artifact.devices[0].rotation);
  assert.deepEqual(artifact.devices[0].translationT, artifact.devices[0].translation);
  assert.deepEqual(artifact.devices[0].projectionMatrixP, artifact.devices[0].projection);
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
  assert.equal(artifact.status, "approximate");
  assert.ok(artifact.warnings.includes("camera_intrinsics_missing"));
  assert.ok(artifact.warnings.includes("camera_intrinsics_fov_fallback_used"));
  assert.ok(artifact.warnings.includes("camera_extrinsics_missing"));
  assert.ok(
    artifact.warnings.includes("camera_extrinsics_role_angle_fallback_used"),
  );
  assert.ok(artifact.warnings.includes("calibration_approximate"));
  assert.ok(artifact.quality.score <= 0.45);
  assert.ok(
    artifact.devices.every((camera) => camera.intrinsicsSource === "fov_fallback"),
  );
  assert.ok(
    artifact.devices.every(
      (camera) => camera.extrinsicsSource === "role_angle_fallback",
    ),
  );
  assert.deepEqual(validateCameraCalibrationArtifact(artifact), { ok: true });
}

function testMissingIntrinsicsCanBeRepresentedWithoutFallback() {
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({ deviceIndex: 0, deviceRole: "front" }),
      device({ deviceIndex: 1, deviceRole: "right" }),
    ],
    allowFovFallback: false,
  });

  assert.equal(artifact.status, "missing_calibration");
  assert.equal(artifact.devices.length, 0);
  assert.equal(artifact.cameras?.length, 0);
  assert.equal(artifact.quality.score, 0);
  assert.ok(artifact.warnings.includes("camera_intrinsics_missing"));
}

function testMissingCalibrationArtifactHelper() {
  const artifact = buildMissingCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    reason: "No calibration payload was supplied.",
  });

  assert.equal(artifact.status, "missing_calibration");
  assert.equal(artifact.reason, "No calibration payload was supplied.");
  assert.equal(artifact.baselineEstimate, 0);
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

function testInvalidRotationThrows() {
  const invalidRotation: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 0];

  assert.throws(
    () =>
      buildCameraProjection({
        device: device({
          deviceIndex: 1,
          deviceRole: "secondary",
          intrinsics: METADATA_INTRINSICS,
          extrinsics: {
            rotation: invalidRotation,
            translation: SECONDARY_TRANSLATION,
          },
        }),
      }),
    (error) => {
      assertCalibrationError(error, "camera_calibration_failed");
      return true;
    },
  );
}

function testSingleCameraIsInsufficientForCalibration() {
  assert.throws(
    () =>
      buildCameraCalibrationArtifact({
        takeId: "take_calibration",
        jobId: "job_calibration",
        devices: [
          device({
            deviceIndex: 0,
            deviceRole: "primary",
            intrinsics: METADATA_INTRINSICS,
          }),
        ],
      }),
    (error) => {
      assertCalibrationError(error, "camera_calibration_failed");
      return true;
    },
  );
}

function testFallbackQualityScoreIsLowerThanReadyCalibration() {
  const ready = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({
        deviceIndex: 0,
        deviceRole: "primary",
        intrinsics: METADATA_INTRINSICS,
        extrinsics: extrinsics({ translation: REFERENCE_TRANSLATION }),
      }),
      device({
        deviceIndex: 1,
        deviceRole: "secondary",
        intrinsics: METADATA_INTRINSICS,
        extrinsics: extrinsics({ translation: SECONDARY_TRANSLATION }),
      }),
    ],
  });
  const fallback = buildCameraCalibrationArtifact({
    takeId: "take_calibration",
    jobId: "job_calibration",
    devices: [
      device({ deviceIndex: 0, deviceRole: "front" }),
      device({ deviceIndex: 1, deviceRole: "right" }),
    ],
  });

  assert.equal(ready.status, "ready");
  assert.equal(fallback.status, "approximate");
  assert.ok((fallback.cameras?.[0].calibrationQualityScore ?? 1) < ready.quality.score);
  assert.ok(fallback.quality.score < ready.quality.score);
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
  assert.equal(artifact.status, "approximate");
  assert.ok(artifact.warnings.includes("camera_intrinsics_missing"));
  assert.ok(artifact.warnings.includes("camera_intrinsics_fov_fallback_used"));
  assert.ok(artifact.warnings.includes("camera_extrinsics_missing"));
  assert.ok(
    artifact.warnings.includes("camera_extrinsics_role_angle_fallback_used"),
  );
  assert.ok(artifact.warnings.includes("calibration_approximate"));
  assert.equal(
    artifact.warnings.filter((warning) => warning === "camera_intrinsics_missing")
      .length,
    1,
  );
  assertFiniteUnitInterval(artifact.quality.score);
  assert.ok(artifact.quality.score <= 0.65);
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

function testSingleCameraWhamBranchDoesNotRequireCalibration() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.additionalVideosProvided, 0);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

testMetadataIntrinsicsPath();
testFovFallbackPath();
testMissingIntrinsicsCanBeRepresentedWithoutFallback();
testMissingCalibrationArtifactHelper();
testProjectionMatrixProducedForEveryCamera();
testInvalidProjectionValidation();
testInvalidProjectionThrows();
testInvalidRotationThrows();
testSingleCameraIsInsufficientForCalibration();
testFallbackQualityScoreIsLowerThanReadyCalibration();
testWarningGenerationAndQualityBounds();
testDualCameraBaselinePositive();
testFourCameraProStyleCalibration();
testSingleCameraWhamBranchDoesNotRequireCalibration();

console.log("camera calibration synthetic tests passed");
