import type {
  CameraCalibrationArtifact,
  CameraProjection,
  MultiViewLandmark3D,
  MultiViewMatchedFrameObservation,
  MultiViewQualityMetrics,
  MultiViewReconstructionArtifact,
  MultiViewReconstructionFrame,
  MultiViewSource,
  MultiViewSyncReport,
  MultiViewWarningCode,
  PerCameraPoseArtifact,
  PerCameraPoseFrame,
  Point2D,
  ProjectionMatrix3x4,
  Vector3,
  WorkerMultiViewErrorCode,
} from "../types";
import {
  TriangulationError,
  computeReprojectionError,
  triangulateDLT,
  validateProjectionMatrix,
} from "./triangulation";

const DEFAULT_MIN_KEYPOINT_CONFIDENCE = 0.3;
const DEFAULT_MAX_REPROJECTION_ERROR_PX = 10;
const DEFAULT_COVERAGE_WARNING_THRESHOLD = 0.5;
const DEFAULT_REPROJECTION_WARNING_THRESHOLD_PX = 10;

export type MultiViewReconstructionValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type MultiViewReconstructionOptions = {
  minKeypointConfidence?: number;
  maxReprojectionErrorPx?: number;
  coverageWarningThreshold?: number;
  reprojectionWarningThresholdPx?: number;
};

export type BuildMultiViewReconstructionInput = {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  syncReport: MultiViewSyncReport;
  calibrationArtifact: CameraCalibrationArtifact;
  source: MultiViewSource;
  options?: MultiViewReconstructionOptions;
};

export class MultiViewReconstructionError extends Error {
  constructor(
    readonly code: Extract<
      WorkerMultiViewErrorCode,
      | "multi_view_reconstruction_invalid"
      | "camera_projection_invalid"
      | "triangulation_failed"
    >,
    message: string,
  ) {
    super(message);
    this.name = "MultiViewReconstructionError";
  }
}

type NormalizedReconstructionOptions = {
  minKeypointConfidence: number;
  maxReprojectionErrorPx: number;
  coverageWarningThreshold: number;
  reprojectionWarningThresholdPx: number;
};

type ReconstructionContext = {
  poseArtifactsByDevice: ReadonlyMap<number, PerCameraPoseArtifact>;
  framesByDeviceAndIndex: ReadonlyMap<number, ReadonlyMap<number, PerCameraPoseFrame>>;
  projectionsByDevice: ReadonlyMap<number, CameraProjection>;
  options: NormalizedReconstructionOptions;
};

type LandmarkBuildResult = {
  landmark: MultiViewLandmark3D | null;
  triangulated: boolean;
  fallback: boolean;
  highReprojectionError: boolean;
};

type ReconstructionCounters = {
  totalLandmarks: number;
  triangulatedLandmarks: number;
  fallbackLandmarks: number;
  highReprojectionLandmarks: number;
  reprojectionErrors: number[];
};

type ValidLandmarkObservation = {
  deviceIndex: number;
  point: Point2D;
  projection: ProjectionMatrix3x4;
  confidence: number;
};

type FallbackLandmarkObservation = {
  deviceIndex: number;
  point: Point2D;
  confidence: number;
};

export function buildMultiViewReconstructionArtifact(
  input: BuildMultiViewReconstructionInput,
): MultiViewReconstructionArtifact {
  validateReconstructionInput(input);
  const options = normalizeOptions(input.options);
  const context = buildContext({ input, options });
  const counters: ReconstructionCounters = {
    totalLandmarks: 0,
    triangulatedLandmarks: 0,
    fallbackLandmarks: 0,
    highReprojectionLandmarks: 0,
    reprojectionErrors: [],
  };
  const frames = input.syncReport.matchedFrames.map((matchedFrame) =>
    buildReconstructionFrame({ matchedFrame, context, counters }),
  );
  const metrics = buildAggregateMetrics({
    syncReport: input.syncReport,
    calibrationArtifact: input.calibrationArtifact,
    counters,
    options,
  });
  const warnings = buildWarnings({
    syncReport: input.syncReport,
    calibrationArtifact: input.calibrationArtifact,
    counters,
    metrics,
    options,
  });

  return {
    schema: "mocap.multiview_reconstruction.v1",
    takeId: input.syncReport.takeId,
    jobId: input.syncReport.jobId,
    source: input.source,
    frameCount: frames.length,
    landmarkSchema: inferLandmarkSchema(input.poseArtifacts),
    frames,
    metrics,
    warnings,
  };
}

export function validateMultiViewReconstructionArtifact(
  artifact: MultiViewReconstructionArtifact,
): MultiViewReconstructionValidationResult {
  const errors: string[] = [];
  if (artifact.schema !== "mocap.multiview_reconstruction.v1") {
    errors.push("schema must be mocap.multiview_reconstruction.v1");
  }
  if (!artifact.takeId) errors.push("takeId is required");
  if (!artifact.jobId) errors.push("jobId is required");
  if (!["dual_camera", "multi_view"].includes(artifact.source)) {
    errors.push("source must be dual_camera or multi_view");
  }
  if (artifact.frameCount !== artifact.frames.length) {
    errors.push("frameCount must match frames length");
  }
  if (!["body_33", "wham_internal", "custom"].includes(artifact.landmarkSchema)) {
    errors.push("landmarkSchema is invalid");
  }
  validateMetrics(artifact.metrics, errors);
  validateFrames(artifact.frames, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateReconstructionInput(input: BuildMultiViewReconstructionInput) {
  if (input.poseArtifacts.length < 2) {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      "At least two per-camera pose artifacts are required.",
    );
  }
  if (input.syncReport.schema !== "mocap.multiview_sync.v1") {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      "syncReport must use mocap.multiview_sync.v1.",
    );
  }
  if (input.calibrationArtifact.schema !== "mocap.camera_calibration.v1") {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      "calibrationArtifact must use mocap.camera_calibration.v1.",
    );
  }
  if (input.syncReport.takeId !== input.calibrationArtifact.takeId) {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      "syncReport and calibrationArtifact takeId must match.",
    );
  }
  if (input.syncReport.jobId !== input.calibrationArtifact.jobId) {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      "syncReport and calibrationArtifact jobId must match.",
    );
  }
  for (const artifact of input.poseArtifacts) {
    if (artifact.schema !== "mocap.pose_frames_device.v1") {
      throw new MultiViewReconstructionError(
        "multi_view_reconstruction_invalid",
        "All pose artifacts must use mocap.pose_frames_device.v1.",
      );
    }
    if (artifact.takeId !== input.syncReport.takeId) {
      throw new MultiViewReconstructionError(
        "multi_view_reconstruction_invalid",
        "All pose artifacts must match syncReport takeId.",
      );
    }
    if (artifact.jobId !== input.syncReport.jobId) {
      throw new MultiViewReconstructionError(
        "multi_view_reconstruction_invalid",
        "All pose artifacts must match syncReport jobId.",
      );
    }
  }
  if (!["dual_camera", "multi_view"].includes(input.source)) {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      "source must be dual_camera or multi_view.",
    );
  }
}

function normalizeOptions(
  options: MultiViewReconstructionOptions | undefined,
): NormalizedReconstructionOptions {
  const normalized = {
    minKeypointConfidence:
      options?.minKeypointConfidence ?? DEFAULT_MIN_KEYPOINT_CONFIDENCE,
    maxReprojectionErrorPx:
      options?.maxReprojectionErrorPx ?? DEFAULT_MAX_REPROJECTION_ERROR_PX,
    coverageWarningThreshold:
      options?.coverageWarningThreshold ?? DEFAULT_COVERAGE_WARNING_THRESHOLD,
    reprojectionWarningThresholdPx:
      options?.reprojectionWarningThresholdPx ??
      DEFAULT_REPROJECTION_WARNING_THRESHOLD_PX,
  };
  validateUnitIntervalOption(
    normalized.minKeypointConfidence,
    "minKeypointConfidence",
  );
  validateUnitIntervalOption(
    normalized.coverageWarningThreshold,
    "coverageWarningThreshold",
  );
  validatePositiveFiniteOption(
    normalized.maxReprojectionErrorPx,
    "maxReprojectionErrorPx",
  );
  validatePositiveFiniteOption(
    normalized.reprojectionWarningThresholdPx,
    "reprojectionWarningThresholdPx",
  );
  return normalized;
}

function buildContext(input: {
  input: BuildMultiViewReconstructionInput;
  options: NormalizedReconstructionOptions;
}): ReconstructionContext {
  const poseArtifactsByDevice = new Map<number, PerCameraPoseArtifact>();
  const framesByDeviceAndIndex = new Map<
    number,
    ReadonlyMap<number, PerCameraPoseFrame>
  >();
  for (const artifact of input.input.poseArtifacts) {
    if (poseArtifactsByDevice.has(artifact.deviceIndex)) {
      throw new MultiViewReconstructionError(
        "multi_view_reconstruction_invalid",
        `Duplicate pose artifact for deviceIndex ${artifact.deviceIndex}.`,
      );
    }
    poseArtifactsByDevice.set(artifact.deviceIndex, artifact);
    framesByDeviceAndIndex.set(
      artifact.deviceIndex,
      new Map(artifact.frames.map((frame) => [frame.frameIndex, frame])),
    );
  }

  const projectionsByDevice = new Map<number, CameraProjection>();
  for (const projection of input.input.calibrationArtifact.devices) {
    const validation = validateProjectionMatrix({
      projection: projection.projection,
    });
    if (!validation.ok) {
      throw new MultiViewReconstructionError(
        "camera_projection_invalid",
        `Invalid projection for device ${projection.deviceIndex}: ${validation.reason}`,
      );
    }
    projectionsByDevice.set(projection.deviceIndex, projection);
  }

  for (const device of poseArtifactsByDevice.keys()) {
    if (!projectionsByDevice.has(device)) {
      throw new MultiViewReconstructionError(
        "camera_projection_invalid",
        `Missing projection for device ${device}.`,
      );
    }
  }

  return {
    poseArtifactsByDevice,
    framesByDeviceAndIndex,
    projectionsByDevice,
    options: input.options,
  };
}

function buildReconstructionFrame(input: {
  matchedFrame: MultiViewSyncReport["matchedFrames"][number];
  context: ReconstructionContext;
  counters: ReconstructionCounters;
}): MultiViewReconstructionFrame {
  const frameObservations = input.matchedFrame.observations
    .map((observation) =>
      findFrameObservation({
        observation,
        context: input.context,
      }),
    )
    .filter((observation): observation is FrameObservation => observation !== null);
  const landmarkCount = Math.max(
    0,
    ...frameObservations.map((observation) => observation.frame.keypoints2d.length),
  );
  const landmarks3D: MultiViewLandmark3D[] = [];
  const frameReprojectionErrors: number[] = [];
  let frameTriangulatedCount = 0;
  let frameFallbackCount = 0;

  for (let landmarkIndex = 0; landmarkIndex < landmarkCount; landmarkIndex++) {
    const result = buildLandmark({
      frameObservations,
      landmarkIndex,
      context: input.context,
    });
    if (!result.landmark) continue;
    landmarks3D.push(result.landmark);
    input.counters.totalLandmarks += 1;
    if (result.triangulated) {
      input.counters.triangulatedLandmarks += 1;
      frameTriangulatedCount += 1;
      input.counters.reprojectionErrors.push(result.landmark.reprojectionErrorPx);
      frameReprojectionErrors.push(result.landmark.reprojectionErrorPx);
    }
    if (result.fallback) {
      input.counters.fallbackLandmarks += 1;
      frameFallbackCount += 1;
    }
    if (result.highReprojectionError) {
      input.counters.highReprojectionLandmarks += 1;
    }
  }

  const frameLandmarkCount = frameTriangulatedCount + frameFallbackCount;

  return {
    frameIndex: input.matchedFrame.referenceFrameIndex,
    timestampMs: input.matchedFrame.timestampMs,
    matchedDevices: frameObservations.map((observation) => observation.deviceIndex),
    averageTimeDeltaMs: input.matchedFrame.averageTimeDeltaMs,
    landmarks3D,
    metrics: {
      triangulatedLandmarkRatio:
        frameLandmarkCount > 0 ? frameTriangulatedCount / frameLandmarkCount : 0,
      fallbackLandmarkRatio:
        frameLandmarkCount > 0 ? frameFallbackCount / frameLandmarkCount : 0,
      reprojectionErrorPx: average(frameReprojectionErrors),
    },
  };
}

type FrameObservation = {
  deviceIndex: number;
  frame: PerCameraPoseFrame;
  projection: CameraProjection;
  syncObservation: MultiViewMatchedFrameObservation;
};

function findFrameObservation(input: {
  observation: MultiViewMatchedFrameObservation;
  context: ReconstructionContext;
}): FrameObservation | null {
  const frame = input.context.framesByDeviceAndIndex
    .get(input.observation.deviceIndex)
    ?.get(input.observation.frameIndex);
  const projection = input.context.projectionsByDevice.get(
    input.observation.deviceIndex,
  );
  if (!frame || !projection) return null;
  return {
    deviceIndex: input.observation.deviceIndex,
    frame,
    projection,
    syncObservation: input.observation,
  };
}

function buildLandmark(input: {
  frameObservations: readonly FrameObservation[];
  landmarkIndex: number;
  context: ReconstructionContext;
}): LandmarkBuildResult {
  const validObservations: ValidLandmarkObservation[] = [];
  const fallbackObservations: FallbackLandmarkObservation[] = [];
  for (const observation of input.frameObservations) {
    const point = observation.frame.keypoints2d[input.landmarkIndex];
    const confidence = observation.frame.confidence[input.landmarkIndex];
    if (!point || confidence == null) continue;
    fallbackObservations.push({
      deviceIndex: observation.deviceIndex,
      point,
      confidence,
    });
    if (confidence < input.context.options.minKeypointConfidence) continue;
    validObservations.push({
      deviceIndex: observation.deviceIndex,
      point,
      projection: observation.projection.projection,
      confidence,
    });
  }

  if (validObservations.length < 2) {
    return buildFallbackResult(fallbackObservations);
  }

  try {
    const result = triangulateDLT({
      observations: validObservations,
      minConfidence: input.context.options.minKeypointConfidence,
    });
    if (result.status !== "triangulated") {
      return buildFallbackResult(fallbackObservations);
    }
    const reprojectionErrorPx = average(
      validObservations.map((observation) =>
        computeReprojectionError({
          projection: observation.projection,
          point3d: result.point,
          observed: observation.point,
        }),
      ),
    );
    const highReprojectionError =
      reprojectionErrorPx > input.context.options.maxReprojectionErrorPx;
    if (highReprojectionError) {
      const fallback = buildFallbackResult(fallbackObservations);
      return {
        ...fallback,
        highReprojectionError: true,
      };
    }
    return {
      landmark: {
        x: result.point[0],
        y: result.point[1],
        z: result.point[2],
        visibility: average(validObservations.map((observation) => observation.confidence)),
        source: "triangulated",
        views: validObservations.map((observation) => observation.deviceIndex),
        reprojectionErrorPx,
      },
      triangulated: true,
      fallback: false,
      highReprojectionError: false,
    };
  } catch (error) {
    if (
      error instanceof TriangulationError &&
      error.code === "camera_projection_invalid"
    ) {
      throw new MultiViewReconstructionError(
        "camera_projection_invalid",
        error.message,
      );
    }
    if (error instanceof TriangulationError) {
      const fallback = buildFallbackResult(fallbackObservations);
      return {
        ...fallback,
        highReprojectionError: false,
      };
    }
    throw error;
  }
}

function buildFallbackResult(
  observations: readonly FallbackLandmarkObservation[],
): LandmarkBuildResult {
  const best = [...observations].sort((a, b) => b.confidence - a.confidence)[0];
  if (!best) {
    return {
      landmark: null,
      triangulated: false,
      fallback: false,
      highReprojectionError: false,
    };
  }
  return {
    landmark: {
      x: best.point.x,
      y: best.point.y,
      z: 0,
      visibility: clamp01(best.confidence),
      source: "fallback",
      views: [best.deviceIndex],
      reprojectionErrorPx: 0,
    },
    triangulated: false,
    fallback: true,
    highReprojectionError: false,
  };
}

function buildAggregateMetrics(input: {
  syncReport: MultiViewSyncReport;
  calibrationArtifact: CameraCalibrationArtifact;
  counters: ReconstructionCounters;
  options: NormalizedReconstructionOptions;
}): MultiViewQualityMetrics {
  const reprojectionErrorPx = average(input.counters.reprojectionErrors);
  const reprojectionP95Px = percentile(input.counters.reprojectionErrors, 0.95);
  const triangulatedLandmarkRatio =
    input.counters.totalLandmarks > 0
      ? input.counters.triangulatedLandmarks / input.counters.totalLandmarks
      : 0;
  const fallbackLandmarkRatio =
    input.counters.totalLandmarks > 0
      ? input.counters.fallbackLandmarks / input.counters.totalLandmarks
      : 0;
  const normalizedReprojection =
    input.options.reprojectionWarningThresholdPx > 0
      ? clamp01(reprojectionErrorPx / input.options.reprojectionWarningThresholdPx)
      : 0;

  return {
    syncOffsetMs: maxAbsoluteOffset(input.syncReport),
    syncConfidence: input.syncReport.metrics.syncConfidence,
    matchedFrameCount: input.syncReport.metrics.matchedFrameCount,
    droppedFrameCount: input.syncReport.metrics.droppedFrameCount,
    averageTimeDeltaMs: input.syncReport.metrics.averageTimeDeltaMs,
    reprojectionErrorPx,
    reprojectionP95Px,
    triangulatedLandmarkRatio,
    fallbackLandmarkRatio,
    calibrationQualityScore: input.calibrationArtifact.quality.score,
    intrinsicsFallbackUsed: input.calibrationArtifact.devices.some(
      (device) => device.intrinsicsSource === "fov_fallback",
    )
      ? 1
      : 0,
    multiViewQualityGain: clamp01(
      triangulatedLandmarkRatio *
        input.syncReport.metrics.syncConfidence *
        input.calibrationArtifact.quality.score *
        (1 - normalizedReprojection),
    ),
  };
}

function buildWarnings(input: {
  syncReport: MultiViewSyncReport;
  calibrationArtifact: CameraCalibrationArtifact;
  counters: ReconstructionCounters;
  metrics: MultiViewQualityMetrics;
  options: NormalizedReconstructionOptions;
}) {
  const warnings: MultiViewWarningCode[] = [];
  pushPassThroughWarnings({
    warnings,
    sourceWarnings: input.syncReport.warnings,
    allowed: ["sync_confidence_low"],
  });
  pushPassThroughWarnings({
    warnings,
    sourceWarnings: input.calibrationArtifact.warnings,
    allowed: ["camera_intrinsics_fov_fallback_used", "calibration_quality_low"],
  });
  if (
    input.metrics.triangulatedLandmarkRatio <
    input.options.coverageWarningThreshold
  ) {
    warnings.push("triangulation_coverage_low");
  }
  if (
    input.metrics.reprojectionP95Px >
      input.options.reprojectionWarningThresholdPx ||
    input.counters.highReprojectionLandmarks > 0
  ) {
    warnings.push("reprojection_error_high");
  }
  return Array.from(new Set(warnings));
}

function pushPassThroughWarnings(input: {
  warnings: MultiViewWarningCode[];
  sourceWarnings: readonly MultiViewWarningCode[];
  allowed: readonly MultiViewWarningCode[];
}) {
  for (const warning of input.sourceWarnings) {
    if (input.allowed.includes(warning)) {
      input.warnings.push(warning);
    }
  }
}

function inferLandmarkSchema(poseArtifacts: readonly PerCameraPoseArtifact[]) {
  return poseArtifacts[0]?.detector.landmarkSchema ?? "custom";
}

function maxAbsoluteOffset(syncReport: MultiViewSyncReport) {
  return syncReport.devices.reduce(
    (max, device) => Math.max(max, Math.abs(device.offsetMs)),
    0,
  );
}

function validateMetrics(metrics: MultiViewQualityMetrics, errors: string[]) {
  validateNonNegativeFiniteNumber(metrics.syncOffsetMs, "metrics.syncOffsetMs", errors);
  validateUnitInterval(metrics.syncConfidence, "metrics.syncConfidence", errors);
  validateNonNegativeFiniteNumber(
    metrics.matchedFrameCount,
    "metrics.matchedFrameCount",
    errors,
  );
  validateNonNegativeFiniteNumber(
    metrics.droppedFrameCount,
    "metrics.droppedFrameCount",
    errors,
  );
  validateNonNegativeFiniteNumber(
    metrics.averageTimeDeltaMs,
    "metrics.averageTimeDeltaMs",
    errors,
  );
  validateNonNegativeFiniteNumber(
    metrics.reprojectionErrorPx,
    "metrics.reprojectionErrorPx",
    errors,
  );
  validateNonNegativeFiniteNumber(
    metrics.reprojectionP95Px,
    "metrics.reprojectionP95Px",
    errors,
  );
  validateUnitInterval(
    metrics.triangulatedLandmarkRatio,
    "metrics.triangulatedLandmarkRatio",
    errors,
  );
  validateUnitInterval(
    metrics.fallbackLandmarkRatio,
    "metrics.fallbackLandmarkRatio",
    errors,
  );
  validateUnitInterval(
    metrics.calibrationQualityScore,
    "metrics.calibrationQualityScore",
    errors,
  );
  validateUnitInterval(
    metrics.intrinsicsFallbackUsed,
    "metrics.intrinsicsFallbackUsed",
    errors,
  );
  validateUnitInterval(
    metrics.multiViewQualityGain,
    "metrics.multiViewQualityGain",
    errors,
  );
}

function validateFrames(
  frames: readonly MultiViewReconstructionFrame[],
  errors: string[],
) {
  let previousTimestampMs = -1;
  for (const [frameIndex, frame] of frames.entries()) {
    if (!Number.isInteger(frame.frameIndex) || frame.frameIndex < 0) {
      errors.push(`frames[${frameIndex}].frameIndex must be a non-negative integer`);
    }
    validateNonNegativeFiniteNumber(
      frame.timestampMs,
      `frames[${frameIndex}].timestampMs`,
      errors,
    );
    if (frame.timestampMs < previousTimestampMs) {
      errors.push("frames timestamps must be sorted ascending");
    }
    previousTimestampMs = frame.timestampMs;
    validateNonNegativeFiniteNumber(
      frame.averageTimeDeltaMs,
      `frames[${frameIndex}].averageTimeDeltaMs`,
      errors,
    );
    if (!frame.matchedDevices.length) {
      errors.push(`frames[${frameIndex}].matchedDevices must not be empty`);
    }
    validateFrameMetrics(frame, frameIndex, errors);
    validateLandmarks(frame.landmarks3D, frameIndex, errors);
  }
}

function validateFrameMetrics(
  frame: MultiViewReconstructionFrame,
  frameIndex: number,
  errors: string[],
) {
  validateUnitInterval(
    frame.metrics.triangulatedLandmarkRatio,
    `frames[${frameIndex}].metrics.triangulatedLandmarkRatio`,
    errors,
  );
  validateUnitInterval(
    frame.metrics.fallbackLandmarkRatio,
    `frames[${frameIndex}].metrics.fallbackLandmarkRatio`,
    errors,
  );
  validateNonNegativeFiniteNumber(
    frame.metrics.reprojectionErrorPx,
    `frames[${frameIndex}].metrics.reprojectionErrorPx`,
    errors,
  );
}

function validateLandmarks(
  landmarks: readonly MultiViewLandmark3D[],
  frameIndex: number,
  errors: string[],
) {
  for (const [landmarkIndex, landmark] of landmarks.entries()) {
    for (const key of ["x", "y", "z", "reprojectionErrorPx"] as const) {
      const value = landmark[key];
      if (!Number.isFinite(value)) {
        errors.push(
          `frames[${frameIndex}].landmarks3D[${landmarkIndex}].${key} must be finite`,
        );
      }
    }
    validateUnitInterval(
      landmark.visibility,
      `frames[${frameIndex}].landmarks3D[${landmarkIndex}].visibility`,
      errors,
    );
    if (!["triangulated", "fallback"].includes(landmark.source)) {
      errors.push(
        `frames[${frameIndex}].landmarks3D[${landmarkIndex}].source is invalid`,
      );
    }
    if (!landmark.views.length) {
      errors.push(
        `frames[${frameIndex}].landmarks3D[${landmarkIndex}].views must not be empty`,
      );
    }
  }
}

function validateUnitIntervalOption(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      `${label} must be between 0 and 1.`,
    );
  }
}

function validatePositiveFiniteOption(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MultiViewReconstructionError(
      "multi_view_reconstruction_invalid",
      `${label} must be a positive finite number.`,
    );
  }
}

function validateNonNegativeFiniteNumber(
  value: number,
  label: string,
  errors: string[],
) {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be a non-negative finite number`);
  }
}

function validateUnitInterval(value: number, label: string, errors: string[]) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${label} must be between 0 and 1`);
  }
}

function average(values: readonly number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
