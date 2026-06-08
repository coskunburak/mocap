import assert from "node:assert/strict";
import {
  buildQualityReport,
  validateBvhText,
} from "../worker/export/exportValidation";
import { writeBvh } from "../worker/export/bvhWriter";
import { SKELETON } from "../worker/export/skeletonDefinition";
import { resolveWorkerPipelineBranch } from "../worker/reconstruction/multiViewOrchestrator";
import { buildWhamInputUsageMetrics } from "../worker/whamInputUsage";
import type {
  CleanupReport,
  MotionPipelineReport,
  PoseFramesArtifact,
  SolvedMotionArtifact,
  SolvedMotionFrame,
  WhamInputUsageMetrics,
} from "../worker/types";

const TAKE_ID = "take_single_regression";
const JOB_ID = "job_single_regression";
const PRIMARY_SOURCE_STORAGE_KEY =
  "takes/take_single_regression/original/device_0.mov";
const PRIMARY_NORMALIZED_STORAGE_KEY =
  "takes/take_single_regression/jobs/job_single_regression/normalized.mp4";

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

function artifactKey(fileName: string) {
  return `takes/${TAKE_ID}/jobs/${JOB_ID}/${fileName}`;
}

function pose(): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    sourceVideo: {
      storageKey: PRIMARY_SOURCE_STORAGE_KEY,
      normalizedStorageKey: PRIMARY_NORMALIZED_STORAGE_KEY,
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
    takeId: TAKE_ID,
    jobId: JOB_ID,
    skeleton: {
      name: "mocap_humanoid_v1",
      rotationOrder: "ZXY",
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

function zeroJoints(): SolvedMotionFrame["joints"] {
  return Object.fromEntries(
    SKELETON.map((joint) => [joint.name, [0, 0, 0] as [number, number, number]]),
  );
}

function bvhSolved(): SolvedMotionArtifact {
  return {
    ...solved(),
    frameCount: 2,
    durationMs: 67,
    frames: [
      {
        frameIndex: 0,
        timestampMs: 0,
        rootTranslation: [0, 0, 0],
        joints: zeroJoints(),
      },
      {
        frameIndex: 1,
        timestampMs: 33,
        rootTranslation: [0, 0, 1],
        joints: zeroJoints(),
      },
    ],
  };
}

function cleanup(): CleanupReport {
  return {
    schema: "mocap.cleanup_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
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

function singleCameraWhamUsage(
  input: Partial<
    Pick<WhamInputUsageMetrics, "primaryDeviceIndex" | "primaryVideoStorageKey">
  > = {},
): WhamInputUsageMetrics {
  const primaryDeviceIndex = input.primaryDeviceIndex ?? 0;
  const primaryVideoStorageKey =
    input.primaryVideoStorageKey ?? PRIMARY_SOURCE_STORAGE_KEY;
  return buildWhamInputUsageMetrics({
    source: "single_camera",
    selectedVideos: [
      {
        deviceIndex: primaryDeviceIndex,
        storageKey: primaryVideoStorageKey,
      },
    ],
    primaryDeviceIndex,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: false,
    primaryWhamFallbackReason: "none",
  });
}

function motionPipelineReport(input: {
  whamInputUsage?: WhamInputUsageMetrics;
  overlayPreviewKey?: string;
} = {}): MotionPipelineReport {
  const quality = buildQualityReport(
    pose(),
    solved(),
    cleanup(),
    validation(),
    "single_camera",
    {
      whamInputUsage: input.whamInputUsage ?? singleCameraWhamUsage(),
    },
  );
  return {
    schema: "mocap.motion_pipeline_report.v1",
    takeId: TAKE_ID,
    jobId: JOB_ID,
    profile: "wham_smpl_smplify_only",
    engines: {
      mobileCapture: "video_upload",
      backendMotion: "wham@fixture_v1",
      smpl: "SMPL",
      smplify: "not_run",
      inputSource: "single_camera",
      cleanup: "cleanup_quality_v1_5",
    },
    fallback: {
      motionFallbackUsed: false,
      reasons: [],
    },
    finalAnimationSource: "primary_wham",
    artifacts: {
      smplParameters: artifactKey("smpl_parameters.json"),
      rawSolvedMotion: artifactKey("raw_solved_motion.json"),
      solvedMotion: artifactKey("solved_motion.json"),
      cleanupReport: artifactKey("cleanup_report.json"),
      qualityReport: artifactKey("quality_report.json"),
      previewSummary: artifactKey("preview_summary.json"),
      ...(input.overlayPreviewKey
        ? { overlayPreview: input.overlayPreviewKey }
        : {}),
      bvh: artifactKey("result.bvh"),
    },
    quality: {
      score: quality.score,
      grade: quality.grade,
      warnings: quality.warnings,
      errors: quality.errors,
    },
    whamInputUsage: input.whamInputUsage ?? singleCameraWhamUsage(),
    createdAt: "2026-05-29T00:00:00.000Z",
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

function testSelectedVideoCountAtMostOneAlwaysUsesSingleCameraWham() {
  for (const captureMode of ["solo", "dual", "pro_4_camera"] as const) {
    for (const selectedVideoCount of [0, 1] as const) {
      for (const enableMultiViewReconstruction of [false, true] as const) {
        for (const allowPrimaryWhamFallback of [false, true] as const) {
          const branch = resolveWorkerPipelineBranch({
            captureMode,
            selectedVideoCount,
            enableMultiViewReconstruction,
            allowPrimaryWhamFallback,
          });

          assert.equal(branch.kind, "single_camera_wham");
          assert.equal(branch.primaryVideoUsed, true);
          assert.equal(branch.additionalVideosProvided, 0);
          assert.equal(branch.multiViewConstraintsUsed, false);
        }
      }
    }
  }
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

function testSoloCaptureBypassesMultiViewEvenWithExtraUploadedSources() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "solo",
    selectedVideoCount: 4,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: false,
  });

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.reason, "solo_capture");
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
  assert.ok(!SINGLE_CAMERA_EXPORT_FORMATS.includes("pose_frames_json" as never));
}

function testSingleCameraBvhExportRegression() {
  const motion = bvhSolved();
  const bvh = writeBvh(motion);
  const result = validateBvhText(bvh, motion.frameCount);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(bvh.startsWith("HIERARCHY"));
  assert.ok(bvh.includes("ROOT Hips"));
  assert.ok(bvh.includes("CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation"));
  assert.ok(bvh.includes("JOINT LeftUpperArm"));
  assert.ok(!bvh.includes("JOINT LeftArm"));
  assert.ok(bvh.includes("MOTION"));
  assert.ok(bvh.includes("Frames: 2"));
  assert.equal(/NaN|Infinity/.test(bvh), false);
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

function testSingleCameraQualityReportIgnoresMissingMultiViewData() {
  const baseReport = buildQualityReport(
    pose(),
    solved(),
    cleanup(),
    validation(),
    "single_camera",
    { whamInputUsage: singleCameraWhamUsage() },
  );
  const report = buildQualityReport(
    pose(),
    solved(),
    cleanup(),
    validation(),
    "single_camera",
    {
      whamInputUsage: singleCameraWhamUsage(),
      multiViewDiagnostic: {
        reconstructionAvailable: false,
        warnings: ["camera_calibration_failed", "multi_view_pose_extraction_failed"],
        errorCode: "multi_view_pose_extraction_failed",
        errorMessage: "Multi-view pose detector adapter is not configured.",
      },
    },
  );

  assert.equal(report.schema, "mocap.quality_report.v1");
  assert.equal(report.score, baseReport.score);
  assert.equal(report.grade, baseReport.grade);
  assert.equal(report.multiView, undefined);
  assert.equal(report.warnings.includes("camera_calibration_failed"), false);
  assert.equal(report.warnings.includes("multi_view_pose_extraction_failed"), false);
}

function testSingleCameraWhamInputUsageRegression() {
  const usage = singleCameraWhamUsage({
    primaryDeviceIndex: 7,
    primaryVideoStorageKey: "takes/take_single_regression/original/device_7.mov",
  });

  assert.equal(usage.source, "single_camera");
  assert.equal(usage.primaryVideoUsed, true);
  assert.equal(usage.primaryDeviceIndex, 7);
  assert.equal(
    usage.primaryVideoStorageKey,
    "takes/take_single_regression/original/device_7.mov",
  );
  assert.equal(usage.additionalVideosProvided, 0);
  assert.deepEqual(usage.additionalDeviceIndexes, []);
  assert.equal(usage.multiViewReconstructionAvailable, false);
  assert.equal(usage.multiViewConstraintsUsed, false);
  assert.equal(usage.primaryWhamFallbackUsed, false);
  assert.equal(usage.primaryWhamFallbackReason, "none");
}

function testSingleCameraMotionPipelineReportRegression() {
  const whamInputUsage = singleCameraWhamUsage();
  const report = motionPipelineReport({ whamInputUsage });

  assert.equal(report.schema, "mocap.motion_pipeline_report.v1");
  assert.equal(report.profile, "wham_smpl_smplify_only");
  assert.equal(report.engines.mobileCapture, "video_upload");
  assert.equal(report.engines.smpl, "SMPL");
  assert.equal(report.engines.inputSource, "single_camera");
  assert.equal(report.engines.cleanup, "cleanup_quality_v1_5");
  assert.equal(report.fallback.motionFallbackUsed, false);
  assert.deepEqual(report.fallback.reasons, []);
  assert.equal(report.finalAnimationSource, "primary_wham");
  assert.equal(report.artifacts.smplParameters, artifactKey("smpl_parameters.json"));
  assert.equal(report.artifacts.rawSolvedMotion, artifactKey("raw_solved_motion.json"));
  assert.equal(report.artifacts.solvedMotion, artifactKey("solved_motion.json"));
  assert.equal(report.artifacts.cleanupReport, artifactKey("cleanup_report.json"));
  assert.equal(report.artifacts.qualityReport, artifactKey("quality_report.json"));
  assert.equal(report.artifacts.previewSummary, artifactKey("preview_summary.json"));
  assert.equal(report.artifacts.bvh, artifactKey("result.bvh"));
  assert.equal(report.whamInputUsage?.source, "single_camera");
  assert.equal(report.whamInputUsage?.primaryVideoStorageKey, PRIMARY_SOURCE_STORAGE_KEY);
  assert.equal(report.whamInputUsage?.additionalVideosProvided, 0);
  assert.equal(report.whamInputUsage?.multiViewConstraintsUsed, false);
  assert.equal("multiView" in report, false);
}

function testSingleCameraWhamOverlayPreviewArtifactRemainsOptional() {
  const overlayPreviewKey = artifactKey("wham_overlay_preview.mp4");
  const withOverlay = motionPipelineReport({ overlayPreviewKey });
  const withoutOverlay = JSON.parse(
    JSON.stringify(motionPipelineReport()),
  ) as MotionPipelineReport;

  assert.ok(SINGLE_CAMERA_EXPORT_FORMATS.includes("wham_overlay_preview_mp4"));
  assert.equal(withOverlay.artifacts.overlayPreview, overlayPreviewKey);
  assert.equal("overlayPreview" in withoutOverlay.artifacts, false);
}

testSelectedVideoCountAtMostOneAlwaysUsesSingleCameraWham();
testSoloBranchGuard();
testSoloCaptureBypassesMultiViewEvenWithExtraUploadedSources();
testSingleSelectedVideoGuard();
testSingleCameraArtifactSet();
testSingleCameraBvhExportRegression();
testSingleCameraQualityReportRegression();
testSingleCameraQualityReportIgnoresMissingMultiViewData();
testSingleCameraWhamInputUsageRegression();
testSingleCameraMotionPipelineReportRegression();
testSingleCameraWhamOverlayPreviewArtifactRemainsOptional();
console.log("single-camera WHAM regression tests passed");
