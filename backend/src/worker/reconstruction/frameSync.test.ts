import assert from "node:assert/strict";
import type { MultiViewSyncReport, PerCameraPoseArtifact } from "../types";
import { buildPerCameraPoseArtifact } from "../pose/poseExtraction";
import {
  FrameSyncError,
  buildMultiViewSyncReport,
  matchMultiViewFrames,
  validateMultiViewSyncReport,
} from "./frameSync";
import { resolveWorkerPipelineBranch } from "./multiViewOrchestrator";

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
  includeTimestamps?: boolean;
  timestampSource?: "detector" | "video_timestamp" | "recording_start" | "frame_index";
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
        ...(input.includeTimestamps === false ? {} : { timestampMs }),
        ...(input.includeTimestamps === false
          ? {}
          : { timestampSource: input.timestampSource ?? "video_timestamp" }),
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
  assert.equal(report.schemaVersion, "mocap.multi_view_sync.v1");
  assert.equal(report.syncMethod, "frame_presentation_timestamp_sync");
  assert.equal(report.referenceDeviceId, "cam_0");
  assert.deepEqual(report.targetDeviceIds, ["cam_1"]);
  assert.equal(report.status, "ready");
  assert.equal(report.referenceDeviceIndex, 0);
  assert.equal(report.matchedFrameCount, 3);
  assert.equal(report.metrics.matchedFrameCount, 3);
  assert.equal(report.metrics.droppedFrameCount, 0);
  assert.equal(report.metrics.averageTimeDeltaMs, 0);
  assert.equal(report.metrics.p95TimeDeltaMs, 0);
  assert.equal(report.p95TimeDeltaMs, 0);
  assert.equal(report.metrics.maxTimeDeltaMs, 0);
  assert.equal(report.metrics.syncConfidence, 1);
  assert.equal(report.framePairs.length, 3);
  assert.deepEqual(report.framePairs[0], {
    referenceCameraId: "cam_0",
    referenceFrameIndex: 0,
    targetFrameIndex: 0,
    referenceTimestampMs: 0,
    targetTimestampMs: 0,
    deltaMs: 0,
    targetCameraId: "cam_1",
    targetDeviceIndex: 1,
    targetDeviceId: "cam_1",
  });
  assert.equal(report.metadataCompleteness?.device_0.hasFrameTimestamps, true);
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
  assert.equal(report.metrics.p95TimeDeltaMs, 10);
  assert.equal(report.metrics.syncConfidence, 1);
  assert.equal(secondaryReport?.offsetMs, 10);
  assert.equal(secondaryReport?.averageTimeDeltaMs, 10);
  assert.ok(report.warnings.includes("sync_offset_high"));
}

function testNetworkClockOffsetSyncCreatesMatchedPairs() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33, 66] }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [10, 43, 76] }),
    ],
    options: {
      toleranceMs: 2,
      networkClockOffsetMsByDevice: {
        0: 0,
        1: -10,
      },
      recordingStartMonotonicMsByDevice: {
        0: 1000,
        1: 1000,
      },
    },
  });

  assert.equal(report.syncMethod, "network_clock_offset_sync");
  assert.equal(report.status, "ready");
  assert.equal(report.matchedFrameCount, 3);
  assert.equal(report.averageTimeDeltaMs, 0);
  assert.equal(report.clockOffsetMs, -10);
  assert.equal(report.framePairs[0].deltaMs, 0);
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testMonotonicTimestampSyncAlignsByNativeTimeline() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
    ],
    options: {
      toleranceMs: 8,
      recordingStartMonotonicMsByDevice: {
        0: 1000,
        1: 1005,
      },
      framePresentationTimestampsMsByDevice: {
        0: [0, 33, 66],
        1: [0, 33, 66],
      },
    },
  });

  assert.equal(report.syncMethod, "monotonic_timestamp_sync");
  assert.equal(report.status, "ready");
  assert.equal(report.matchedFrameCount, 3);
  assert.equal(report.averageTimeDeltaMs, 5);
  assert.ok(report.syncConfidence > 0.45);
  assert.equal(report.framePairs[0].referenceTimestampMs, 1000);
  assert.equal(report.framePairs[0].targetTimestampMs, 1005);
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testFramePresentationTimestampSyncPreservesNativeArrays() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
    ],
    options: {
      toleranceMs: 6,
      framePresentationTimestampsMsByDevice: {
        0: [0, 33.3, 66.6],
        1: [4, 37.1, 70.2],
      },
    },
  });

  assert.equal(report.syncMethod, "frame_presentation_timestamp_sync");
  assert.equal(report.status, "ready");
  assert.equal(report.framePairs.length, 3);
  assert.equal(report.framePairs[0].targetTimestampMs, 4);
  assert.equal(report.framePairs[0].deltaMs, 4);
  assert.equal(report.framePairs[1].deltaMs, 3.8000000000000043);
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testFirstFrameTimestampSyncUsesRealFpsMetadata() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
    ],
    options: {
      toleranceMs: 8,
      firstFrameTimestampMsByDevice: {
        0: 0,
        1: 6,
      },
      fpsByDevice: {
        0: 30,
        1: 30,
      },
    },
  });

  assert.equal(report.syncMethod, "first_frame_timestamp_sync");
  assert.equal(report.status, "approximate");
  assert.equal(report.averageTimeDeltaMs, 6);
  assert.equal(report.syncConfidence, 0.7);
  assert.ok(report.warnings.includes("sync_first_frame_timestamp_approximation"));
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testWallClockSyncWarnsAboutClockDrift() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
    ],
    options: {
      toleranceMs: 15,
      recordingStartWallClockMsByDevice: {
        0: 5000,
        1: 5012,
      },
    },
  });

  assert.equal(report.syncMethod, "wall_clock_sync");
  assert.equal(report.status, "approximate");
  assert.equal(report.averageTimeDeltaMs, 12);
  assert.ok(report.warnings.includes("sync_wall_clock_drift_possible"));
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testManualOffsetSyncAppliesProvidedOffset() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33, 66],
        timestampSource: "frame_index",
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [10, 43, 76],
        timestampSource: "frame_index",
      }),
    ],
    options: {
      toleranceMs: 2,
      manualOffsetMsByDevice: {
        1: -10,
      },
    },
  });

  assert.equal(report.syncMethod, "manual_offset_sync");
  assert.equal(report.status, "approximate");
  assert.equal(report.manualOffsetMs, -10);
  assert.equal(report.averageTimeDeltaMs, 0);
  assert.equal(report.framePairs[0].targetTimestampMs, 0);
  assert.ok(report.warnings.includes("sync_manual_offset_used"));
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testMissingTimestampsFallsBackToDiagnosticIndexSync() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33, 66],
        includeTimestamps: false,
      }),
    ],
  });

  assert.equal(report.syncMethod, "index_based_diagnostic_sync");
  assert.equal(report.status, "diagnostic_only");
  assert.equal(report.matchedFrameCount, 3);
  assert.equal(report.framePairs.length, 3);
  assert.equal(report.syncConfidence, 0.45);
  assert.ok(report.warnings.includes("missing_timestamps"));
  assert.ok(report.warnings.includes("sync_index_based_diagnostic"));
  assert.ok(report.warnings.includes("sync_diagnostic_approximation"));
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testMissingMetadataOptionsFallBackToDiagnosticSync() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33],
        includeTimestamps: false,
      }),
    ],
    options: undefined,
  });

  assert.equal(report.syncMethod, "index_based_diagnostic_sync");
  assert.equal(report.status, "diagnostic_only");
  assert.ok(report.warnings.includes("missing_timestamps"));
  assert.ok(report.warnings.includes("sync_diagnostic_approximation"));
}

function testMissingTimestampsCanReportMissingWithoutIndexFallback() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33],
        includeTimestamps: false,
      }),
    ],
    options: {
      allowIndexFallback: false,
    },
  });

  assert.equal(report.syncMethod, "index_based_diagnostic_sync");
  assert.equal(report.status, "missing_timestamps");
  assert.equal(report.matchedFrameCount, 0);
  assert.equal(report.syncConfidence, 0);
  assert.ok(report.warnings.includes("missing_timestamps"));
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
}

function testIndexBasedSyncDoesNotClaimPerfectConfidence() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({
        deviceIndex: 0,
        timestampsMs: [0, 33],
        includeTimestamps: false,
      }),
      makePoseArtifact({
        deviceIndex: 1,
        timestampsMs: [0, 33],
        includeTimestamps: false,
      }),
    ],
  });

  assert.equal(report.status, "diagnostic_only");
  assert.equal(report.syncMethod, "index_based_diagnostic_sync");
  assert.ok(report.syncConfidence < 1);
}

function testAudioSyncIsNotClaimedWithoutUsableAudioAnalysis() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [0, 33, 66] }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [0, 33, 66] }),
    ],
    options: {
      hasAudioTrackByDevice: {
        0: false,
        1: false,
      },
      audioAnalysisAvailable: false,
    },
  });

  assert.notEqual(report.syncMethod, "audio_marker_sync");
  assert.equal(report.syncMethod, "frame_presentation_timestamp_sync");
  assert.ok(report.warnings.includes("sync_audio_track_missing"));
}

function testInsufficientFramesFailsGracefully() {
  const report = buildMultiViewSyncReport({
    poseArtifacts: [
      makePoseArtifact({ deviceIndex: 0, timestampsMs: [], includeTimestamps: false }),
      makePoseArtifact({ deviceIndex: 1, timestampsMs: [0], includeTimestamps: false }),
    ],
  });

  assert.equal(report.status, "insufficient_frames");
  assert.equal(report.matchedFrameCount, 0);
  assert.equal(report.syncConfidence, 0);
  assert.ok(report.warnings.includes("insufficient_frames"));
  assert.deepEqual(validateMultiViewSyncReport(report), { ok: true });
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
    syncMethod: "video_timestamps",
    referenceDeviceId: "",
    targetDeviceIds: [],
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
    framePairs: [
      {
        referenceFrameIndex: 0,
        targetFrameIndex: 0,
        referenceTimestampMs: 0,
        targetTimestampMs: 0,
        deltaMs: 0,
      },
    ],
    matchedFrameCount: 1,
    averageTimeDeltaMs: 0,
    p95TimeDeltaMs: 0,
    syncConfidence: 1.2,
    droppedFrameCount: 0,
    status: "ready",
    metrics: {
      matchedFrameCount: 1,
      droppedFrameCount: 0,
      averageTimeDeltaMs: 0,
      maxTimeDeltaMs: 0,
      p95TimeDeltaMs: 0,
      syncConfidence: 1.2,
    },
    warnings: [],
  };
  const validation = validateMultiViewSyncReport(invalidReport);

  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.errors.includes("takeId is required"));
    assert.ok(validation.errors.includes("referenceDeviceId is required"));
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
    assert.ok(validation.errors.includes("syncConfidence must be between 0 and 1"));
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

function testSingleCameraBranchUnaffected() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.additionalVideosProvided, 0);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

testTwoCameraExactTimestampMatching();
testTwoCameraOffsetWithinTolerance();
testNetworkClockOffsetSyncCreatesMatchedPairs();
testMonotonicTimestampSyncAlignsByNativeTimeline();
testFramePresentationTimestampSyncPreservesNativeArrays();
testFirstFrameTimestampSyncUsesRealFpsMetadata();
testWallClockSyncWarnsAboutClockDrift();
testManualOffsetSyncAppliesProvidedOffset();
testMissingTimestampsFallsBackToDiagnosticIndexSync();
testMissingMetadataOptionsFallBackToDiagnosticSync();
testMissingTimestampsCanReportMissingWithoutIndexFallback();
testIndexBasedSyncDoesNotClaimPerfectConfidence();
testAudioSyncIsNotClaimedWithoutUsableAudioAnalysis();
testInsufficientFramesFailsGracefully();
testFramesOutsideToleranceDropped();
testDeviceZeroReferenceBehavior();
testInvalidInputValidation();
testInvalidReportValidation();
testFourCameraBasicMatching();
testSingleCameraBranchUnaffected();

console.log("frame sync synthetic tests passed");
