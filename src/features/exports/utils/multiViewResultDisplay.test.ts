import type { ApiExportFile } from "../../../infra/api/MocapApiClient";
import {
  artifactDisplayName,
  buildMultiViewMetricRows,
  buildWhamUsageRows,
  finalAnimationSourceLabel,
  fallbackReasonLabel,
  hasMultiViewDiagnosticContent,
  isRelevantMultiViewSection,
  multiViewArtifactGroups,
  multiViewStatusMessages,
  warningLabel,
  type QualityReportMultiViewSection,
} from "./multiViewResultDisplay";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function exportFile(input: Partial<ApiExportFile> & Pick<ApiExportFile, "id" | "format">): ApiExportFile {
  return {
    takeId: "take_test",
    preset: "humanoid_bvh_quality_v1_5",
    fileSizeBytes: 128,
    createdAt: "2026-05-24T00:00:00.000Z",
    ...input,
  };
}

function multiViewSection(
  input: Partial<QualityReportMultiViewSection> = {},
): QualityReportMultiViewSection {
  return {
    enabled: true,
    source: "dual_camera",
    reconstructionAvailable: true,
    reconstructionUsedForConstraints: false,
    primaryWhamFallbackUsed: true,
    primaryCameraFallbackUsed: true,
    finalAnimationSource: "primary_wham",
    reconstructionStatus: "ready",
    primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
    whamInputUsage: {
      primaryVideoUsed: true,
      additionalVideosProvided: 1,
      multiViewReconstructionAvailable: true,
      multiViewConstraintsUsed: false,
      primaryWhamFallbackUsed: true,
      primaryWhamFallbackReason: "multi_view_reconstruction_diagnostic_only",
    },
    metrics: {
      matchedFrameCount: 42,
      averageTimeDeltaMs: 3.4,
      p95TimeDeltaMs: 7.8,
      syncConfidence: 0.91,
      reprojectionErrorPx: 2.2,
      reprojectionP95Px: 5.1,
      triangulatedLandmarkRatio: 0.72,
      fallbackLandmarkRatio: 0.28,
      calibrationQualityScore: 0.86,
      intrinsicsFallbackUsed: 1,
      extrinsicsFallbackUsed: 1,
    },
    warnings: ["camera_intrinsics_fov_fallback_used"],
    ...input,
  };
}

function testDualDiagnosticRows() {
  const section = multiViewSection();
  const whamRows = buildWhamUsageRows(section);
  const metrics = buildMultiViewMetricRows(section);
  const messages = multiViewStatusMessages(section);

  assert(
    whamRows.some((row) => row.label === "Primary Camera" && row.value === "Used by WHAM"),
    "WHAM primary camera usage should be shown",
  );
  assert(
    whamRows.some((row) => row.label === "Constraints Used" && row.value === "No"),
    "constraint usage should be shown as No",
  );
  assert(
    metrics.sync.some((row) => row.label === "Matched Frames" && row.value === "42"),
    "matched frame count should be shown",
  );
  assert(
    metrics.triangulation.some(
      (row) => row.label === "Triangulated Coverage" && row.value === "72%",
    ),
    "triangulated ratio should be formatted as percent",
  );
  assert(
    metrics.sync.some((row) => row.label === "P95 Sync Delta" && row.value === "7.8ms"),
    "p95 sync delta should be shown",
  );
  assert(
    metrics.calibration.some(
      (row) => row.label === "Extrinsics Fallback" && row.value === "Yes",
    ),
    "extrinsics fallback should be shown",
  );
  assert(
    whamRows.some(
      (row) => row.label === "Final Animation Source" && row.value === "Primary WHAM",
    ),
    "final animation source should be shown",
  );
  assert(
    whamRows.some((row) => row.label === "Primary WHAM Fallback" && row.value === "Yes"),
    "primary WHAM fallback should be explicit",
  );
  assert(
    messages.some((message) => message.includes("diagnostics only")),
    "diagnostic-only status should be human readable",
  );
  assert(
    messages.some((message) => message.includes("primary-camera WHAM")),
    "primary WHAM final animation status should be visible",
  );
}

function testNonFiniteMetricsAreHidden() {
  const rows = buildMultiViewMetricRows(
    multiViewSection({
      metrics: {
        matchedFrameCount: Number.NaN,
        averageTimeDeltaMs: Number.POSITIVE_INFINITY,
        reprojectionErrorPx: Number.NEGATIVE_INFINITY,
        triangulatedLandmarkRatio: 0.5,
      },
    }),
  );

  assert(rows.sync.length === 0, "non-finite sync metrics should be hidden");
  assert(
    rows.triangulation.length === 1 && rows.triangulation[0].value === "50%",
    "finite triangulation metrics should still be shown",
  );
}

function testMissingMetricsDoNotCrash() {
  const section = multiViewSection({
    finalAnimationSource: undefined,
    reconstructionStatus: undefined,
    metrics: undefined,
    warnings: [],
  });
  const rows = buildMultiViewMetricRows(section);
  const whamRows = buildWhamUsageRows(section);

  assert(rows.sync.length === 0, "missing sync metrics should be hidden safely");
  assert(rows.calibration.length === 0, "missing calibration metrics should be hidden safely");
  assert(rows.triangulation.length === 0, "missing triangulation metrics should be hidden safely");
  assert(
    whamRows.some(
      (row) => row.label === "Final Animation Source" && row.value === "Not available",
    ),
    "missing final animation source should show Not available",
  );
  assert(
    whamRows.some(
      (row) => row.label === "Reconstruction Status" && row.value === "Not available",
    ),
    "missing reconstruction status should show Not available",
  );
}

function testArtifactGrouping() {
  const groups = multiViewArtifactGroups([
    exportFile({
      id: "exp_pose_0",
      format: "pose_frames_device_json",
      artifactName: "pose_frames_device_0_json",
    }),
    exportFile({
      id: "exp_pose_1",
      format: "pose_frames_device_json",
      artifactName: "pose_frames_device_1_json",
    }),
    exportFile({
      id: "exp_reconstruction",
      format: "dual_reconstruction_json",
      artifactName: "dual_reconstruction_json",
    }),
    exportFile({
      id: "exp_joint_track",
      format: "triangulated_joint_track_json",
      artifactName: "triangulated_joint_track_json",
    }),
    exportFile({
      id: "exp_capture_volume",
      format: "capture_volume_json",
      artifactName: "capture_volume_json",
    }),
    exportFile({ id: "exp_bvh", format: "bvh" }),
  ]);

  assert(groups.length === 4, "only multi-view artifacts should be grouped");
  assert(groups[0].files.length === 2, "pose artifacts should share one display group");
  assert(
    artifactDisplayName(groups[0].files[0]) === "Device 0 pose JSON",
    "pose artifact names should include device index",
  );
  assert(
    groups.some((group) => group.label === "Triangulated joint track JSON"),
    "triangulated joint track artifact should have a stable display label",
  );
}

function testHumanReadableFallback() {
  assert(
    fallbackReasonLabel("multi_view_reconstruction_disabled")?.includes("disabled"),
    "fallback reason should be human readable",
  );
  assert(
    finalAnimationSourceLabel("dual_triangulation_constraint")?.toLowerCase().includes("constraint"),
    "final animation source should be human readable",
  );
}

function testSingleCameraDoesNotCreateArtifactGroups() {
  const groups = multiViewArtifactGroups([
    exportFile({ id: "exp_bvh", format: "bvh" }),
    exportFile({ id: "exp_quality", format: "quality_report_json" }),
    exportFile({ id: "exp_motion", format: "motion_pipeline_report_json" }),
  ]);

  assert(groups.length === 0, "single-camera artifacts should not create multi-view groups");
}

function testSingleCameraSectionIsNotRelevantForResultScreen() {
  const section = multiViewSection({
    source: "single_camera",
    reconstructionAvailable: false,
    reconstructionUsedForConstraints: false,
    primaryWhamFallbackUsed: false,
    primaryCameraFallbackUsed: false,
    finalAnimationSource: undefined,
    reconstructionStatus: undefined,
    metrics: undefined,
    warnings: [],
  });

  assert(!isRelevantMultiViewSection(section), "single-camera quality sections should not show multi-view metrics");
  assert(
    !hasMultiViewDiagnosticContent(section, []),
    "single-camera results without reconstruction artifacts should not show diagnostics",
  );
}

function testApproximateCalibrationWarningDisplays() {
  const messages = multiViewStatusMessages(
    multiViewSection({
      reconstructionStatus: "approximate",
      warnings: [
        "camera_intrinsics_fov_fallback_used",
        "camera_extrinsics_role_angle_fallback_used",
        "calibration_approximate",
        "sync_diagnostic_approximation",
      ],
    }),
  );

  assert(
    messages.some((message) => message.includes("FOV fallback")),
    "intrinsics fallback warning should be human readable",
  );
  assert(
    messages.some((message) => message.includes("camera-role angle fallback")),
    "extrinsics fallback warning should be human readable",
  );
  assert(
    messages.some((message) => message.includes("diagnostic index-based approximation")),
    "approximate sync warning should be human readable",
  );
  assert(
    warningLabel("calibration_approximate").includes("approximate"),
    "approximate calibration warning should be human readable",
  );
}

testDualDiagnosticRows();
testNonFiniteMetricsAreHidden();
testMissingMetricsDoNotCrash();
testArtifactGrouping();
testHumanReadableFallback();
testSingleCameraDoesNotCreateArtifactGroups();
testSingleCameraSectionIsNotRelevantForResultScreen();
testApproximateCalibrationWarningDisplays();
console.log("multi-view result display tests passed");
