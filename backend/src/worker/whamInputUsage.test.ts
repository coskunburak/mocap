import assert from "node:assert/strict";
import {
  WhamInputUsageError,
  buildWhamInputUsageMetrics,
  whamFallbackReasonFromMultiViewError,
} from "./whamInputUsage";

function testSingleCameraUsage() {
  const usage = buildWhamInputUsageMetrics({
    source: "single_camera",
    selectedVideos: [{ deviceIndex: 0, storageKey: "takes/take_a/device_0.mov" }],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: false,
    primaryWhamFallbackReason: "none",
  });

  assert.equal(usage.primaryVideoUsed, true);
  assert.equal(usage.primaryDeviceIndex, 0);
  assert.equal(usage.primaryVideoStorageKey, "takes/take_a/device_0.mov");
  assert.equal(usage.additionalVideosProvided, 0);
  assert.deepEqual(usage.additionalDeviceIndexes, []);
  assert.equal(usage.multiViewReconstructionAvailable, false);
  assert.equal(usage.multiViewConstraintsUsed, false);
  assert.equal(usage.primaryWhamFallbackUsed, false);
  assert.equal(usage.primaryWhamFallbackReason, "none");
}

function testDualFeatureDisabledFallbackUsage() {
  const usage = buildWhamInputUsageMetrics({
    source: "dual_camera",
    selectedVideos: [
      { deviceIndex: 0, storageKey: "takes/take_dual/device_0.mov" },
      { deviceIndex: 1, storageKey: "takes/take_dual/device_1.mov" },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "multi_view_reconstruction_disabled",
  });

  assert.equal(usage.additionalVideosProvided, 1);
  assert.deepEqual(usage.additionalDeviceIndexes, [1]);
  assert.equal(usage.multiViewReconstructionAvailable, false);
  assert.equal(usage.multiViewConstraintsUsed, false);
  assert.equal(usage.primaryWhamFallbackUsed, true);
  assert.equal(
    usage.primaryWhamFallbackReason,
    "multi_view_reconstruction_disabled",
  );
}

function testDiagnosticOnlyReconstructionUsage() {
  const usage = buildWhamInputUsageMetrics({
    source: "multi_view",
    selectedVideos: [
      { deviceIndex: 0, storageKey: "takes/take_pro/device_0.mov" },
      { deviceIndex: 1, storageKey: "takes/take_pro/device_1.mov" },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: true,
    multiViewConstraintsUsed: true,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
  });

  assert.equal(usage.multiViewReconstructionAvailable, true);
  assert.equal(usage.multiViewConstraintsUsed, false);
  assert.equal(usage.primaryWhamFallbackUsed, true);
  assert.equal(
    usage.primaryWhamFallbackReason,
    "multi_view_reconstruction_diagnostic_only",
  );
}

function testAdapterFailureFallbackUsage() {
  const usage = buildWhamInputUsageMetrics({
    source: "dual_camera",
    selectedVideos: [
      { deviceIndex: 0, storageKey: "takes/take_adapter/device_0.mov" },
      { deviceIndex: 1, storageKey: "takes/take_adapter/device_1.mov" },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: whamFallbackReasonFromMultiViewError(
      "multi_view_pose_extraction_failed",
    ),
  });

  assert.equal(usage.multiViewReconstructionAvailable, false);
  assert.equal(usage.primaryWhamFallbackReason, "multi_view_pose_extraction_failed");
}

function testProFourCameraUsage() {
  const usage = buildWhamInputUsageMetrics({
    source: "pro_4_camera",
    selectedVideos: [
      { deviceIndex: 0, storageKey: "takes/take_pro/device_0.mov" },
      { deviceIndex: 1, storageKey: "takes/take_pro/device_1.mov" },
      { deviceIndex: 2, storageKey: "takes/take_pro/device_2.mov" },
      { deviceIndex: 3, storageKey: "takes/take_pro/device_3.mov" },
    ],
    primaryDeviceIndex: 0,
    multiViewReconstructionAvailable: true,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
  });

  assert.equal(usage.additionalVideosProvided, 3);
  assert.deepEqual(usage.additionalDeviceIndexes, [1, 2, 3]);
  assert.equal(usage.multiViewConstraintsUsed, false);
}

function testPrimaryDeviceOverride() {
  const usage = buildWhamInputUsageMetrics({
    source: "dual_camera",
    selectedVideos: [
      { deviceIndex: 2, storageKey: "takes/take_dual/device_2.mov" },
      { deviceIndex: 4, storageKey: "takes/take_dual/device_4.mov" },
    ],
    primaryDeviceIndex: 2,
    multiViewReconstructionAvailable: false,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: true,
    primaryWhamFallbackReason: "primary_wham_fallback_allowed",
  });

  assert.equal(usage.primaryDeviceIndex, 2);
  assert.equal(usage.primaryVideoStorageKey, "takes/take_dual/device_2.mov");
  assert.deepEqual(usage.additionalDeviceIndexes, [4]);
}

function testEmptySelectedVideosFailsSafely() {
  assert.throws(
    () =>
      buildWhamInputUsageMetrics({
        source: "single_camera",
        selectedVideos: [],
        multiViewReconstructionAvailable: false,
        multiViewConstraintsUsed: false,
        primaryWhamFallbackUsed: false,
        primaryWhamFallbackReason: "none",
      }),
    WhamInputUsageError,
  );
}

function testFallbackReasonMapping() {
  assert.equal(
    whamFallbackReasonFromMultiViewError("camera_projection_invalid"),
    "multi_view_reconstruction_failed",
  );
  assert.equal(
    whamFallbackReasonFromMultiViewError("multi_view_reconstruction_disabled"),
    "multi_view_reconstruction_disabled",
  );
}

testSingleCameraUsage();
testDualFeatureDisabledFallbackUsage();
testDiagnosticOnlyReconstructionUsage();
testAdapterFailureFallbackUsage();
testProFourCameraUsage();
testPrimaryDeviceOverride();
testEmptySelectedVideosFailsSafely();
testFallbackReasonMapping();
console.log("WHAM input usage metrics tests passed");
