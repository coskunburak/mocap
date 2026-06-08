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
  takeId?: unknown;
  jobId?: unknown;
  mode?: unknown;
  platforms?: unknown;
  expectedVideoCount?: unknown;
  actualUploadedVideoCount?: unknown;
  selectedVideoCount?: unknown;
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
  reconstructionBranchEntered?: unknown;
  reconstructionUsedForConstraints?: unknown;
  primaryWhamFallbackUsed?: unknown;
  primaryWhamFallbackReason?: unknown;
  finalAnimationSource?: unknown;
  poseExtractionStatus?: unknown;
  syncStatus?: unknown;
  calibrationStatus?: unknown;
  triangulationStatus?: unknown;
  fittingStatus?: unknown;
  matchedFrameCount?: unknown;
  averageTimeDeltaMs?: unknown;
  reprojectionErrorP95?: unknown;
  reprojectionErrorPx?: unknown;
  triangulatedLandmarkRatio?: unknown;
  reliableConstraintRatio?: unknown;
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
  if (input.run.takeId !== undefined && !isNonEmptyString(input.run.takeId)) {
    input.errors.push(`${input.runId}: takeId must be a non-empty string when provided`);
  }
  if (input.run.jobId !== undefined && !isNonEmptyString(input.run.jobId)) {
    input.errors.push(`${input.runId}: jobId must be a non-empty string when provided`);
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

  if (input.run.selectedVideoCount !== undefined && !isPositiveInteger(input.run.selectedVideoCount)) {
    input.errors.push(`${input.runId}: selectedVideoCount must be a positive integer when provided`);
  }
  if (input.run.actualBranch === "multi_view_reconstruction" && report.reconstructionBranchEntered !== true) {
    input.errors.push(`${input.runId}: reconstructionBranchEntered must be true for multi_view_reconstruction branch`);
  }
  if (typeof report.finalAnimationSource !== "string") {
    input.errors.push(`${input.runId}: qualityReport.finalAnimationSource is required for multi-view QA`);
  }

  const acceptedTrueDual = report.finalAnimationSource === "true_dual_solve";
  if (report.reconstructionUsedForConstraints === true && !acceptedTrueDual) {
    input.errors.push(`${input.runId}: reconstructionUsedForConstraints can be true only for true_dual_solve`);
  }
  if (acceptedTrueDual) {
    if (report.reconstructionUsedForConstraints !== true) {
      input.errors.push(`${input.runId}: true_dual_solve requires reconstructionUsedForConstraints true`);
    }
    if (report.primaryWhamFallbackUsed === true) {
      input.errors.push(`${input.runId}: true_dual_solve must not use primary WHAM fallback`);
    }
    if (!input.artifacts.includes("optimized_bvh")) {
      input.errors.push(`${input.runId}: true_dual_solve missing optimized_bvh`);
    }
    if (!input.artifacts.includes("optimized_solved_motion_json")) {
      input.errors.push(`${input.runId}: true_dual_solve missing optimized_solved_motion_json`);
    }
  }
  if (report.finalAnimationSource === "primary_wham" && report.primaryWhamFallbackUsed !== true) {
    input.errors.push(`${input.runId}: primary_wham final source requires primaryWhamFallbackUsed true for multi-view QA`);
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
    if (report.reprojectionErrorP95 !== undefined && !isFiniteNumber(report.reprojectionErrorP95)) {
      input.errors.push(`${input.runId}: reprojectionErrorP95 must be finite when provided`);
    }
    if (!isFiniteNumber(report.triangulatedLandmarkRatio)) {
      input.errors.push(`${input.runId}: triangulatedLandmarkRatio must be finite when reconstruction is available`);
    }
    if (report.reliableConstraintRatio !== undefined && !isFiniteNumber(report.reliableConstraintRatio)) {
      input.errors.push(`${input.runId}: reliableConstraintRatio must be finite when provided`);
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
