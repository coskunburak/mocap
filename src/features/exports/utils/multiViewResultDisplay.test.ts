import type { ApiExportFile } from "../../../infra/api/MocapApiClient";
import {
  artifactDisplayName,
  buildMultiViewMetricRows,
  buildWhamUsageRows,
  fallbackReasonLabel,
  multiViewArtifactGroups,
  multiViewStatusMessages,
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
      syncConfidence: 0.91,
      reprojectionErrorPx: 2.2,
      reprojectionP95Px: 5.1,
      triangulatedLandmarkRatio: 0.72,
      fallbackLandmarkRatio: 0.28,
      calibrationQualityScore: 0.86,
      intrinsicsFallbackUsed: 1,
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
    whamRows.some((row) => row.label === "primary camera" && row.value === "Used by WHAM"),
    "WHAM primary camera usage should be shown",
  );
  assert(
    whamRows.some((row) => row.label === "constraints used" && row.value === "No"),
    "constraint usage should be shown as No",
  );
  assert(
    metrics.sync.some((row) => row.label === "matched frames" && row.value === "42"),
    "matched frame count should be shown",
  );
  assert(
    metrics.triangulation.some((row) => row.label === "triangulated" && row.value === "72%"),
    "triangulated ratio should be formatted as percent",
  );
  assert(
    messages.some((message) => message.includes("diagnostics only")),
    "diagnostic-only status should be human readable",
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
    exportFile({ id: "exp_bvh", format: "bvh" }),
  ]);

  assert(groups.length === 2, "only multi-view artifacts should be grouped");
  assert(groups[0].files.length === 2, "pose artifacts should share one display group");
  assert(
    artifactDisplayName(groups[0].files[0]) === "Device 0 pose JSON",
    "pose artifact names should include device index",
  );
}

function testHumanReadableFallback() {
  assert(
    fallbackReasonLabel("multi_view_reconstruction_disabled")?.includes("disabled"),
    "fallback reason should be human readable",
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

testDualDiagnosticRows();
testNonFiniteMetricsAreHidden();
testArtifactGrouping();
testHumanReadableFallback();
testSingleCameraDoesNotCreateArtifactGroups();
console.log("multi-view result display tests passed");
