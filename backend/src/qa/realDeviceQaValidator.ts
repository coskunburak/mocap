export interface RealDeviceQaValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

type QaMode = "single_camera" | "dual_camera" | "multi_view" | "pro_4_camera";

type QaManifest = {
  schema?: unknown;
  runs?: unknown;
};

type QaRun = {
  id?: unknown;
  mode?: unknown;
  platforms?: unknown;
  expectedVideoCount?: unknown;
  actualUploadedVideoCount?: unknown;
  actualBranch?: unknown;
  jobStatus?: unknown;
  artifacts?: unknown;
  qualityReport?: unknown;
  resultScreen?: unknown;
  passed?: unknown;
};

type QualityReportQa = {
  schema?: unknown;
  score?: unknown;
  multiViewPresent?: unknown;
  reconstructionAvailable?: unknown;
  reconstructionUsedForConstraints?: unknown;
  primaryWhamFallbackUsed?: unknown;
  primaryWhamFallbackReason?: unknown;
  matchedFrameCount?: unknown;
  averageTimeDeltaMs?: unknown;
  reprojectionErrorPx?: unknown;
  triangulatedLandmarkRatio?: unknown;
  calibrationQualityScore?: unknown;
  intrinsicsFallbackUsed?: unknown;
};

type ResultScreenQa = {
  multiViewDiagnosticsVisible?: unknown;
};

const VALID_MODES: readonly QaMode[] = [
  "single_camera",
  "dual_camera",
  "multi_view",
  "pro_4_camera",
];

const SINGLE_CAMERA_REQUIRED_ARTIFACTS = [
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

export function validateRealDeviceQaManifest(
  manifest: unknown,
): RealDeviceQaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(manifest)) {
    return {
      passed: false,
      errors: ["manifest must be an object"],
      warnings,
    };
  }

  const item = manifest as QaManifest;
  if (item.schema !== "mocap.real_device_qa.v1") {
    errors.push("schema must be mocap.real_device_qa.v1");
  }
  if (!Array.isArray(item.runs)) {
    errors.push("runs must be an array");
    return { passed: false, errors, warnings };
  }
  if (item.runs.length === 0) {
    errors.push("runs must not be empty");
  }

  for (const [index, value] of item.runs.entries()) {
    validateRun({
      run: value,
      index,
      errors,
      warnings,
    });
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

function validateRun(input: {
  run: unknown;
  index: number;
  errors: string[];
  warnings: string[];
}) {
  const prefix = `runs[${input.index}]`;
  if (!isRecord(input.run)) {
    input.errors.push(`${prefix} must be an object`);
    return;
  }
  const run = input.run as QaRun;
  const runId =
    typeof run.id === "string" && run.id.length > 0
      ? run.id
      : `${prefix}.id`;
  const scoped = (message: string) => `${runId}: ${message}`;

  if (typeof run.id !== "string" || run.id.length === 0) {
    input.errors.push(`${prefix}.id is required`);
  }
  if (!isQaMode(run.mode)) {
    input.errors.push(scoped("mode must be single_camera, dual_camera, multi_view, or pro_4_camera"));
    return;
  }

  const artifacts = stringArray(run.artifacts);
  const qualityReport = isRecord(run.qualityReport)
    ? (run.qualityReport as QualityReportQa)
    : undefined;
  const resultScreen = isRecord(run.resultScreen)
    ? (run.resultScreen as ResultScreenQa)
    : undefined;

  validateCommonRun({
    run,
    runId,
    qualityReport,
    errors: input.errors,
  });

  if (run.mode === "single_camera") {
    validateSingleCameraRun({
      run,
      runId,
      artifacts,
      qualityReport,
      resultScreen,
      errors: input.errors,
    });
    return;
  }

  validateMultiViewRun({
    run,
    mode: run.mode,
    runId,
    artifacts,
    qualityReport,
    resultScreen,
    errors: input.errors,
    warnings: input.warnings,
  });
}

function validateCommonRun(input: {
  run: QaRun;
  runId: string;
  qualityReport: QualityReportQa | undefined;
  errors: string[];
}) {
  if (!isPositiveInteger(input.run.expectedVideoCount)) {
    input.errors.push(`${input.runId}: expectedVideoCount must be a positive integer`);
  }
  if (!isNonNegativeInteger(input.run.actualUploadedVideoCount)) {
    input.errors.push(`${input.runId}: actualUploadedVideoCount must be a non-negative integer`);
  }
  if (!input.qualityReport) {
    input.errors.push(`${input.runId}: qualityReport is required`);
    return;
  }
  if (input.qualityReport.schema !== "mocap.quality_report.v1") {
    input.errors.push(`${input.runId}: qualityReport.schema must be mocap.quality_report.v1`);
  }
}

function validateSingleCameraRun(input: {
  run: QaRun;
  runId: string;
  artifacts: readonly string[];
  qualityReport: QualityReportQa | undefined;
  resultScreen: ResultScreenQa | undefined;
  errors: string[];
}) {
  if (input.run.expectedVideoCount !== 1) {
    input.errors.push(`${input.runId}: single-camera expectedVideoCount must be 1`);
  }
  if (input.run.actualUploadedVideoCount !== 1) {
    input.errors.push(`${input.runId}: single-camera actualUploadedVideoCount must be 1`);
  }
  if (input.run.actualBranch !== "single_camera_wham") {
    input.errors.push(`${input.runId}: single-camera actualBranch must be single_camera_wham`);
  }
  for (const artifact of SINGLE_CAMERA_REQUIRED_ARTIFACTS) {
    if (!input.artifacts.includes(artifact)) {
      input.errors.push(`${input.runId}: missing single-camera artifact ${artifact}`);
    }
  }
  if (input.qualityReport?.multiViewPresent === true) {
    input.errors.push(`${input.runId}: single-camera qualityReport.multiViewPresent must not be true`);
  }
  if (input.resultScreen?.multiViewDiagnosticsVisible === true) {
    input.errors.push(`${input.runId}: single-camera result screen must not show Multi-View Diagnostics`);
  }
}

function validateMultiViewRun(input: {
  run: QaRun;
  mode: Exclude<QaMode, "single_camera">;
  runId: string;
  artifacts: readonly string[];
  qualityReport: QualityReportQa | undefined;
  resultScreen: ResultScreenQa | undefined;
  errors: string[];
  warnings: string[];
}) {
  if (
    typeof input.run.expectedVideoCount !== "number" ||
    input.run.expectedVideoCount < 2
  ) {
    input.errors.push(`${input.runId}: multi-view expectedVideoCount must be at least 2`);
  }
  if (
    typeof input.run.actualUploadedVideoCount !== "number" ||
    input.run.actualUploadedVideoCount < 2
  ) {
    input.errors.push(`${input.runId}: multi-view actualUploadedVideoCount must be at least 2`);
  }
  const report = input.qualityReport;
  if (!report) return;

  if (report.reconstructionUsedForConstraints === true) {
    input.errors.push(`${input.runId}: reconstructionUsedForConstraints must be false for the current pipeline`);
  }
  if (report.reconstructionAvailable === true) {
    if (report.multiViewPresent !== true) {
      input.errors.push(`${input.runId}: multiViewPresent must be true when reconstruction is available`);
    }
    if (!isPositiveFiniteNumber(report.matchedFrameCount)) {
      input.errors.push(`${input.runId}: matchedFrameCount must be > 0 when reconstruction is available`);
    }
    if (!isFiniteNumber(report.averageTimeDeltaMs)) {
      input.errors.push(`${input.runId}: averageTimeDeltaMs must be finite when reconstruction is available`);
    }
    if (!isFiniteNumber(report.reprojectionErrorPx)) {
      input.errors.push(`${input.runId}: reprojectionErrorPx must be finite when reconstruction is available`);
    }
    if (!isFiniteNumber(report.triangulatedLandmarkRatio)) {
      input.errors.push(`${input.runId}: triangulatedLandmarkRatio must be finite when reconstruction is available`);
    }
    if (!isFiniteNumber(report.calibrationQualityScore)) {
      input.errors.push(`${input.runId}: calibrationQualityScore must be finite when reconstruction is available`);
    }
    const reconstructionArtifact =
      input.mode === "dual_camera"
        ? "dual_reconstruction_json"
        : "multi_view_reconstruction_json";
    if (!input.artifacts.includes(reconstructionArtifact)) {
      input.errors.push(`${input.runId}: missing ${reconstructionArtifact}`);
    }
    if (input.resultScreen?.multiViewDiagnosticsVisible !== true) {
      input.errors.push(`${input.runId}: result screen must show Multi-View Diagnostics when reconstruction is available`);
    }
  }
  if (report.primaryWhamFallbackUsed === true) {
    input.warnings.push(`${input.runId}: primary WHAM fallback was used; this is expected for diagnostic-only multi-view`);
  }
  if (report.intrinsicsFallbackUsed === true || report.intrinsicsFallbackUsed === 1) {
    input.warnings.push(`${input.runId}: camera intrinsics fallback was used`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isQaMode(value: unknown): value is QaMode {
  return typeof value === "string" && VALID_MODES.includes(value as QaMode);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}
