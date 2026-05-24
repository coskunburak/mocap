import assert from "node:assert/strict";
import { buildQualityReport } from "../worker/export/exportValidation";
import { resolveWorkerPipelineBranch } from "../worker/reconstruction/multiViewOrchestrator";
import {
  buildWhamInputUsageMetrics,
} from "../worker/whamInputUsage";
import type {
  CleanupReport,
  PoseFramesArtifact,
  SolvedMotionArtifact,
} from "../worker/types";

const SINGLE_CAMERA_EXPORT_FORMATS = [
  "smpl_parameters_json",
  "raw_solved_motion_json",
  "solved_motion_json",
  "cleanup_report_json",
  "quality_report_json",
  "preview_summary_json",
  "motion_pipeline_report_json",
  "wham_overlay_preview_mp4",
  "bvh",
] as const;

function pose(): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: "take_single_regression",
    jobId: "job_single_regression",
    sourceVideo: {
      storageKey: "takes/take_single_regression/original/device_0.mov",
      normalizedStorageKey:
        "takes/take_single_regression/jobs/job_single_regression/normalized.mp4",
      fps: 30,
      width: 1280,
      height: 720,
      durationMs: 1000,
    },
    detector: {
      name: "wham_internal_vitpose",
      version: "fixture_v1",
      landmarkSchema: "wham_internal",
    },
    frames: [],
    quality: {
      frameCount: 30,
      detectedFrameCount: 30,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 1,
    },
  };
}

function solved(): SolvedMotionArtifact {
  return {
    schema: "mocap.solved_motion.v1",
    takeId: "take_single_regression",
    jobId: "job_single_regression",
    skeleton: {
      name: "mocap_humanoid_v1",
      rotationOrder: "XYZ",
      coordinateSystem: "right_handed_y_up",
    },
    fps: 30,
    frameCount: 30,
    durationMs: 1000,
    frames: [],
    validation: {
      ok: true,
      warnings: [],
      errors: [],
    },
  };
}

function cleanup(): CleanupReport {
  return {
    schema: "mocap.cleanup_report.v1",
    takeId: "take_single_regression",
    jobId: "job_single_regression",
    algorithm: {
      name: "cleanup_quality_v1_5",
      smoothing: "confidence_aware_exponential",
      interpolation: "nearest_linear",
      footLocking: "basic_contact_anchor",
    },
    metrics: {
      sourceFrameCount: 30,
      solvedFrameCount: 30,
      cleanedFrameCount: 30,
      interpolatedFrameCount: 0,
      outlierFrameCount: 0,
      missingLandmarkRatio: 0,
      jitterScore: 1,
      jitterRms: 0,
      rootStability: 1,
      rootVerticalJitter: 0,
      footSlidingScore: 1,
      footSlidingDistance: 0,
      footContactFrameCount: 20,
      footLockFrameCount: 20,
      boneLengthConsistency: 1,
      boneLengthVariation: 0,
      leftRightSwapCount: 0,
      smoothingStrength: 0.5,
    },
    warnings: [],
    actions: [],
  };
}

function validation() {
  return {
    ok: true,
    errors: [],
    warnings: [],
    blenderOk: true,
    blenderSkipped: false,
  };
}

function testSoloBranchGuard() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "solo",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.additionalVideosProvided, 0);
  assert.equal(branch.multiViewConstraintsUsed, false);
}

function testSingleSelectedVideoGuard() {
  for (const captureMode of ["dual", "pro_4_camera"] as const) {
    const branch = resolveWorkerPipelineBranch({
      captureMode,
      selectedVideoCount: 1,
      enableMultiViewReconstruction: true,
      allowPrimaryWhamFallback: true,
    });

    assert.equal(branch.kind, "single_camera_wham");
    assert.equal(branch.reason, "single_selected_video");
    assert.equal(branch.additionalVideosProvided, 0);
    assert.equal(branch.multiViewConstraintsUsed, false);
  }
}

function testSingleCameraArtifactSet() {
  assert.deepEqual([...SINGLE_CAMERA_EXPORT_FORMATS].sort(), [
    "bvh",
    "cleanup_report_json",
    "motion_pipeline_report_json",
    "preview_summary_json",
    "quality_report_json",
    "raw_solved_motion_json",
    "smpl_parameters_json",
    "solved_motion_json",
    "wham_overlay_preview_mp4",
  ]);
  assert.ok(!SINGLE_CAMERA_EXPORT_FORMATS.includes("dual_reconstruction_json" as never));
  assert.ok(!SINGLE_CAMERA_EXPORT_FORMATS.includes("multi_view_reconstruction_json" as never));
  assert.ok(!SINGLE_CAMERA_EXPORT_FORMATS.includes("pose_frames_device_json" as never));
}

function testSingleCameraQualityReportRegression() {
  const report = buildQualityReport(
    pose(),
    solved(),
    cleanup(),
    validation(),
    "single_camera",
  );

  assert.equal(report.schema, "mocap.quality_report.v1");
  assert.equal(report.score, 100);
  assert.equal(report.grade, "excellent");
  assert.equal(report.inputSource.source, "single_camera");
  assert.equal(report.multiView, undefined);
}

function testSingleCameraWhamInputUsageRegression() {
  const usage = buildWhamInputUsageMetrics({
    source: "single_camera",
    selectedVideos: [
      {
        deviceIndex: 0,
        storageKey: "takes/take_single_regression/original/device_0.mov",
      },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: false,
    primaryWhamFallbackReason: "none",
  });

  assert.equal(usage.source, "single_camera");
  assert.equal(usage.primaryVideoUsed, true);
  assert.equal(usage.additionalVideosProvided, 0);
  assert.equal(usage.multiViewReconstructionAvailable, false);
  assert.equal(usage.multiViewConstraintsUsed, false);
  assert.equal(usage.primaryWhamFallbackUsed, false);
  assert.equal(usage.primaryWhamFallbackReason, "none");
}

testSoloBranchGuard();
testSingleSelectedVideoGuard();
testSingleCameraArtifactSet();
testSingleCameraQualityReportRegression();
testSingleCameraWhamInputUsageRegression();
console.log("single-camera WHAM regression tests passed");
