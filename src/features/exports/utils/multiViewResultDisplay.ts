import type { ApiExportFile } from "../../../infra/api/MocapApiClient";

export type QualityReportMultiViewSource =
  | "single_camera"
  | "dual_camera"
  | "multi_view"
  | "pro_4_camera";

export type QualityReportFinalAnimationSource =
  | "primary_wham"
  | "dual_triangulation_diagnostic"
  | "dual_triangulation_constraint"
  | "true_dual_solve"
  | "unavailable";

export type QualityReportMultiViewSection = Readonly<{
  enabled: boolean;
  source: QualityReportMultiViewSource;
  reconstructionAvailable: boolean;
  reconstructionUsedForConstraints: boolean;
  primaryWhamFallbackUsed: boolean;
  primaryCameraFallbackUsed?: boolean;
  finalAnimationSource?: QualityReportFinalAnimationSource;
  reconstructionStatus?: string;
  dualReconstructionStatus?: string;
  trueDualSolveAvailable?: boolean;
  poseDetectorSource?: string;
  poseExtractionStatus?: string;
  poseFramesDevice0Status?: string;
  poseFramesDevice1Status?: string;
  averageKeypointConfidence?: number;
  missingPoseFrameRatio?: number;
  syncStatus?: string;
  syncMethod?: string;
  syncConfidence?: number;
  averageTimeDeltaMs?: number;
  p95TimeDeltaMs?: number;
  syncDiagnosticOnly?: boolean;
  intrinsicsStatus?: string;
  intrinsicsSource?: string;
  intrinsicsConfidence?: number;
  extrinsicsStatus?: string;
  extrinsicsSource?: string;
  extrinsicsConfidence?: number;
  calibrationQualityScore?: number;
  captureVolumeStatus?: string;
  baselineEstimate?: number;
  reprojectionErrorPx?: number;
  primaryWhamFallbackReason?: string;
  whamInputUsage?: Readonly<{
    primaryVideoUsed: boolean;
    additionalVideosProvided: number;
    multiViewReconstructionAvailable: boolean;
    multiViewConstraintsUsed: boolean;
    primaryWhamFallbackUsed: boolean;
    primaryWhamFallbackReason?: string;
  }>;
  metrics?: Readonly<{
    syncOffsetMs?: number;
    syncConfidence?: number;
    matchedFrameCount?: number;
    droppedFrameCount?: number;
    averageTimeDeltaMs?: number;
    p95TimeDeltaMs?: number;
    reprojectionErrorPx?: number;
    reprojectionP95Px?: number;
    triangulatedLandmarkRatio?: number;
    fallbackLandmarkRatio?: number;
    calibrationQualityScore?: number;
    baselineEstimate?: number;
    intrinsicsFallbackUsed?: number;
    extrinsicsFallbackUsed?: number;
    multiViewQualityGain?: number;
  }>;
  warnings?: readonly string[];
}>;

export type DisplayRow = Readonly<{
  label: string;
  value: string;
}>;

export type MultiViewArtifactGroup = Readonly<{
  key: string;
  label: string;
  files: readonly ApiExportFile[];
}>;

const NOT_AVAILABLE = "Not available";

const MULTI_VIEW_ARTIFACT_LABELS: Record<string, string> = {
  pose_frames_device_json: "Per-camera pose JSON",
  pose_frames_json: "Diagnostic pose frames JSON",
  calibration_observations_json: "Calibration observations JSON",
  multi_view_sync_json: "Sync report JSON",
  camera_calibration_json: "Camera calibration JSON",
  capture_volume_json: "Capture volume JSON",
  triangulated_joint_track_json: "Triangulated joint track JSON",
  dual_fit_report_json: "Dual fitting report JSON",
  optimized_solved_motion_json: "Optimized solved motion JSON",
  optimized_smpl_parameters_json: "Optimized SMPL parameters JSON",
  optimized_bvh: "Optimized dual-solve BVH",
  dual_reconstruction_json: "Dual reconstruction JSON",
  multi_view_reconstruction_json: "Multi-view reconstruction JSON",
};

const FALLBACK_REASON_LABELS: Record<string, string> = {
  multi_view_reconstruction_disabled:
    "Multi-view reconstruction is disabled. Primary WHAM fallback was used.",
  multi_view_reconstruction_diagnostic_only:
    "Multi-view reconstruction was generated for diagnostics. WHAM still used the primary camera.",
  multi_view_pose_extraction_failed:
    "Multi-view pose extraction failed. Primary WHAM fallback was used.",
  multi_view_reconstruction_failed:
    "Multi-view reconstruction failed. Primary WHAM fallback was used.",
  multi_view_constraints_not_supported:
    "Multi-view constraints are not supported in this version. Primary WHAM was used.",
  primary_wham_fallback_allowed: "Primary WHAM fallback was used.",
};

const WARNING_LABELS: Record<string, string> = {
  camera_intrinsics_missing: "Camera intrinsics are missing.",
  camera_intrinsics_fov_fallback_used:
    "Camera intrinsics were missing; FOV fallback was used.",
  camera_extrinsics_role_angle_fallback_used:
    "Camera extrinsics used camera-role angle fallback.",
  calibration_approximate:
    "Camera calibration is approximate; dual-camera reconstruction is diagnostic.",
  missing_calibration: "Camera calibration is missing.",
  invalid_calibration: "Camera calibration is invalid.",
  approximate: "Calibration or synchronization is approximate.",
  calibration_quality_low: "Calibration quality is low.",
  sync_confidence_low: "Frame synchronization confidence is low.",
  sync_offset_high: "Frame synchronization offset is high.",
  sync_diagnostic_approximation:
    "Frame synchronization used diagnostic index-based approximation.",
  reprojection_error_high: "Reprojection error is high.",
  triangulation_coverage_low: "Triangulation coverage is low.",
  single_camera_solver_fallback_used: "Primary camera solver fallback was used.",
};

export function isRelevantMultiViewSection(
  section: QualityReportMultiViewSection | null | undefined,
) {
  return (
    section?.source === "dual_camera" ||
    section?.source === "multi_view" ||
    section?.source === "pro_4_camera"
  );
}

export function hasMultiViewDiagnosticContent(
  section: QualityReportMultiViewSection | null | undefined,
  artifactGroups: readonly MultiViewArtifactGroup[],
) {
  return isRelevantMultiViewSection(section) || artifactGroups.length > 0;
}

export function sourceLabel(source: QualityReportMultiViewSource | undefined) {
  if (source === "dual_camera") return "Dual Camera";
  if (source === "multi_view") return "Multi-View";
  if (source === "pro_4_camera") return "Pro 4 Camera";
  return "Single Camera";
}

export function finalAnimationSourceLabel(
  source: QualityReportFinalAnimationSource | undefined,
) {
  if (source === "primary_wham") return "Primary WHAM";
  if (source === "dual_triangulation_diagnostic") return "Dual Triangulation Diagnostic";
  if (source === "dual_triangulation_constraint") return "Dual Triangulation Constraint";
  if (source === "true_dual_solve") return "True Dual Solve";
  if (source === "unavailable") return "Unavailable";
  return undefined;
}

export function fallbackReasonLabel(reason: string | undefined) {
  if (!reason || reason === "none") return undefined;
  return FALLBACK_REASON_LABELS[reason] ?? readableCode(reason);
}

export function warningLabel(code: string) {
  return WARNING_LABELS[code] ?? readableCode(code);
}

export function metricNumber(
  value: number | undefined,
  options?: Readonly<{ decimals?: number; suffix?: string }>,
) {
  const safe = finiteNumber(value);
  if (safe == null) return undefined;
  const decimals = options?.decimals ?? (Number.isInteger(safe) ? 0 : 1);
  return `${safe.toFixed(decimals)}${options?.suffix ?? ""}`;
}

export function metricPercent(value: number | undefined) {
  const safe = finiteNumber(value);
  if (safe == null) return undefined;
  return `${Math.round(Math.max(0, Math.min(1, safe)) * 100)}%`;
}

export function booleanLabel(value: boolean | undefined) {
  if (value == null) return undefined;
  return value ? "Yes" : "No";
}

export function buildMultiViewMetricRows(
  section: QualityReportMultiViewSection,
): Readonly<{
  sync: readonly DisplayRow[];
  calibration: readonly DisplayRow[];
  triangulation: readonly DisplayRow[];
}> {
  const metrics = section.metrics;
  return {
    sync: compactRows([
      ["Sync Confidence", metricPercent(metrics?.syncConfidence)],
      ["Matched Frames", metricNumber(metrics?.matchedFrameCount)],
      ["Average Sync Delta", metricNumber(metrics?.averageTimeDeltaMs, { suffix: "ms" })],
      ["P95 Sync Delta", metricNumber(metrics?.p95TimeDeltaMs, { suffix: "ms" })],
      ["Dropped Frames", metricNumber(metrics?.droppedFrameCount)],
    ]),
    calibration: compactRows([
      ["Calibration Quality", metricPercent(metrics?.calibrationQualityScore)],
      ["Baseline", metricNumber(metrics?.baselineEstimate, { suffix: "m" })],
      [
        "Intrinsics Fallback",
        metrics?.intrinsicsFallbackUsed == null
          ? undefined
          : metrics.intrinsicsFallbackUsed > 0
            ? "Yes"
            : "No",
      ],
      [
        "Extrinsics Fallback",
        metrics?.extrinsicsFallbackUsed == null
          ? undefined
          : metrics.extrinsicsFallbackUsed > 0
            ? "Yes"
            : "No",
      ],
    ]),
    triangulation: compactRows([
      ["Reprojection Error", metricNumber(metrics?.reprojectionErrorPx, { suffix: "px" })],
      ["Reprojection P95", metricNumber(metrics?.reprojectionP95Px, { suffix: "px" })],
      ["Triangulated Coverage", metricPercent(metrics?.triangulatedLandmarkRatio)],
      ["Fallback Landmark Ratio", metricPercent(metrics?.fallbackLandmarkRatio)],
    ]),
  };
}

export function buildWhamUsageRows(
  section: QualityReportMultiViewSection,
): readonly DisplayRow[] {
  const usage = section.whamInputUsage;
  return compactRows([
    ["Source", sourceLabel(section.source)],
    [
      "Primary Camera",
      usage?.primaryVideoUsed || section.primaryWhamFallbackUsed ? "Used by WHAM" : undefined,
    ],
    ["Extra Cameras", metricNumber(usage?.additionalVideosProvided)],
    ["Reconstruction Available", booleanLabel(section.reconstructionAvailable)],
    [
      "Reconstruction Status",
      section.reconstructionStatus ? readableCode(section.reconstructionStatus) : NOT_AVAILABLE,
    ],
    ["Constraints Used", booleanLabel(section.reconstructionUsedForConstraints)],
    [
      "Primary WHAM Fallback",
      booleanLabel(section.primaryCameraFallbackUsed ?? section.primaryWhamFallbackUsed),
    ],
    ["Final Animation Source", finalAnimationSourceLabel(section.finalAnimationSource) ?? NOT_AVAILABLE],
  ]);
}

export function multiViewStatusMessages(
  section: QualityReportMultiViewSection,
): readonly string[] {
  const messages: string[] = [];
  if (section.finalAnimationSource === "primary_wham") {
    messages.push("Final animation currently comes from primary-camera WHAM.");
  }
  if (section.reconstructionAvailable && !section.reconstructionUsedForConstraints) {
    messages.push(
      "Multi-view reconstruction was used for diagnostics only; WHAM still used the primary camera.",
    );
  }
  const reason = fallbackReasonLabel(section.primaryWhamFallbackReason);
  if (reason) messages.push(reason);
  for (const warning of section.warnings ?? []) {
    messages.push(warningLabel(warning));
  }
  return Array.from(new Set(messages));
}

export function multiViewArtifactGroups(
  files: readonly ApiExportFile[],
): readonly MultiViewArtifactGroup[] {
  const groups = new Map<string, ApiExportFile[]>();
  for (const file of files) {
    if (!MULTI_VIEW_ARTIFACT_LABELS[file.format]) continue;
    const key =
      file.format === "pose_frames_device_json"
        ? "pose_frames_device_json"
        : file.artifactName ?? file.format;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  return Array.from(groups.entries()).map(([key, groupedFiles]) => ({
    key,
    label: MULTI_VIEW_ARTIFACT_LABELS[groupedFiles[0]?.format ?? key] ?? readableCode(key),
    files: groupedFiles,
  }));
}

export function artifactDisplayName(file: ApiExportFile) {
  if (file.format === "pose_frames_device_json") {
    const match = file.artifactName?.match(/pose_frames_device_(\d+)_json/);
    return match ? `Device ${match[1]} pose JSON` : "Per-camera pose JSON";
  }
  return MULTI_VIEW_ARTIFACT_LABELS[file.format] ?? readableCode(file.artifactName ?? file.format);
}

function compactRows(rows: readonly (readonly [string, string | undefined])[]): DisplayRow[] {
  return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

function finiteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readableCode(code: string) {
  return code
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
