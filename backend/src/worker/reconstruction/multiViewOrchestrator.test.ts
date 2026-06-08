import assert from "node:assert/strict";
import type { Matrix3x3, Vector3 } from "../types";
import {
  buildMissingPoseFramesArtifact,
  buildPerCameraPoseArtifact,
} from "../pose/poseExtraction";
import { buildCameraCalibrationArtifact } from "./cameraCalibration";
import {
  MultiViewOrchestratorError,
  type MultiViewOrchestratorSource,
  type MultiViewPoseAdapter,
  resolveWorkerPipelineBranch,
  resolveMultiViewStageFailure,
  runMultiViewReconstruction,
  runMultiViewOrchestratorShell,
} from "./multiViewOrchestrator";
import { projectPoint } from "./triangulation";

const IDENTITY_INTRINSIC: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_ROTATION: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SYNTHETIC_POINT: Vector3 = [0.2, 0.1, 4];

function source(input: {
  deviceIndex: number;
  deviceRole: string;
  translation: Vector3;
}): MultiViewOrchestratorSource {
  return {
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    videoStorageKey: `takes/take_branch/original/device_${input.deviceIndex}.mov`,
    normalizedStorageKey: `takes/take_branch/jobs/job_branch/normalized/device_${input.deviceIndex}.mp4`,
    normalizedPath: `/tmp/device_${input.deviceIndex}.mp4`,
    fps: 30,
    width: 1280,
    height: 720,
    durationMs: 1000,
    intrinsics: {
      matrix: IDENTITY_INTRINSIC,
    },
    extrinsics: {
      rotation: IDENTITY_ROTATION,
      translation: input.translation,
    },
  };
}

function dualSources() {
  return [
    source({ deviceIndex: 0, deviceRole: "front", translation: [0, 0, 0] }),
    source({ deviceIndex: 1, deviceRole: "right", translation: [-1, 0, 0] }),
  ];
}

function proSources() {
  return [
    source({ deviceIndex: 0, deviceRole: "front", translation: [0, 0, 0] }),
    source({ deviceIndex: 1, deviceRole: "right", translation: [-1, 0, 0] }),
    source({ deviceIndex: 2, deviceRole: "back", translation: [0, -1, 0] }),
    source({ deviceIndex: 3, deviceRole: "left", translation: [1, 0, 0] }),
  ];
}

function calibrationDevices(sources: readonly MultiViewOrchestratorSource[]) {
  return sources.map((item) => ({
    deviceIndex: item.deviceIndex,
    deviceRole: item.deviceRole,
    imageWidth: item.width,
    imageHeight: item.height,
    intrinsics: item.intrinsics,
    extrinsics: item.extrinsics,
  }));
}

function fixturePoseAdapter(): MultiViewPoseAdapter {
  return {
    name: "fixture_pose_adapter",
    version: "fixture_v1",
    async extractPoseArtifacts(input) {
      const calibration = buildCameraCalibrationArtifact({
        takeId: input.takeId,
        jobId: input.jobId,
        devices: calibrationDevices(input.processedSources),
      });
      return calibration.devices.map((camera) => {
        const sourceItem = input.processedSources.find(
          (item) => item.deviceIndex === camera.deviceIndex,
        );
        if (!sourceItem) {
          throw new Error(`Missing source for device ${camera.deviceIndex}`);
        }
        const point = projectPoint({
          projection: camera.projection,
          point: SYNTHETIC_POINT,
        });
        return buildPerCameraPoseArtifact({
          takeId: input.takeId,
          jobId: input.jobId,
          cameraId: `cam_${camera.deviceIndex}`,
          deviceIndex: camera.deviceIndex,
          deviceRole: camera.deviceRole,
          sourceVideo: {
            storageKey: sourceItem.videoStorageKey,
            normalizedStorageKey: sourceItem.normalizedStorageKey,
            fps: sourceItem.fps,
            width: sourceItem.width,
            height: sourceItem.height,
            durationMs: sourceItem.durationMs,
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
                keypoints2d: [point],
                confidence: [0.95],
                poseConfidence: 0.95,
              },
            ],
          },
        });
      });
    },
  };
}

function assertOrchestratorError(error: unknown, code: string) {
  assert.ok(error instanceof MultiViewOrchestratorError);
  assert.equal(error.code, code);
}

function testSoloAlwaysUsesSingleCameraWham() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "solo",
    selectedVideoCount: 2,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: false,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.reason, "solo_capture");
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

function testSingleSelectedVideoUsesSingleCameraWham() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: false,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.reason, "single_selected_video");
  assert.equal(branch.additionalVideosProvided, 0);
}

function testDualFeatureEnabledUsesMultiViewBranch() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 2,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "multi_view_reconstruction");
  assert.equal(branch.reason, "multi_view_feature_enabled");
  assert.equal(branch.additionalVideosProvided, 1);
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

function testProFeatureEnabledUsesMultiViewBranch() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "pro_4_camera",
    selectedVideoCount: 4,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "multi_view_reconstruction");
  assert.equal(branch.reason, "multi_view_feature_enabled");
  assert.equal(branch.additionalVideosProvided, 3);
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

function testFeatureDisabledUsesPrimaryWhamFallback() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 2,
    enableMultiViewReconstruction: false,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "primary_wham_fallback");
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.additionalVideosProvided, 1);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

function testFeatureDisabledAndFallbackDisallowedBlocks() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "dual",
    selectedVideoCount: 2,
    enableMultiViewReconstruction: false,
    allowPrimaryWhamFallback: false,
  });

  assert.equal(branch.kind, "multi_view_disabled");
  assert.equal(branch.primaryVideoUsed, false);
  assert.equal(branch.additionalVideosProvided, 1);
}

function testOrchestratorShellReportsBlockedPoseDetector() {
  const result = runMultiViewOrchestratorShell({
    takeId: "take_branch",
    jobId: "job_branch",
    source: "dual_camera",
    sources: [
      {
        deviceIndex: 0,
        deviceRole: "primary",
        videoStorageKey: "takes/take_branch/original/device_0.mov",
        normalizedStorageKey: "takes/take_branch/jobs/job_branch/normalized/device_0.mp4",
        normalizedPath: "/tmp/device_0.mp4",
        fps: 30,
        width: 1280,
        height: 720,
        durationMs: 1000,
      },
      {
        deviceIndex: 1,
        deviceRole: "secondary",
        videoStorageKey: "takes/take_branch/original/device_1.mov",
        normalizedStorageKey: "takes/take_branch/jobs/job_branch/normalized/device_1.mp4",
        normalizedPath: "/tmp/device_1.mp4",
        fps: 30,
        width: 1280,
        height: 720,
        durationMs: 1000,
      },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "pose_detector_adapter_missing");
  assert.equal(result.sourceCount, 2);
  assert.equal(result.primaryVideoUsed, false);
  assert.equal(result.additionalVideosProvided, 1);
  assert.equal(result.multiViewConstraintsUsed, false);
}

async function testDualFixtureAdapterFullReconstruction() {
  const result = await runMultiViewReconstruction({
    takeId: "take_branch",
    jobId: "job_branch",
    source: "dual_camera",
    processedSources: dualSources(),
    poseAdapter: fixturePoseAdapter(),
  });
  const landmark = result.reconstructionArtifact.frames[0].landmarks3D[0];

  assert.equal(result.status, "succeeded");
  assert.equal(result.adapter.name, "fixture_pose_adapter");
  assert.equal(result.poseArtifacts.length, 2);
  assert.equal(result.syncReport.metrics.matchedFrameCount, 1);
  assert.equal(result.calibrationArtifact.devices.length, 2);
  assert.equal(result.captureVolumeArtifact.schemaVersion, "mocap.capture_volume.v1");
  assert.equal(result.captureVolumeArtifact.status, "ready");
  assert.equal(result.reconstructionArtifact.schema, "mocap.multiview_reconstruction.v1");
  assert.equal(
    result.triangulatedJointTrackArtifact?.schema,
    "mocap.triangulated_joint_track.v1",
  );
  assert.equal(result.triangulatedJointTrackArtifact?.status, "ready");
  assert.equal(result.triangulatedJointTrackArtifact?.trackedFrameCount, 1);
  assert.equal(landmark.source, "triangulated");
  assert.ok(Math.abs(landmark.x - SYNTHETIC_POINT[0]) < 1e-6);
  assert.ok(Math.abs(landmark.y - SYNTHETIC_POINT[1]) < 1e-6);
  assert.ok(Math.abs(landmark.z - SYNTHETIC_POINT[2]) < 1e-6);
}

async function testProFixtureAdapterFullReconstruction() {
  const result = await runMultiViewReconstruction({
    takeId: "take_branch",
    jobId: "job_branch",
    source: "multi_view",
    processedSources: proSources(),
    poseAdapter: fixturePoseAdapter(),
  });
  const landmark = result.reconstructionArtifact.frames[0].landmarks3D[0];

  assert.equal(result.status, "succeeded");
  assert.equal(result.poseArtifacts.length, 4);
  assert.equal(result.syncReport.metrics.matchedFrameCount, 1);
  assert.equal(result.calibrationArtifact.devices.length, 4);
  assert.equal(result.captureVolumeArtifact.validCameraCount, 4);
  assert.equal(result.reconstructionArtifact.source, "multi_view");
  assert.deepEqual(landmark.views, [0, 1, 2, 3]);
}

async function testMissingProductionAdapterFailsExplicitly() {
  await assert.rejects(
    () =>
      runMultiViewReconstruction({
        takeId: "take_branch",
        jobId: "job_branch",
        source: "dual_camera",
        processedSources: dualSources(),
      }),
    (error) => {
      assertOrchestratorError(error, "multi_view_pose_extraction_failed");
      return true;
    },
  );
}

async function testMissingAdapterFallbackDecision() {
  try {
    await runMultiViewReconstruction({
      takeId: "take_branch",
      jobId: "job_branch",
      source: "dual_camera",
      processedSources: dualSources(),
    });
    assert.fail("Expected missing adapter to throw");
  } catch (error) {
    const fallback = resolveMultiViewStageFailure({
      error,
      allowPrimaryWhamFallback: true,
    });
    const failed = resolveMultiViewStageFailure({
      error,
      allowPrimaryWhamFallback: false,
    });

    assert.equal(fallback.action, "fallback_to_primary_wham");
    assert.equal(fallback.shouldContinueWithPrimaryWham, true);
    assert.equal(fallback.errorCode, "multi_view_pose_extraction_failed");
    assert.equal(failed.action, "fail_job");
    assert.equal(failed.shouldContinueWithPrimaryWham, false);
    assert.equal(failed.errorCode, "multi_view_pose_extraction_failed");
  }
}

async function testAdapterFailureFailsExplicitly() {
  const failingAdapter: MultiViewPoseAdapter = {
    name: "failing_fixture_adapter",
    version: "fixture_v1",
    async extractPoseArtifacts() {
      throw new Error("fixture adapter failed");
    },
  };

  await assert.rejects(
    () =>
      runMultiViewReconstruction({
        takeId: "take_branch",
        jobId: "job_branch",
        source: "dual_camera",
        processedSources: dualSources(),
        poseAdapter: failingAdapter,
      }),
    (error) => {
      assertOrchestratorError(error, "multi_view_pose_extraction_failed");
      return true;
    },
  );
}

async function testMissingPoseFramesFallbackDecision() {
  const missingDeviceAdapter: MultiViewPoseAdapter = {
    name: "missing_device_fixture_adapter",
    version: "fixture_v1",
    async extractPoseArtifacts(input) {
      const sources = input.processedSources;
      const first = sources[0];
      const second = sources[1];
      if (!first || !second) {
        throw new Error("Fixture requires two sources.");
      }
      return [
        buildPerCameraPoseArtifact({
          takeId: input.takeId,
          jobId: input.jobId,
          cameraId: `cam_${first.deviceIndex}`,
          deviceIndex: first.deviceIndex,
          deviceRole: first.deviceRole,
          sourceVideo: {
            storageKey: first.videoStorageKey,
            normalizedStorageKey: first.normalizedStorageKey,
            fps: first.fps,
            width: first.width,
            height: first.height,
            durationMs: first.durationMs,
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
                keypoints2d: [{ x: 0.5, y: 0.5 }],
                confidence: [0.9],
              },
            ],
          },
        }),
        buildMissingPoseFramesArtifact({
          takeId: input.takeId,
          jobId: input.jobId,
          cameraId: `cam_${second.deviceIndex}`,
          deviceIndex: second.deviceIndex,
          deviceRole: second.deviceRole,
          sourceVideo: {
            storageKey: second.videoStorageKey,
            normalizedStorageKey: second.normalizedStorageKey,
            fps: second.fps,
            width: second.width,
            height: second.height,
            durationMs: second.durationMs,
          },
          reason: "No 2D landmarks were produced for device_1.",
        }),
      ];
    },
  };

  let capturedError: unknown;
  await assert.rejects(
    () =>
      runMultiViewReconstruction({
        takeId: "take_branch",
        jobId: "job_branch",
        source: "dual_camera",
        processedSources: dualSources(),
        poseAdapter: missingDeviceAdapter,
      }),
    (error) => {
      capturedError = error;
      assertOrchestratorError(error, "multi_view_pose_extraction_failed");
      return true;
    },
  );

  const fallback = resolveMultiViewStageFailure({
    error: capturedError,
    allowPrimaryWhamFallback: true,
  });
  assert.equal(fallback.action, "fallback_to_primary_wham");
  assert.equal(fallback.shouldContinueWithPrimaryWham, true);
  assert.equal(fallback.errorCode, "multi_view_pose_extraction_failed");
}

async function testMissingProjectionErrorPropagation() {
  const sources = dualSources();
  const calibration = buildCameraCalibrationArtifact({
    takeId: "take_branch",
    jobId: "job_branch",
    devices: calibrationDevices(sources),
  });

  await assert.rejects(
    () =>
      runMultiViewReconstruction({
        takeId: "take_branch",
        jobId: "job_branch",
        source: "dual_camera",
        processedSources: sources,
        poseAdapter: fixturePoseAdapter(),
        calibrationArtifact: {
          ...calibration,
          devices: [calibration.devices[0]],
        },
      }),
    (error) => {
      assertOrchestratorError(error, "camera_projection_invalid");
      return true;
    },
  );
}

void (async () => {
  testSoloAlwaysUsesSingleCameraWham();
  testSingleSelectedVideoUsesSingleCameraWham();
  testDualFeatureEnabledUsesMultiViewBranch();
  testProFeatureEnabledUsesMultiViewBranch();
  testFeatureDisabledUsesPrimaryWhamFallback();
  testFeatureDisabledAndFallbackDisallowedBlocks();
  testOrchestratorShellReportsBlockedPoseDetector();
  await testDualFixtureAdapterFullReconstruction();
  await testProFixtureAdapterFullReconstruction();
  await testMissingProductionAdapterFailsExplicitly();
  await testMissingAdapterFallbackDecision();
  await testAdapterFailureFailsExplicitly();
  await testMissingPoseFramesFallbackDecision();
  await testMissingProjectionErrorPropagation();
  console.log("multi-view orchestrator shell tests passed");
})();
