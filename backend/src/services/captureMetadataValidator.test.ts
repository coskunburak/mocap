import assert from "node:assert/strict";
import { validateCaptureMetadata } from "./validators";

function legacyCaptureMetadata() {
  return {
    schema: "mocap.capture.v1",
    takeId: "take_legacy",
    captureSessionId: "take_legacy",
    deviceId: "ios_local_device",
    deviceRole: "primary",
    deviceIndex: 0,
    captureMode: "solo",
    recordingStartedAt: "2026-05-30T10:00:00.000Z",
    recordingEndedAt: "2026-05-30T10:00:02.000Z",
    durationMs: 2000,
    video: {
      fps: 30,
      width: 1920,
      height: 1080,
      codec: "h264",
      orientation: "portrait",
      isMirrored: false,
      fileSizeBytes: 1024,
    },
    camera: {
      position: "back",
      focalLengthMm: null,
      intrinsics: null,
      lensModel: "wide",
    },
    quality: {
      averagePoseConfidence: 1,
      fullBodyVisibleRatio: 1,
      badFrames: 0,
      trackingLossCount: 0,
      poseFpsAverage: 30,
    },
    sync: {
      syncMethod: "single_device_clock",
      clockOffsetMs: 0,
      audioSyncMarker: null,
    },
    app: {
      version: "1.0.0",
      platform: "ios",
      buildNumber: "1",
    },
  };
}

function testOldUploadPayloadStillWorks() {
  const parsed = validateCaptureMetadata(legacyCaptureMetadata());

  assert.equal(parsed.takeId, "take_legacy");
  assert.equal(parsed.captureMode, "solo");
  assert.equal(parsed.deviceIndex, 0);
  assert.equal(parsed.sync.syncMethod, "single_device_clock");
}

function testNewOptionalSyncMetadataParses() {
  const framePresentationTimestampsMs = [0, 33.333333, 66.666667, 100.25];
  const parsed = validateCaptureMetadata({
    ...legacyCaptureMetadata(),
    takeId: "take_dual",
    captureSessionId: "cs_dual",
    deviceId: "device_1",
    deviceRole: "secondary",
    deviceIndex: 1,
    cameraId: "device_1_back",
    cameraRole: "secondary",
    captureMode: "dual",
    recordingStartWallClockMs: 1780135200000.5,
    recordingStartMonotonicMs: 442000.25,
    recordingStartTimeMs: 1780135200000,
    recordingEndTimeMs: 1780135202000,
    firstFrameTimestampMs: 0,
    framePresentationTimestampsMs,
    frameCount: 4,
    localClockTimeMs: 1780135200000,
    networkClockOffsetMs: -12.5,
    manualOffsetMs: null,
    hasAudioTrack: false,
    uploadOrder: 1,
    approxCameraAngle: 45,
    approximateCameraAngle: 45,
    cameraIntrinsics: {
      fx: 900.1,
      fy: 899.9,
      cx: 960.5,
      cy: 540.5,
      width: 1920,
      height: 1080,
    },
    intrinsicMatrixK: [900.1, 0, 960.5, 0, 899.9, 540.5, 0, 0, 1],
    lensDistortion: [0.1, -0.01, 0.001],
    focalLength: 4.2,
    sensorSize: { widthMm: 5.6, heightMm: 4.2 },
    video: {
      ...(legacyCaptureMetadata().video as Record<string, unknown>),
      durationMs: 2000,
      resolution: { width: 1920, height: 1080 },
      firstFrameTimestampMs: 0,
      framePresentationTimestampsMs,
      frameCount: 4,
      hasAudioTrack: false,
    },
    camera: {
      ...(legacyCaptureMetadata().camera as Record<string, unknown>),
      intrinsics: {
        fx: 900.1,
        fy: 899.9,
        cx: 960.5,
        cy: 540.5,
        width: 1920,
        height: 1080,
      },
      intrinsicMatrixK: [900.1, 0, 960.5, 0, 899.9, 540.5, 0, 0, 1],
      lensDistortion: [0.1, -0.01, 0.001],
      focalLength: 4.2,
      sensorSize: { widthMm: 5.6, heightMm: 4.2 },
    },
    sync: {
      syncMethod: "network_time_sync",
      clockOffsetMs: -12.5,
      networkClockOffsetMs: -12.5,
      localClockTimeMs: 1780135200000,
      audioSyncMarker: null,
    },
  });

  assert.equal(parsed.captureMode, "dual");
  assert.equal(parsed.cameraId, "device_1_back");
  assert.equal(parsed.cameraRole, "secondary");
  assert.equal(parsed.recordingStartTimeMs, 1780135200000);
  assert.equal(parsed.localClockTimeMs, 1780135200000);
  assert.equal(parsed.uploadOrder, 1);
  assert.deepEqual(parsed.framePresentationTimestampsMs, framePresentationTimestampsMs);
  assert.deepEqual(
    (parsed.video as Record<string, unknown>).framePresentationTimestampsMs,
    framePresentationTimestampsMs,
  );
  assert.equal(parsed.hasAudioTrack, false);
  assert.deepEqual(parsed.lensDistortion, [0.1, -0.01, 0.001]);
  assert.equal((parsed.sync as Record<string, unknown>).clockOffsetMs, -12.5);
  assert.equal((parsed.sync as Record<string, unknown>).networkClockOffsetMs, -12.5);
}

function testCameraIntrinsicsAreOptionalPerCamera() {
  const withIntrinsics = validateCaptureMetadata({
    ...legacyCaptureMetadata(),
    captureMode: "dual",
    camera: {
      ...(legacyCaptureMetadata().camera as Record<string, unknown>),
      intrinsics: {
        fx: 900,
        fy: 900,
        cx: 960,
        cy: 540,
        width: 1920,
        height: 1080,
      },
    },
  });
  const withoutIntrinsics = validateCaptureMetadata({
    ...legacyCaptureMetadata(),
    takeId: "take_dual_no_intrinsics",
    deviceId: "device_1",
    deviceRole: "secondary",
    deviceIndex: 1,
    captureMode: "dual",
    camera: {
      ...(legacyCaptureMetadata().camera as Record<string, unknown>),
      intrinsics: null,
    },
  });

  assert.equal(withIntrinsics.captureMode, "dual");
  assert.equal(withoutIntrinsics.captureMode, "dual");
  assert.equal(
    ((withoutIntrinsics.camera as Record<string, unknown>).intrinsics),
    null,
  );
}

testOldUploadPayloadStillWorks();
testNewOptionalSyncMetadataParses();
testCameraIntrinsicsAreOptionalPerCamera();
console.log("capture metadata validator tests passed");
