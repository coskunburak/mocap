import assert from "node:assert/strict";
import { buildCaptureMetadataDiagnostics } from "./captureMetadataDiagnostics";

function baseMetadata(deviceIndex: number, input: Record<string, unknown> = {}) {
  return {
    schema: "mocap.capture.v1",
    takeId: "take_metadata_diagnostics",
    captureSessionId: "cs_metadata_diagnostics",
    deviceId: `device_${deviceIndex}`,
    deviceRole: deviceIndex === 0 ? "primary" : "secondary",
    deviceIndex,
    cameraId: `device_${deviceIndex}_back`,
    cameraRole: deviceIndex === 0 ? "primary" : "secondary",
    captureMode: "dual",
    recordingStartedAt: "2026-05-30T10:00:00.000Z",
    recordingEndedAt: "2026-05-30T10:00:02.000Z",
    durationMs: 2000,
    fps: 30,
    width: 1920,
    height: 1080,
    video: {
      fps: 30,
      width: 1920,
      height: 1080,
      durationMs: 2000,
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
    ...input,
  };
}

function source(deviceIndex: number, captureMetadata: unknown) {
  return {
    deviceIndex,
    deviceId: `device_${deviceIndex}`,
    deviceRole: deviceIndex === 0 ? "primary" : "secondary",
    captureMetadata,
  };
}

function testMissingMetadataFallbackIsDiagnosticOnly() {
  const diagnostics = buildCaptureMetadataDiagnostics([
    source(0, baseMetadata(0)),
    source(1, {
      ...baseMetadata(1),
      recordingStartMonotonicMs: undefined,
      framePresentationTimestampsMs: undefined,
      camera: {
        ...(baseMetadata(1).camera as Record<string, unknown>),
        intrinsics: null,
      },
    }),
  ]);

  assert.equal(diagnostics.hasFrameTimestamps, false);
  assert.equal(diagnostics.hasIntrinsics, false);
  assert.equal(diagnostics.metadataCompleteness.status, "partial");
  assert.ok(
    diagnostics.missingMetadataWarnings.includes(
      "metadata_frame_timestamps_incomplete",
    ),
  );
  assert.ok(
    diagnostics.missingMetadataWarnings.includes(
      "metadata_camera_intrinsics_incomplete",
    ),
  );
}

function testFrameTimestampAndAudioHonesty() {
  const timestamps = [0, 33.333333, 66.666667];
  const diagnostics = buildCaptureMetadataDiagnostics([
    source(
      0,
      baseMetadata(0, {
        framePresentationTimestampsMs: timestamps,
        hasAudioTrack: false,
        video: {
          ...(baseMetadata(0).video as Record<string, unknown>),
          framePresentationTimestampsMs: timestamps,
          hasAudioTrack: false,
        },
      }),
    ),
    source(
      1,
      baseMetadata(1, {
        framePresentationTimestampsMs: timestamps,
        video: {
          ...(baseMetadata(1).video as Record<string, unknown>),
          framePresentationTimestampsMs: timestamps,
        },
      }),
    ),
  ]);

  assert.equal(diagnostics.hasFrameTimestamps, true);
  assert.deepEqual(
    diagnostics.availableTimestampFields.filter((field) =>
      field.includes("framePresentationTimestampsMs"),
    ),
    ["framePresentationTimestampsMs", "video.framePresentationTimestampsMs"],
  );
  assert.equal(diagnostics.hasAudioTrack, false);
  assert.equal(diagnostics.audioTrackDeviceCount, 0);
  assert.ok(
    diagnostics.missingMetadataWarnings.includes("metadata_audio_sync_unavailable"),
  );
}

function testIntrinsicsAreOptionalPerCamera() {
  const diagnostics = buildCaptureMetadataDiagnostics([
    source(
      0,
      baseMetadata(0, {
        camera: {
          ...(baseMetadata(0).camera as Record<string, unknown>),
          intrinsics: {
            fx: 900,
            fy: 900,
            cx: 960,
            cy: 540,
            width: 1920,
            height: 1080,
          },
        },
      }),
    ),
    source(1, baseMetadata(1)),
  ]);

  assert.equal(diagnostics.intrinsicsDeviceCount, 1);
  assert.equal(diagnostics.hasIntrinsics, false);
  assert.ok(diagnostics.availableCameraMetadataFields.includes("camera.intrinsics"));
  assert.ok(
    diagnostics.missingMetadataWarnings.includes(
      "metadata_missing_device_1_camera_intrinsics",
    ),
  );
}

testMissingMetadataFallbackIsDiagnosticOnly();
testFrameTimestampAndAudioHonesty();
testIntrinsicsAreOptionalPerCamera();
console.log("capture metadata diagnostics tests passed");
