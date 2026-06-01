import assert from "node:assert/strict";
import type { Matrix3x3, Vector3 } from "../types";
import { buildCameraCalibrationArtifact } from "../reconstruction/cameraCalibration";
import {
  createCalibrationTargetDetectorAdapter,
  detectCalibrationObservations,
} from "./aprilTagCheckerboardAdapter";
import {
  parseCalibrationObservationsFixture,
  validateCalibrationObservationsArtifact,
} from "./calibrationTargetDetector";

const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const REFERENCE_TRANSLATION: Vector3 = [0, 0, 0];
const SECONDARY_TRANSLATION: Vector3 = [-1, 0, 0];

function baseInput(targetType: "apriltag" | "checkerboard" | "charuco") {
  return {
    takeId: "take_calibration_detector",
    jobId: "job_calibration_detector",
    sessionId: "session_calibration_detector",
    targetType,
    cameras: [
      {
        cameraId: "device_0",
        deviceId: "device_0",
        normalizedVideoPath: "/tmp/device_0.mp4",
      },
      {
        cameraId: "device_1",
        deviceId: "device_1",
        normalizedVideoPath: "/tmp/device_1.mp4",
      },
    ],
  } as const;
}

function testFixtureAprilTagObservationsParse() {
  const input = baseInput("apriltag");
  const artifact = parseCalibrationObservationsFixture(
    {
      targetType: "apriltag",
      detectorSource: "fixture",
      frames: [
        {
          cameraId: "device_0",
          frameIndex: 12,
          timestampMs: 400,
          tags: [
            {
              tagId: "tag_0",
              corners: [
                { cornerId: "0", x: 532.2, y: 281.4, confidence: 0.95 },
                { cornerId: "1", x: 612.5, y: 282.1, confidence: 0.94 },
              ],
            },
          ],
        },
      ],
    },
    { ...input, cameras: [input.cameras[0]] },
  );

  assert.equal(artifact.schemaVersion, "mocap.calibration_observations.v1");
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.targetType, "apriltag");
  assert.equal(artifact.frames[0].observations[0].x, 532.2);
  assert.equal(artifact.frames[0].observations[0].y, 281.4);
  assert.equal(artifact.frames[0].observations[0].confidence, 0.95);
  assert.deepEqual(validateCalibrationObservationsArtifact(artifact), { ok: true });
}

async function testFixtureAdapterProducesAprilTagArtifact() {
  const adapter = createCalibrationTargetDetectorAdapter({
    runtime: {
      detector: "fixture",
      targetType: "apriltag",
      timeoutMs: 1000,
    },
  });
  const artifact = await detectCalibrationObservations(
    {
      ...baseInput("apriltag"),
      detectorConfig: {
        fixture: {
          frames: [
            {
              cameraId: "device_0",
              frameIndex: 0,
              observations: [
                {
                  targetId: "tag_4",
                  cornerId: "2",
                  x: 10.25,
                  y: 11.5,
                  confidence: 0.88,
                },
              ],
            },
          ],
        },
      },
    },
    adapter,
  );

  assert.equal(artifact.detectorSource, "fixture");
  assert.equal(artifact.frames[0].observations[0].targetId, "tag_4");
  assert.equal(artifact.frames[0].observations[0].cornerId, "2");
  assert.equal(artifact.frames[0].observations[0].x, 10.25);
}

function testFixtureCheckerboardObservationsParse() {
  const artifact = parseCalibrationObservationsFixture(
    {
      targetType: "checkerboard",
      frames: [
        {
          cameraId: "device_0",
          frameIndex: 3,
          corners: [
            { cornerId: "row_0_col_0", x: 101, y: 205, confidence: 0.91 },
            { cornerId: "row_0_col_1", x: 135, y: 205.5, confidence: 0.9 },
          ],
        },
      ],
    },
    baseInput("checkerboard"),
  );

  assert.equal(artifact.targetType, "checkerboard");
  assert.equal(artifact.frames[0].observations[0].targetId, "checkerboard");
  assert.equal(artifact.frames[0].observations[0].cornerId, "row_0_col_0");
  assert.equal(artifact.frames[0].observations[1].cornerId, "row_0_col_1");
}

function testFixtureCharucoObservationsParse() {
  const artifact = parseCalibrationObservationsFixture(
    {
      targetType: "charuco",
      frames: [
        {
          cameraId: "device_0",
          frameIndex: 7,
          markers: [
            {
              markerId: "marker_9",
              corners: [
                { cornerId: "charuco_12", x: 240.5, y: 300.25, confidence: 0.87 },
              ],
            },
          ],
        },
      ],
    },
    baseInput("charuco"),
  );

  assert.equal(artifact.targetType, "charuco");
  assert.equal(artifact.frames[0].observations[0].targetId, "marker_9");
  assert.equal(artifact.frames[0].observations[0].cornerId, "charuco_12");
  assert.equal(artifact.frames[0].observations[0].confidence, 0.87);
}

async function testMissingRuntimeDoesNotCrash() {
  const adapter = createCalibrationTargetDetectorAdapter({
    runtime: {
      detector: "opencv_apriltag",
      targetType: "apriltag",
      cliPath: "/tmp/mocapexpo-missing-calibration-detector",
      timeoutMs: 1000,
    },
  });
  const artifact = await adapter.detectCalibrationObservations(baseInput("apriltag"));

  assert.equal(artifact.status, "missing_calibration_observations");
  assert.equal(artifact.frames.length, 0);
  assert.ok(artifact.reason?.includes("CLI path does not exist"));
}

async function testDisabledDetectorDoesNotFail() {
  const adapter = createCalibrationTargetDetectorAdapter({
    runtime: {
      detector: "disabled",
      targetType: "apriltag",
      timeoutMs: 1000,
    },
  });
  const artifact = await adapter.detectCalibrationObservations(baseInput("apriltag"));

  assert.equal(artifact.status, "disabled");
  assert.equal(artifact.frames.length, 0);
  assert.ok(artifact.warnings.some((warning) => warning.includes("unavailable")));
}

function testNoFakeObservationsAreGenerated() {
  const artifact = parseCalibrationObservationsFixture(
    {
      targetType: "apriltag",
      frames: [
        {
          cameraId: "device_0",
          frameIndex: 2,
          observations: [
            { targetId: "tag_0", cornerId: "0", x: 0, y: 0, confidence: 0 },
            { targetId: "tag_0", cornerId: "1", x: 51, y: 64, confidence: 0.8 },
            { targetId: "tag_0", cornerId: "2" },
          ],
        },
      ],
    },
    baseInput("apriltag"),
  );

  assert.equal(artifact.frames[0].observations.length, 1);
  assert.equal(artifact.frames[0].observations[0].cornerId, "1");
  assert.equal(artifact.frames[0].observations[0].x, 51);
}

function testOneCameraFailureProducesPartialDiagnostic() {
  const artifact = parseCalibrationObservationsFixture(
    {
      targetType: "apriltag",
      cameras: [
        { cameraId: "device_0", status: "ready" },
        {
          cameraId: "device_1",
          status: "failed",
          reason: "Detector failed on device_1.",
        },
      ],
      frames: [
        {
          cameraId: "device_0",
          frameIndex: 1,
          observations: [
            { targetId: "tag_0", cornerId: "0", x: 20, y: 30, confidence: 0.9 },
          ],
        },
      ],
    },
    baseInput("apriltag"),
  );

  assert.equal(artifact.status, "diagnostic_only");
  assert.equal(artifact.cameras.find((camera) => camera.cameraId === "device_0")?.status, "ready");
  assert.equal(artifact.cameras.find((camera) => camera.cameraId === "device_1")?.status, "failed");
}

function testCameraCalibrationConsumesObservationBoundary() {
  const observations = parseCalibrationObservationsFixture(
    {
      targetType: "apriltag",
      frames: [
        {
          cameraId: "device_0",
          frameIndex: 0,
          observations: [
            { targetId: "tag_0", cornerId: "0", x: 20, y: 30, confidence: 0.9 },
          ],
        },
        {
          cameraId: "device_1",
          frameIndex: 0,
          observations: [
            { targetId: "tag_0", cornerId: "0", x: 28, y: 31, confidence: 0.8 },
          ],
        },
      ],
    },
    baseInput("apriltag"),
  );
  const artifact = buildCameraCalibrationArtifact({
    takeId: "take_calibration_detector",
    jobId: "job_calibration_detector",
    calibrationObservations: observations,
    devices: [
      {
        deviceIndex: 0,
        deviceRole: "primary",
        imageWidth: 1280,
        imageHeight: 720,
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: REFERENCE_TRANSLATION,
        },
      },
      {
        deviceIndex: 1,
        deviceRole: "secondary",
        imageWidth: 1280,
        imageHeight: 720,
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: SECONDARY_TRANSLATION,
        },
      },
    ],
  });

  assert.equal(artifact.calibrationObservationStatus, "ready");
  assert.equal(artifact.calibrationTargetType, "apriltag");
  assert.equal(artifact.calibrationObservationCount, 2);
  assert.ok(
    Math.abs((artifact.calibrationObservationConfidence ?? 0) - 0.85) < 1e-9,
  );
  assert.ok(
    artifact.warnings.includes("calibration_observation_solve_not_implemented"),
  );
  assert.notEqual(artifact.status, "ready");
}

async function main() {
  testFixtureAprilTagObservationsParse();
  await testFixtureAdapterProducesAprilTagArtifact();
  testFixtureCheckerboardObservationsParse();
  testFixtureCharucoObservationsParse();
  await testMissingRuntimeDoesNotCrash();
  await testDisabledDetectorDoesNotFail();
  testNoFakeObservationsAreGenerated();
  testOneCameraFailureProducesPartialDiagnostic();
  testCameraCalibrationConsumesObservationBoundary();

  console.log("calibration target detector tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
