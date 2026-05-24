import type { ApiExportFile } from "../../../infra/api/MocapApiClient";

export type QualityReportMultiViewSource =
  | "single_camera"
  | "dual_camera"
  | "multi_view"
  | "pro_4_camera";

export type QualityReportMultiViewSection = Readonly<{
  enabled: boolean;
  source: QualityReportMultiViewSource;
  reconstructionAvailable: boolean;
  reconstructionUsedForConstraints: boolean;
  primaryWhamFallbackUsed: boolean;
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
    reprojectionErrorPx?: number;
    reprojectionP95Px?: number;
    triangulatedLandmarkRatio?: number;
    fallbackLandmarkRatio?: number;
    calibrationQualityScore?: number;
    intrinsicsFallbackUsed?: number;
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

const MULTI_VIEW_ARTIFACT_LABELS: Record<string, string> = {
  pose_frames_device_json: "Per-camera pose JSON",
  multi_view_sync_json: "Sync report JSON",
  camera_calibration_json: "Camera calibration JSON",
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
  calibration_quality_low: "Calibration quality is low.",
  sync_confidence_low: "Frame synchronization confidence is low.",
  sync_offset_high: "Frame synchronization offset is high.",
  reprojection_error_high: "Reprojection error is high.",
  triangulation_coverage_low: "Triangulation coverage is low.",
  single_camera_solver_fallback_used: "Primary camera solver fallback was used.",
};

export function sourceLabel(source: QualityReportMultiViewSource | undefined) {
  if (source === "dual_camera") return "Dual Camera";
  if (source === "multi_view") return "Multi-View";
  if (source === "pro_4_camera") return "Pro 4 Camera";
  return "Single Camera";
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
      ["matched frames", metricNumber(metrics?.matchedFrameCount)],
      ["dropped frames", metricNumber(metrics?.droppedFrameCount)],
      ["avg sync delta", metricNumber(metrics?.averageTimeDeltaMs, { suffix: "ms" })],
      ["sync confidence", metricPercent(metrics?.syncConfidence)],
    ]),
    calibration: compactRows([
      ["calibration quality", metricPercent(metrics?.calibrationQualityScore)],
      [
        "intrinsics fallback",
        metrics?.intrinsicsFallbackUsed == null
          ? undefined
          : metrics.intrinsicsFallbackUsed > 0
            ? "Yes"
            : "No",
      ],
    ]),
    triangulation: compactRows([
      ["reprojection avg", metricNumber(metrics?.reprojectionErrorPx, { suffix: "px" })],
      ["reprojection p95", metricNumber(metrics?.reprojectionP95Px, { suffix: "px" })],
      ["triangulated", metricPercent(metrics?.triangulatedLandmarkRatio)],
      ["fallback", metricPercent(metrics?.fallbackLandmarkRatio)],
    ]),
  };
}

export function buildWhamUsageRows(
  section: QualityReportMultiViewSection,
): readonly DisplayRow[] {
  const usage = section.whamInputUsage;
  return compactRows([
    ["source", sourceLabel(section.source)],
    [
      "primary camera",
      usage?.primaryVideoUsed || section.primaryWhamFallbackUsed ? "Used by WHAM" : undefined,
    ],
    ["extra cameras", metricNumber(usage?.additionalVideosProvided)],
    ["reconstruction", booleanLabel(section.reconstructionAvailable)],
    ["constraints used", booleanLabel(section.reconstructionUsedForConstraints)],
    ["primary fallback", booleanLabel(section.primaryWhamFallbackUsed)],
  ]);
}

export function multiViewStatusMessages(
  section: QualityReportMultiViewSection,
): readonly string[] {
  const messages: string[] = [];
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
