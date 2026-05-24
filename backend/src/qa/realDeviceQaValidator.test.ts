import assert from "node:assert/strict";
import { validateRealDeviceQaManifest } from "./realDeviceQaValidator";

const SINGLE_CAMERA_ARTIFACTS = [
  "smpl_parameters_json",
  "raw_solved_motion_json",
  "solved_motion_json",
  "cleanup_report_json",
  "quality_report_json",
  "preview_summary_json",
  "motion_pipeline_report_json",
  "wham_overlay_preview_mp4",
  "bvh",
];

function singleRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "ios-single-001",
    mode: "single_camera",
    platforms: ["ios"],
    expectedVideoCount: 1,
    actualUploadedVideoCount: 1,
    expectedBranch: "single_camera_wham",
    actualBranch: "single_camera_wham",
    jobStatus: "succeeded",
    artifacts: SINGLE_CAMERA_ARTIFACTS,
    qualityReport: {
      schema: "mocap.quality_report.v1",
      score: 100,
      multiViewPresent: false,
    },
    resultScreen: {
      multiViewDiagnosticsVisible: false,
    },
    passed: true,
    ...overrides,
  };
}

function dualRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "ios-ios-dual-001",
    mode: "dual_camera",
    platforms: ["ios", "ios"],
    expectedVideoCount: 2,
    actualUploadedVideoCount: 2,
    expectedBranch: "multi_view_reconstruction",
    actualBranch: "multi_view_reconstruction",
    jobStatus: "succeeded",
    artifacts: [
      "pose_frames_device_json",
      "multi_view_sync_json",
      "camera_calibration_json",
      "dual_reconstruction_json",
      "quality_report_json",
    ],
    qualityReport: {
      schema: "mocap.quality_report.v1",
      multiViewPresent: true,
      reconstructionAvailable: true,
      reconstructionUsedForConstraints: false,
      primaryWhamFallbackUsed: true,
      matchedFrameCount: 10,
      averageTimeDeltaMs: 5.2,
      reprojectionErrorPx: 4.1,
      triangulatedLandmarkRatio: 0.75,
      calibrationQualityScore: 0.8,
    },
    resultScreen: {
      multiViewDiagnosticsVisible: true,
    },
    passed: true,
    ...overrides,
  };
}

function manifest(runs: unknown[]) {
  return {
    schema: "mocap.real_device_qa.v1",
    date: "2026-05-24",
    tester: "manual",
    runs,
  };
}

function assertPasses(value: unknown) {
  const result = validateRealDeviceQaManifest(value);
  assert.equal(result.passed, true, result.errors.join("\n"));
}

function assertFails(value: unknown, pattern: RegExp) {
  const result = validateRealDeviceQaManifest(value);
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), pattern);
}

function testValidSingleCameraManifestPasses() {
  assertPasses(manifest([singleRun()]));
}

function testSingleCameraMultiViewVisibleFails() {
  assertFails(
    manifest([
      singleRun({
        resultScreen: {
          multiViewDiagnosticsVisible: true,
        },
      }),
    ]),
    /must not show Multi-View Diagnostics/,
  );
}

function testSingleCameraMissingBvhFails() {
  assertFails(
    manifest([
      singleRun({
        artifacts: SINGLE_CAMERA_ARTIFACTS.filter((artifact) => artifact !== "bvh"),
      }),
    ]),
    /missing single-camera artifact bvh/,
  );
}

function testValidDualManifestPasses() {
  assertPasses(manifest([dualRun()]));
}

function testDualMatchedFrameCountZeroFails() {
  assertFails(
    manifest([
      dualRun({
        qualityReport: {
          schema: "mocap.quality_report.v1",
          multiViewPresent: true,
          reconstructionAvailable: true,
          reconstructionUsedForConstraints: false,
          primaryWhamFallbackUsed: true,
          matchedFrameCount: 0,
          averageTimeDeltaMs: 5.2,
          reprojectionErrorPx: 4.1,
          triangulatedLandmarkRatio: 0.75,
          calibrationQualityScore: 0.8,
        },
      }),
    ]),
    /matchedFrameCount must be > 0/,
  );
}

function testDualMissingReconstructionArtifactFails() {
  assertFails(
    manifest([
      dualRun({
        artifacts: ["pose_frames_device_json", "multi_view_sync_json", "quality_report_json"],
      }),
    ]),
    /missing dual_reconstruction_json/,
  );
}

function testProMissingReconstructionArtifactFails() {
  assertFails(
    manifest([
      {
        ...dualRun({
          id: "pro-001",
          mode: "pro_4_camera",
          expectedVideoCount: 4,
          actualUploadedVideoCount: 4,
          artifacts: [
            "pose_frames_device_0_json",
            "pose_frames_device_1_json",
            "pose_frames_device_2_json",
            "pose_frames_device_3_json",
            "quality_report_json",
          ],
        }),
      },
    ]),
    /missing multi_view_reconstruction_json/,
  );
}

function testConstraintsUsedFails() {
  assertFails(
    manifest([
      dualRun({
        qualityReport: {
          schema: "mocap.quality_report.v1",
          multiViewPresent: true,
          reconstructionAvailable: true,
          reconstructionUsedForConstraints: true,
          primaryWhamFallbackUsed: true,
          matchedFrameCount: 10,
          averageTimeDeltaMs: 5.2,
          reprojectionErrorPx: 4.1,
          triangulatedLandmarkRatio: 0.75,
          calibrationQualityScore: 0.8,
        },
      }),
    ]),
    /reconstructionUsedForConstraints must be false/,
  );
}

function testInvalidSchemaFails() {
  assertFails({ schema: "wrong", runs: [singleRun()] }, /schema must be/);
}

function testMissingRunsFails() {
  assertFails({ schema: "mocap.real_device_qa.v1" }, /runs must be an array/);
}

testValidSingleCameraManifestPasses();
testSingleCameraMultiViewVisibleFails();
testSingleCameraMissingBvhFails();
testValidDualManifestPasses();
testDualMatchedFrameCountZeroFails();
testDualMissingReconstructionArtifactFails();
testProMissingReconstructionArtifactFails();
testConstraintsUsedFails();
testInvalidSchemaFails();
testMissingRunsFails();
console.log("real-device QA validator tests passed");
