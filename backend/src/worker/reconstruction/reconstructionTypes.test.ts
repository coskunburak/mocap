import assert from "node:assert/strict";
import { resolveWorkerPipelineBranch } from "./multiViewOrchestrator";
import { poseArtifactStorageKey } from "./multiViewArtifacts";
import {
  RECONSTRUCTION_ARTIFACT_EXPORT_NAMES,
  RECONSTRUCTION_ARTIFACT_FILES,
  RECONSTRUCTION_STATUSES,
  type CameraInput,
  type CameraCalibration,
  type DualReconstructionResult,
} from "./reconstructionTypes";

const REQUIRED_STATUSES = [
  "ready",
  "diagnostic_only",
  "missing_pose_frames",
  "missing_sync",
  "missing_calibration",
  "invalid_calibration",
  "insufficient_views",
  "triangulation_failed",
  "fallback_primary_wham",
  "failed",
] as const;

const CAMERA_0: CameraInput = {
  cameraId: "device_0",
  deviceId: "ios_primary",
  deviceIndex: 0,
  role: "primary",
  videoPath: "/tmp/device_0.mp4",
  fps: 30,
  resolution: {
    width: 1280,
    height: 720,
  },
  durationMs: 1000,
  frameCount: 30,
};

const CAMERA_1: CameraInput = {
  ...CAMERA_0,
  cameraId: "device_1",
  deviceId: "ios_secondary",
  deviceIndex: 1,
  role: "secondary",
  videoPath: "/tmp/device_1.mp4",
};

function baseResult(
  input: Pick<DualReconstructionResult, "status" | "fallbackUsed"> &
    Partial<DualReconstructionResult>,
): DualReconstructionResult {
  return {
    schema: "mocap.dual_reconstruction.v1",
    takeId: "take_reconstruction_types",
    jobId: "job_reconstruction_types",
    source: "dual_camera",
    cameras: [CAMERA_0, CAMERA_1],
    frames: [],
    artifactRefs: {},
    warnings: [],
    ...input,
  };
}

function testStatusValuesAreStable() {
  assert.deepEqual(RECONSTRUCTION_STATUSES, REQUIRED_STATUSES);
}

function testTypesRepresentMissingPoseFrames() {
  const result = baseResult({
    status: "missing_pose_frames",
    reason: "No per-camera 2D pose frames were produced.",
    fallbackUsed: false,
    warnings: [
      {
        status: "missing_pose_frames",
        stage: "pose_extraction",
        message: "Pose extraction did not produce device artifacts.",
      },
    ],
  });

  assert.equal(result.status, "missing_pose_frames");
  assert.equal(result.frames.length, 0);
  assert.equal(result.warnings[0].stage, "pose_extraction");
}

function testTypesRepresentMissingCalibration() {
  const missingCalibration: CameraCalibration = {
    cameraId: "device_1",
    deviceIndex: 1,
    status: "missing_calibration",
    reason: "No intrinsics or extrinsics are available for device_1.",
  };
  const result = baseResult({
    status: "missing_calibration",
    reason: "At least one selected camera is missing calibration data.",
    fallbackUsed: false,
    calibrations: [missingCalibration],
  });

  assert.equal(result.status, "missing_calibration");
  assert.equal(result.calibrations?.[0].status, "missing_calibration");
  assert.equal(result.calibrations?.[0].projectionMatrix, undefined);
}

function testDualResultRepresentsPrimaryWhamFallback() {
  const result = baseResult({
    status: "fallback_primary_wham",
    reason: "Dual reconstruction is diagnostic-only; final solve remains primary WHAM.",
    fallbackUsed: true,
    fallbackReason: "fallback_primary_wham",
    artifactRefs: {
      [RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.dualReconstruction]:
        "takes/take_reconstruction_types/jobs/job_reconstruction_types/dual_reconstruction.json",
    },
  });

  assert.equal(result.status, "fallback_primary_wham");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackReason, "fallback_primary_wham");
}

function testSingleCameraBranchDoesNotRequireDualReconstructionResult() {
  const branch = resolveWorkerPipelineBranch({
    captureMode: "solo",
    selectedVideoCount: 1,
    enableMultiViewReconstruction: true,
    allowPrimaryWhamFallback: true,
  });
  const dualReconstructionResult: DualReconstructionResult | undefined =
    undefined;

  assert.equal(branch.kind, "single_camera_wham");
  assert.equal(branch.primaryVideoUsed, true);
  assert.equal(branch.additionalVideosProvided, 0);
  assert.equal(branch.multiViewConstraintsUsed, false);
  assert.equal(dualReconstructionResult, undefined);
}

function testArtifactNamesAreStable() {
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.poseFramesDevice0,
    "pose_frames_device_0.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.poseFramesDevice1,
    "pose_frames_device_1.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.multiViewSync,
    "multi_view_sync.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.cameraCalibration,
    "camera_calibration.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.captureVolume,
    "capture_volume.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.triangulatedJointTrack,
    "triangulated_joint_track.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.dualFitReport,
    "dual_fit_report.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.optimizedSolvedMotion,
    "optimized_solved_motion.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.optimizedBvh,
    "optimized_result.bvh",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.dualReconstruction,
    "dual_reconstruction.json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_FILES.multiViewReconstruction,
    "multi_view_reconstruction.json",
  );
  assert.equal(RECONSTRUCTION_ARTIFACT_FILES.poseFrames, "pose_frames.json");
  assert.equal(
    RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.dualReconstruction,
    "dual_reconstruction_json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.captureVolume,
    "capture_volume_json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.triangulatedJointTrack,
    "triangulated_joint_track_json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.dualFitReport,
    "dual_fit_report_json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.optimizedSolvedMotion,
    "optimized_solved_motion_json",
  );
  assert.equal(
    RECONSTRUCTION_ARTIFACT_EXPORT_NAMES.optimizedBvh,
    "optimized_bvh",
  );
  assert.equal(
    poseArtifactStorageKey({
      takeId: "take_reconstruction_types",
      jobId: "job_reconstruction_types",
      deviceIndex: 0,
    }),
    "takes/take_reconstruction_types/jobs/job_reconstruction_types/pose_frames_device_0.json",
  );
}

testStatusValuesAreStable();
testTypesRepresentMissingPoseFrames();
testTypesRepresentMissingCalibration();
testDualResultRepresentsPrimaryWhamFallback();
testSingleCameraBranchDoesNotRequireDualReconstructionResult();
testArtifactNamesAreStable();
console.log("reconstruction type boundary tests passed");
