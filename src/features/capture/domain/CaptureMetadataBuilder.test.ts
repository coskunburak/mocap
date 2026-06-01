import assert from "node:assert/strict";
import { validateCaptureMetadata } from "../../../domain/mocap/models/CaptureMetadata";
import type { VideoRecordingResult } from "./CameraEngine";
import { buildCaptureMetadata } from "./CaptureMetadataBuilder";

function recording(input: Partial<VideoRecordingResult> = {}): VideoRecordingResult {
  return {
    takeId: "take_mobile_metadata",
    localUri: "file:///tmp/take_mobile_metadata.mp4",
    startedAt: "2026-05-30T10:00:00.000Z",
    endedAt: "2026-05-30T10:00:02.000Z",
    durationMs: 2000,
    fps: 30,
    width: 1920,
    height: 1080,
    fileSizeBytes: 1024,
    codec: "h264",
    container: "mp4",
    platform: "ios",
    cameraPosition: "back",
    orientation: "portrait",
    ...input,
  };
}

function testNewOptionalSyncMetadataIsSerialized() {
  const framePresentationTimestampsMs = [0, 33.333333, 66.666667];
  const metadata = buildCaptureMetadata({
    recording: recording({
      recordingStartWallClockMs: 1780135200000,
      recordingStartMonotonicMs: 442000.25,
      firstFrameTimestampMs: 0,
      framePresentationTimestampsMs,
      frameCount: 3,
      hasAudioTrack: false,
    }),
    captureSessionId: "cs_dual_metadata",
    deviceId: "device_0",
    deviceRole: "primary",
    deviceIndex: 0,
    cameraRole: "primary",
    captureMode: "dual",
    localClockTimeMs: 1780135200000,
    uploadOrder: 0,
    quality: {
      averagePoseConfidence: 1,
      fullBodyVisibleRatio: 1,
      badFrames: 0,
      trackingLossCount: 0,
      poseFpsAverage: 30,
    },
    sync: {
      syncMethod: "network_time_sync",
      clockOffsetMs: -12.5,
    },
    appVersion: "1.0.0",
    buildNumber: "1",
  });

  assert.equal(metadata.cameraId, "device_0_back");
  assert.equal(metadata.cameraRole, "primary");
  assert.equal(metadata.recordingStartTimeMs, 1780135200000);
  assert.equal(metadata.recordingEndTimeMs, 1780135202000);
  assert.equal(metadata.recordingStartWallClockMs, 1780135200000);
  assert.equal(metadata.recordingStartMonotonicMs, 442000.25);
  assert.equal(metadata.firstFrameTimestampMs, 0);
  assert.deepEqual(metadata.framePresentationTimestampsMs, framePresentationTimestampsMs);
  assert.equal(metadata.frameCount, 3);
  assert.equal(metadata.localClockTimeMs, 1780135200000);
  assert.equal(metadata.networkClockOffsetMs, -12.5);
  assert.equal(metadata.hasAudioTrack, false);
  assert.equal(metadata.uploadOrder, 0);
  assert.equal(metadata.fps, 30);
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
  assert.deepEqual(metadata.resolution, { width: 1920, height: 1080 });
  assert.equal(metadata.video.durationMs, 2000);
  assert.equal(metadata.video.firstFrameTimestampMs, 0);
  assert.deepEqual(metadata.video.framePresentationTimestampsMs, framePresentationTimestampsMs);
  assert.equal(metadata.video.frameCount, 3);
  assert.equal(metadata.video.hasAudioTrack, false);
  assert.deepEqual(metadata.video.resolution, { width: 1920, height: 1080 });
  assert.equal(metadata.sync.localClockTimeMs, 1780135200000);
  assert.equal(metadata.sync.networkClockOffsetMs, -12.5);
  assert.deepEqual(validateCaptureMetadata(metadata), { ok: true, errors: [] });
}

function testMissingOptionalMetadataDoesNotCrashMobileBuilder() {
  const metadata = buildCaptureMetadata({
    recording: recording({
      startedAt: "not-a-date",
      endedAt: "also-not-a-date",
      platform: "android",
      cameraPosition: "unknown",
    }),
    captureSessionId: "cap_local_take",
    deviceId: "android_local_device",
    quality: {
      averagePoseConfidence: 1,
      fullBodyVisibleRatio: 1,
      badFrames: 0,
      trackingLossCount: 0,
      poseFpsAverage: 30,
    },
    appVersion: "1.0.0",
  });

  assert.equal(metadata.recordingStartTimeMs, undefined);
  assert.equal(metadata.recordingEndTimeMs, undefined);
  assert.equal(metadata.localClockTimeMs, undefined);
  assert.equal(metadata.sync.localClockTimeMs, undefined);
  assert.equal(metadata.cameraId, "android_local_device_unknown");
  assert.deepEqual(validateCaptureMetadata(metadata), { ok: true, errors: [] });
}

testNewOptionalSyncMetadataIsSerialized();
testMissingOptionalMetadataDoesNotCrashMobileBuilder();
console.log("capture metadata builder tests passed");
