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
  buildTriangulatedJointTrackArtifact,
  validateTriangulatedJointTrackArtifact,
} from "./triangulatedJointTrack";
import { projectPoint } from "./triangulation";

const TAKE_ID = "take_triangulated_joint_track";
const JOB_ID = "job_triangulated_joint_track";
const PIXEL_INTRINSIC: Matrix3x3 = [800, 0, 320, 0, 805, 240, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PRIMARY_TRANSLATION: Vector3 = [0, 0, 0];
const SECONDARY_TRANSLATION: Vector3 = [-1.2, 0, 0];

type JointFrame = {
  timestampMs: number;
  joints: Record<string, Vector3>;
};

function calibration(): CameraCalibrationArtifact {
  return buildCameraCalibrationArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    devices: [
      {
        cameraId: "device_0",
        deviceId: "phone_0",
        deviceIndex: 0,
        deviceRole: "front",
        imageWidth: 1280,
        imageHeight: 720,
        intrinsics: { matrix: PIXEL_INTRINSIC, source: "calibration_payload" },
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: PRIMARY_TRANSLATION,
          source: "calibration_payload",
        },
      },
      {
        cameraId: "device_1",
        deviceId: "phone_1",
        deviceIndex: 1,
        deviceRole: "right",
        imageWidth: 1280,
        imageHeight: 720,
        intrinsics: { matrix: PIXEL_INTRINSIC, source: "calibration_payload" },
        extrinsics: {
          rotation: IDENTITY_ROTATION,
          translation: SECONDARY_TRANSLATION,
          source: "calibration_payload",
        },
      },
    ],
  });
}

function poseArtifact(input: {
  cameraId: string;
  deviceIndex: number;
  projection: ProjectionMatrix3x4;
  frames: readonly JointFrame[];
  confidence?: (frameIndex: number, jointId: string) => number;
  omit?: (frameIndex: number, jointId: string) => boolean;
  overrideObservation?: (frameIndex: number, jointId: string) => Vector3 | undefined;
}): PerCameraPoseArtifact {
  return buildPerCameraPoseArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    cameraId: input.cameraId,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceIndex === 0 ? "front" : "right",
    sourceVideo: {
      storageKey: `takes/${TAKE_ID}/original/${input.cameraId}.mov`,
      normalizedStorageKey:
        `takes/${TAKE_ID}/jobs/${JOB_ID}/normalized/${input.cameraId}.mp4`,
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: Math.max(33, input.frames.length * 33),
    },
    detectorResult: {
      detector: {
        name: "fixture_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "body_33",
      },
      expectedFrameCount: input.frames.length,
      frames: input.frames.map((frame, frameIndex) => ({
        frameIndex,
        timestampMs: frame.timestampMs,
        keypoints: Object.entries(frame.joints).flatMap(([jointId, point3d]) => {
          if (input.omit?.(frameIndex, jointId)) return [];
          const projected = projectPoint({
            projection: input.projection,
            point: input.overrideObservation?.(frameIndex, jointId) ?? point3d,
          });
          return [
            {
              jointId,
              name: jointId,
              x: projected.x,
              y: projected.y,
              confidence: input.confidence?.(frameIndex, jointId) ?? 0.95,
            },
          ];
        }),
        poseConfidence: 0.95,
      })),
    },
  });
}

function fixture(input: {
  frames: readonly JointFrame[];
  confidence?: (deviceIndex: number, frameIndex: number, jointId: string) => number;
  omit?: (deviceIndex: number, frameIndex: number, jointId: string) => boolean;
  overrideObservation?: (
    deviceIndex: number,
    frameIndex: number,
    jointId: string,
  ) => Vector3 | undefined;
  degenerateCalibration?: boolean;
}) {
  const cameraCalibration = calibration();
  const devices = input.degenerateCalibration
    ? cameraCalibration.devices.map((device) =>
        device.deviceIndex === 1
          ? {
              ...device,
              projection: cameraCalibration.devices[0].projection,
              projectionMatrixP: cameraCalibration.devices[0].projection,
            }
          : device,
      )
    : cameraCalibration.devices;
  const calibrationArtifact: CameraCalibrationArtifact = {
    ...cameraCalibration,
    devices,
    cameras: devices,
  };
  const poseArtifacts = devices.map((device) =>
    poseArtifact({
      cameraId: `device_${device.deviceIndex}`,
      deviceIndex: device.deviceIndex,
      projection: device.projection,
      frames: input.frames,
      confidence: (frameIndex, jointId) =>
        input.confidence?.(device.deviceIndex, frameIndex, jointId) ?? 0.95,
      omit: (frameIndex, jointId) =>
        input.omit?.(device.deviceIndex, frameIndex, jointId) ?? false,
      overrideObservation: (frameIndex, jointId) =>
        input.overrideObservation?.(device.deviceIndex, frameIndex, jointId),
    }),
  );
  return {
    cameraCalibration: calibrationArtifact,
    poseArtifacts,
    syncReport: buildMultiViewSyncReport({ poseArtifacts }),
  };
}

function buildTrack(input: Parameters<typeof fixture>[0]) {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture(input);
  return buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    syncReport,
    cameraCalibration,
    options: {
      minKeypointConfidence: 0.3,
      maxReprojectionErrorPx: 1,
      smoothingWindowFrames: 1,
      minTriangulatedJointRatio: 0.5,
    },
  });
}

function assertClose(actual: number, expected: number, tolerance: number) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function testCleanSyntheticTrackRoundTrip() {
  const frames: JointFrame[] = [
    { timestampMs: 0, joints: { left_knee: [0.12, 0.83, 3.2] } },
    { timestampMs: 33, joints: { left_knee: [0.16, 0.81, 3.25] } },
  ];
  const artifact = buildTrack({ frames });

  assert.equal(artifact.schema, "mocap.triangulated_joint_track.v1");
  assert.equal(artifact.status, "ready");
  assert.equal(artifact.frameCount, 2);
  assert.equal(artifact.trackedFrameCount, 2);
  assert.equal(artifact.metrics.matchedFrameCount, 2);
  assert.ok((artifact.metrics.triangulatedJointRatio ?? 0) > 0.99);
  assert.ok((artifact.metrics.averageReprojectionErrorPx ?? 1) < 1e-6);
  const firstJoint = artifact.frames[0].joints[0];
  assert.equal(firstJoint.status, "tracked");
  assertClose(firstJoint.x ?? Number.NaN, frames[0].joints.left_knee[0], 1e-6);
  assertClose(firstJoint.y ?? Number.NaN, frames[0].joints.left_knee[1], 1e-6);
  assertClose(firstJoint.z ?? Number.NaN, frames[0].joints.left_knee[2], 1e-6);
  assert.deepEqual(validateTriangulatedJointTrackArtifact(artifact), { ok: true });
}

function testHighReprojectionErrorIsRejected() {
  const frames: JointFrame[] = [
    { timestampMs: 0, joints: { left_knee: [0.12, 0.83, 3.2] } },
  ];
  const artifact = buildTrack({
    frames,
    overrideObservation: (deviceIndex) =>
      deviceIndex === 1 ? [1.2, -0.4, 2.5] : undefined,
  });
  const joint = artifact.frames[0].joints[0];

  assert.equal(artifact.status, "high_reprojection_error");
  assert.equal(joint.status, "high_reprojection_error");
  assert.equal(joint.x, undefined);
  assert.equal(joint.y, undefined);
  assert.equal(joint.z, undefined);
  assert.ok((joint.reprojectionErrorPx ?? 0) > 1);
}

function testLowConfidenceKeypointIsPreservedWithoutCoordinates() {
  const frames: JointFrame[] = [
    { timestampMs: 0, joints: { left_knee: [0.12, 0.83, 3.2] } },
  ];
  const artifact = buildTrack({
    frames,
    confidence: (deviceIndex) => (deviceIndex === 1 ? 0.1 : 0.95),
  });
  const joint = artifact.frames[0].joints[0];

  assert.equal(artifact.status, "low_confidence");
  assert.equal(joint.status, "low_confidence");
  assert.equal(joint.confidence, (0.95 + 0.1) / 2);
  assert.equal(joint.x, undefined);
  assert.equal(joint.y, undefined);
  assert.equal(joint.z, undefined);
}

function testOcclusionCanBeInterpolatedAcrossShortSafeGap() {
  const frames: JointFrame[] = [
    { timestampMs: 0, joints: { left_knee: [0, 0.8, 3.2] } },
    { timestampMs: 33, joints: { left_knee: [0.1, 0.8, 3.2] } },
    { timestampMs: 66, joints: { left_knee: [0.2, 0.8, 3.2] } },
  ];
  const { cameraCalibration, poseArtifacts, syncReport } = fixture({
    frames,
    omit: (deviceIndex, frameIndex) => deviceIndex === 1 && frameIndex === 1,
  });
  const artifact = buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    syncReport,
    cameraCalibration,
    options: {
      smoothingWindowFrames: 2,
      minKeypointConfidence: 0.3,
      maxReprojectionErrorPx: 1,
      maxTemporalJumpMeters: 1,
      minTriangulatedJointRatio: 0.5,
    },
  });
  const joint = artifact.frames[1].joints.find((item) => item.jointId === "left_knee");

  assert.equal(artifact.status, "diagnostic_only");
  assert.equal(joint?.status, "interpolated");
  assertClose(joint?.x ?? Number.NaN, 0.1, 1e-6);
  assert.ok(artifact.warnings.includes("occlusion_interpolated"));
  assert.ok((artifact.metrics.interpolatedJointRatio ?? 0) > 0);
}

function testTemporalSmoothingReducesJitterAndPreservesRawCoordinates() {
  const frames: JointFrame[] = [
    { timestampMs: 0, joints: { left_knee: [0, 0.8, 3.2] } },
    { timestampMs: 33, joints: { left_knee: [0.1, 1.2, 3.2] } },
    { timestampMs: 66, joints: { left_knee: [0.2, 0.4, 3.2] } },
    { timestampMs: 99, joints: { left_knee: [0.3, 1.2, 3.2] } },
    { timestampMs: 132, joints: { left_knee: [0.4, 0.8, 3.2] } },
  ];
  const { cameraCalibration, poseArtifacts, syncReport } = fixture({ frames });
  const artifact = buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    syncReport,
    cameraCalibration,
    options: {
      smoothingWindowFrames: 3,
      minKeypointConfidence: 0.3,
      maxReprojectionErrorPx: 1,
      minTriangulatedJointRatio: 0.5,
    },
  });
  const middleJoint = artifact.frames[2].joints[0];

  assert.equal(artifact.status, "diagnostic_only");
  assert.ok(
    (artifact.metrics.temporalJitterAfter ?? Infinity) <
      (artifact.metrics.temporalJitterBefore ?? 0),
  );
  assert.ok((artifact.metrics.temporalSmoothingGain ?? 0) > 0);
  assertClose(middleJoint.rawY ?? Number.NaN, frames[2].joints.left_knee[1], 1e-9);
  assert.notEqual(middleJoint.y, middleJoint.rawY);
}

function testDegenerateCalibrationDoesNotProduceFakeTrack() {
  const artifact = buildTrack({
    frames: [{ timestampMs: 0, joints: { left_knee: [0.12, 0.83, 3.2] } }],
    degenerateCalibration: true,
  });

  assert.equal(artifact.status, "insufficient_views");
  assert.equal(artifact.trackedFrameCount, 0);
  assert.equal(artifact.frames[0].joints.length, 0);
}

function testMissingInputsAreStatusedHonestly() {
  const { cameraCalibration, poseArtifacts, syncReport } = fixture({
    frames: [{ timestampMs: 0, joints: { left_knee: [0.12, 0.83, 3.2] } }],
  });
  const missingPose = buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts: [poseArtifacts[0]],
    syncReport,
    cameraCalibration,
  });
  const missingSync = buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    cameraCalibration,
  });
  const missingCalibration = buildTriangulatedJointTrackArtifact({
    takeId: TAKE_ID,
    jobId: JOB_ID,
    source: "dual_camera",
    poseArtifacts,
    syncReport,
  });

  assert.equal(missingPose.status, "missing_pose_frames");
  assert.equal(missingSync.status, "missing_sync");
  assert.equal(missingCalibration.status, "missing_calibration");
  assert.equal(missingPose.frames.length, 0);
  assert.equal(missingSync.frames.length, 0);
  assert.equal(missingCalibration.frames.length, 0);
}

function run() {
  testCleanSyntheticTrackRoundTrip();
  testHighReprojectionErrorIsRejected();
  testLowConfidenceKeypointIsPreservedWithoutCoordinates();
  testOcclusionCanBeInterpolatedAcrossShortSafeGap();
  testTemporalSmoothingReducesJitterAndPreservesRawCoordinates();
  testDegenerateCalibrationDoesNotProduceFakeTrack();
  testMissingInputsAreStatusedHonestly();
}

run();
