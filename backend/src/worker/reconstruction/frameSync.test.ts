import assert from "node:assert/strict";
import type { MultiViewSyncReport, PerCameraPoseArtifact } from "../types";
import { buildPerCameraPoseArtifact } from "../pose/poseExtraction";
import {
  FrameSyncError,
  buildMultiViewSyncReport,
  matchMultiViewFrames,
  validateMultiViewSyncReport,
} from "./frameSync";

function makeSourceVideo(
  deviceIndex: number,
): PerCameraPoseArtifact["sourceVideo"] {
  return {
    storageKey: `takes/take_sync/original/device_${deviceIndex}.mov`,
    normalizedStorageKey: `takes/take_sync/jobs/job_sync/normalized/device_${deviceIndex}.mp4`,
    fps: 30,
    width: 1280,
    height: 720,
    durationMs: 200,
  };
}

function makePoseArtifact(input: {
  deviceIndex: number;
  timestampsMs: readonly number[];
  takeId?: string;
  jobId?: string;
  deviceRole?: string;
}): PerCameraPoseArtifact {
  return buildPerCameraPoseArtifact({
    takeId: input.takeId ?? "take_sync",
    jobId: input.jobId ?? "job_sync",
    cameraId: `cam_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole ?? (input.deviceIndex === 0 ? "front" : "side"),
    sourceVideo: makeSourceVideo(input.deviceIndex),
    detectorResult: {
      detector: {
        name: "fixture_pose_detector",
        version: "fixture_v1",
        landmarkSchema: "body_33",
      },
      expectedFrameCount: input.timestampsMs.length,
      frames: input.timestampsMs.map((timestampMs, index) => ({
        frameIndex: index,
        timestampMs,
        keypoints2d: [{ x: 0.1 + index, y: 0.2 + input.deviceIndex }],
        confidence: [0.9],
        poseConfidence: 0.9,
      })),
    },
  });
}

function assertFrameSyncError(error: unknown) {
  assert.ok(error instanceof FrameSyncError);
  assert.equal(error.code, "multi_view_sync_failed");
}

function testTwoCameraExactTimestampMatching() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33, 66] }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [0, 33, 66] }),
    ],
  });

  assert.equal(report.schema, "mocap.multiview_sync.v1");
  assert.equal(report.referenceDeviceIndex, 0);
  assert.equal(report.metrics.matchedFrameCount, 3);
  assert.equal(report.metrics.droppedFrameCount, 0);
  assert.equal(report.metrics.averageTimeDeltaMs, 0);
  assert.equal(report.metrics.maxTimeDeltaMs, 0);
  assert.equal(report.metrics.syncConfidence, 1);
  assert.equal(report.matchedFrames.length, 3);
  assert.ok(
    report.matchedFrames.every((frameSet) => frameSet.observations.length === 2),
  );
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testTwoCameraOffsetWithinTolerance() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33, 66] }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [10, 43, 76] }),
    ],
    options: {
      toleranceMs: 12,
      highOffsetWarningThresholdMs: 5,
    },
  });
  const secondaryReport = report.devices.find((device) => device.deviceIndex === 1);

  assert.equal(report.metrics.matchedFrameCount, 3);
  assert.equal(report.metrics.droppedFrameCount, 0);
  assert.equal(report.metrics.averageTimeDeltaMs, 10);
  assert.equal(report.metrics.maxTimeDeltaMs, 10);
  assert.equal(report.metrics.syncConfidence, 1);
  assert.equal(secondaryReport?.offsetMs, 10);
  assert.equal(secondaryReport?.averageTimeDeltaMs, 10);
  assert.ok(report.warnings.includes("sync_offset_high"));
}

function testFramesOutsideToleranceDropped() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33, 66] }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [0, 80, 100] }),
    ],
    options: {
      toleranceMs: 10,
    },
  });

  assert.equal(report.metrics.matchedFrameCount, 1);
  assert.equal(report.metrics.droppedFrameCount, 4);
  assert.ok(report.metrics.syncConfidence < 0.5);
  assert.ok(report.warnings.includes("sync_confidence_low"));
}

function testDeviceZeroReferenceBehavior() {
  const result = matchMultiViewFrames({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [5, 38] }),
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33] }),
    ],
    options: {
      toleranceMs: 10,
    },
  });

  assert.equal(result.referenceDeviceIndex, 0);
  assert.equal(result.matchedFrames[0].referenceFrameIndex, 0);
  assert.equal(result.matchedFrames[0].timestampMs, 0);
  assert.equal(result.matchedFrames[0].observations[0].deviceIndex, 0);
  assert.equal(result.matchedFrames[0].observations[1].deviceIndex, 1);
}

function testInvalidInputValidation() {
  assert.throws(
    () =>
      buildMultiViewSyncReport({
        poseArtifacts: [
          makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33] }),
        ],
      }),
    (error) => {
      assertFrameSyncError(error);
      return true;
    },
  );

  assert.throws(
    () =>
      buildMultiViewSyncReport({
        poseArtifacts: [
          makePoseArtifact({ deviceIndex: 0, timestampsMs: [0] }),
          makePoseArtifact({
            deviceIndex: 1,
            timestampsMs: [0],
            takeId: "different_take",
          }),
        ],
      }),
    (error) => {
      assertFrameSyncError(error);
      return true;
    },
  );
}

function testInvalidReportValidation() {
  const invalidReport: MultiViewSyncReport = {
    schema: "mocap.multiview_sync.v1",
    takeId: "",
    jobId: "job_sync",
    referenceDeviceIndex: 0,
    devices: [
      {
        deviceIndex: 0,
        offsetMs: 0,
        confidence: 1.2,
        method: "video_timestamps",
        matchedFrameCount: 1,
        droppedFrameCount: 0,
        averageTimeDeltaMs: 0,
        maxTimeDeltaMs: 0,
      },
    ],
    matchedFrames: [
      {
        referenceFrameIndex: 0,
        timestampMs: 0,
        averageTimeDeltaMs: 0,
        observations: [
          {
            deviceIndex: 1,
            frameIndex: 0,
            timestampMs: 0,
            timeDeltaMs: 0,
            poseConfidence: 0.9,
          },
        ],
      },
    ],
    metrics: {
      matchedFrameCount: 1,
      droppedFrameCount: 0,
      averageTimeDeltaMs: 0,
      maxTimeDeltaMs: 0,
      syncConfidence: 1.2,
    },
    warnings: [],
  };
  const validation = validateMultiViewSyncReport(invalidReport);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.errors.includes("takeId is required"));
    assert.ok(
      validation.errors.includes("devices[0].confidence must be between 0 and 1"),
    );
    assert.ok(
      validation.errors.includes(
        "matchedFrames[0].observations must contain at least two devices",
      ),
    );
    assert.ok(validation.errors.includes("matchedFrames[0] must include the reference device"));
    assert.ok(
      validation.errors.includes("metrics.syncConfidence must be between 0 and 1"),
    );
  }
}

function testFourCameraBasicMatching() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33], deviceRole: "front" }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [1, 34], deviceRole: "left" }),
      makePoseArtifact({ deviceIndex: 2, timestampsMs: [2, 35], deviceRole: "right" }),
      makePoseArtifact({ deviceIndex: 3, timestampsMs: [3, 36], deviceRole: "back" }),
    ],
    options: {
      toleranceMs: 5,
    },
  });

  assert.equal(report.referenceDeviceIndex, 0);
  assert.equal(report.metrics.matchedFrameCount, 2);
  assert.equal(report.metrics.droppedFrameCount, 0);
  assert.equal(report.metrics.maxTimeDeltaMs, 3);
  assert.equal(report.metrics.syncConfidence, 1);
  assert.ok(
    report.matchedFrames.every((frameSet) => frameSet.observations.length === 4),
  );
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

testTwoCameraExactTimestampMatching();
testTwoCameraOffsetWithinTolerance();
testFramesOutsideToleranceDropped();
testDeviceZeroReferenceBehavior();
testInvalidInputValidation();
testInvalidReportValidation();
testFourCameraBasicMatching();

console.log("frame sync synthetic tests passed");
