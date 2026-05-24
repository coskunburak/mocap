import type {
  MultiViewMatchedFrameObservation,
  MultiViewMatchedFrameSet,
  MultiViewSyncDeviceReport,
  MultiViewSyncReport,
  MultiViewWarningCode,
  PerCameraPoseArtifact,
  PerCameraPoseFrame,
} from "../types";

const DEFAULT_SYNC_TOLERANCE_MS = 33;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5;
const DEFAULT_HIGH_OFFSET_WARNING_THRESHOLD_MS = 50;

export type FrameSyncValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type FrameSyncOptions = {
  referenceDeviceIndex?: number;
  toleranceMs?: number;
  method?: MultiViewSyncDeviceReport["method"];
  lowConfidenceWarningThreshold?: number;
  highOffsetWarningThresholdMs?: number;
  timestampOffsetMsByDevice?: Readonly<Record<number, number>>;
};

export type MatchMultiViewFramesInput = {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  options?: FrameSyncOptions;
};

export type MatchMultiViewFramesResult = {
  referenceDeviceIndex: number;
  toleranceMs: number;
  matchedFrames: MultiViewMatchedFrameSet[];
  devices: MultiViewSyncDeviceReport[];
  metrics: MultiViewSyncReport["metrics"];
  warnings: MultiViewWarningCode[];
};

export class FrameSyncError extends Error {
  constructor(
    readonly code: "multi_view_sync_failed",
    message: string,
  ) {
    super(message);
    this.name = "FrameSyncError";
  }
}

type NormalizedFrameSyncOptions = {
  referenceDeviceIndex: number;
  toleranceMs: number;
  method: MultiViewSyncDeviceReport["method"];
  lowConfidenceWarningThreshold: number;
  highOffsetWarningThresholdMs: number;
  timestampOffsetMsByDevice: Readonly<Record<number, number>>;
};

type SyncContext = {
  poseArtifacts: PerCameraPoseArtifact[];
  referenceArtifact: PerCameraPoseArtifact;
  options: NormalizedFrameSyncOptions;
};

type MatchedCandidate = {
  frame: PerCameraPoseFrame;
  adjustedTimestampMs: number;
  timeDeltaMs: number;
};

export function matchMultiViewFrames(
  input: MatchMultiViewFramesInput,
): MatchMultiViewFramesResult {
  const context = normalizeSyncInput(input);
  const referenceFrames = [...context.referenceArtifact.frames].sort(
    (a, b) => a.timestampMs - b.timestampMs,
  );
  const nonReferenceArtifacts = context.poseArtifacts.filter(
    (artifact) => artifact.deviceIndex !== context.options.referenceDeviceIndex,
  );
  const usedFramesByDevice = new Map<number, Set<number>>();
  for (const artifact of context.poseArtifacts) {
    usedFramesByDevice.set(artifact.deviceIndex, new Set<number>());
  }

  const matchedFrames: MultiViewMatchedFrameSet[] = [];
  for (const referenceFrame of referenceFrames) {
    const referenceTimestampMs = adjustedTimestampMs({
      timestampMs: referenceFrame.timestampMs,
      deviceIndex: context.referenceArtifact.deviceIndex,
      options: context.options,
    });
    const observations: MultiViewMatchedFrameObservation[] = [
      buildObservation({
        frame: referenceFrame,
        deviceIndex: context.referenceArtifact.deviceIndex,
        timeDeltaMs: 0,
      }),
    ];

    for (const artifact of nonReferenceArtifacts) {
      const usedFrames = usedFramesByDevice.get(artifact.deviceIndex);
      if (!usedFrames) continue;
      const candidate = findClosestFrame({
        artifact,
        referenceTimestampMs,
        usedFrames,
        options: context.options,
      });
      if (!candidate) continue;
      usedFrames.add(candidate.frame.frameIndex);
      observations.push(
        buildObservation({
          frame: candidate.frame,
          deviceIndex: artifact.deviceIndex,
          timeDeltaMs: candidate.timeDeltaMs,
        }),
      );
    }

    if (observations.length >= 2) {
      matchedFrames.push({
        referenceFrameIndex: referenceFrame.frameIndex,
        timestampMs: referenceFrame.timestampMs,
        observations,
        averageTimeDeltaMs: averageAbsoluteNonReferenceDelta({
          observations,
          referenceDeviceIndex: context.options.referenceDeviceIndex,
        }),
      });
    }
  }

  const devices = buildDeviceReports({
    poseArtifacts: context.poseArtifacts,
    matchedFrames,
    referenceDeviceIndex: context.options.referenceDeviceIndex,
    method: context.options.method,
  });
  const metrics = buildSyncMetrics({ matchedFrames, devices });
  const warnings = buildWarnings({
    metrics,
    lowConfidenceWarningThreshold:
      context.options.lowConfidenceWarningThreshold,
    highOffsetWarningThresholdMs:
      context.options.highOffsetWarningThresholdMs,
  });

  return {
    referenceDeviceIndex: context.options.referenceDeviceIndex,
    toleranceMs: context.options.toleranceMs,
    matchedFrames,
    devices,
    metrics,
    warnings,
  };
}

export function buildMultiViewSyncReport(
  input: MatchMultiViewFramesInput,
): MultiViewSyncReport {
  const context = normalizeSyncInput(input);
  const result = matchMultiViewFrames({
    poseArtifacts: context.poseArtifacts,
    options: context.options,
  });

  return {
    schema: "mocap.multiview_sync.v1",
    takeId: context.referenceArtifact.takeId,
    jobId: context.referenceArtifact.jobId,
    referenceDeviceIndex: result.referenceDeviceIndex,
    devices: result.devices,
    matchedFrames: result.matchedFrames,
    metrics: result.metrics,
    warnings: result.warnings,
  };
}

export function validateMultiViewSyncReport(
  report: MultiViewSyncReport,
): FrameSyncValidationResult {
  const errors: string[] = [];
  if (report.schema !== "mocap.multiview_sync.v1") {
    errors.push("schema must be mocap.multiview_sync.v1");
  }
  if (!report.takeId) errors.push("takeId is required");
  if (!report.jobId) errors.push("jobId is required");
  if (
    !Number.isInteger(report.referenceDeviceIndex) ||
    report.referenceDeviceIndex < 0
  ) {
    errors.push("referenceDeviceIndex must be a non-negative integer");
  }
  validateDeviceReports(report.devices, errors);
  validateMatchedFrames(report, errors);
  validateMetrics(report.metrics, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function normalizeSyncInput(input: MatchMultiViewFramesInput): SyncContext {
  if (input.poseArtifacts.length < 2) {
    throw new FrameSyncError(
      "multi_view_sync_failed",
      "At least two per-camera pose artifacts are required for frame sync.",
    );
  }
  const poseArtifacts = [...input.poseArtifacts].sort(
    (a, b) => a.deviceIndex - b.deviceIndex,
  );
  const referenceDeviceIndex = input.options?.referenceDeviceIndex ?? 0;
  const referenceArtifact = poseArtifacts.find(
    (artifact) => artifact.deviceIndex === referenceDeviceIndex,
  );
  if (!referenceArtifact) {
    throw new FrameSyncError(
      "multi_view_sync_failed",
      `Reference device ${referenceDeviceIndex} is missing from pose artifacts.`,
    );
  }
  validateInputArtifacts({ poseArtifacts, referenceArtifact });
  const toleranceMs = input.options?.toleranceMs ?? DEFAULT_SYNC_TOLERANCE_MS;
  if (!Number.isFinite(toleranceMs) || toleranceMs < 0) {
    throw new FrameSyncError(
      "multi_view_sync_failed",
      "Frame sync tolerance must be a non-negative finite number.",
    );
  }

  return {
    poseArtifacts,
    referenceArtifact,
    options: {
      referenceDeviceIndex,
      toleranceMs,
      method: input.options?.method ?? "video_timestamps",
      lowConfidenceWarningThreshold:
        input.options?.lowConfidenceWarningThreshold ??
        DEFAULT_LOW_CONFIDENCE_THRESHOLD,
      highOffsetWarningThresholdMs:
        input.options?.highOffsetWarningThresholdMs ??
        DEFAULT_HIGH_OFFSET_WARNING_THRESHOLD_MS,
      timestampOffsetMsByDevice: input.options?.timestampOffsetMsByDevice ?? {},
    },
  };
}

function validateInputArtifacts(input: {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  referenceArtifact: PerCameraPoseArtifact;
}) {
  const seenDeviceIndexes = new Set<number>();
  for (const artifact of input.poseArtifacts) {
    if (artifact.schema !== "mocap.pose_frames_device.v1") {
      throw new FrameSyncError(
        "multi_view_sync_failed",
        "All frame sync inputs must use mocap.pose_frames_device.v1.",
      );
    }
    if (artifact.takeId !== input.referenceArtifact.takeId) {
      throw new FrameSyncError(
        "multi_view_sync_failed",
        "All frame sync inputs must belong to the same takeId.",
      );
    }
    if (artifact.jobId !== input.referenceArtifact.jobId) {
      throw new FrameSyncError(
        "multi_view_sync_failed",
        "All frame sync inputs must belong to the same jobId.",
      );
    }
    if (seenDeviceIndexes.has(artifact.deviceIndex)) {
      throw new FrameSyncError(
        "multi_view_sync_failed",
        `Duplicate deviceIndex ${artifact.deviceIndex} in frame sync inputs.`,
      );
    }
    seenDeviceIndexes.add(artifact.deviceIndex);
  }
}

function findClosestFrame(input: {
  artifact: PerCameraPoseArtifact;
  referenceTimestampMs: number;
  usedFrames: ReadonlySet<number>;
  options: NormalizedFrameSyncOptions;
}): MatchedCandidate | null {
  let best: MatchedCandidate | null = null;
  for (const frame of input.artifact.frames) {
    if (input.usedFrames.has(frame.frameIndex)) continue;
    const adjustedTimestamp = adjustedTimestampMs({
      timestampMs: frame.timestampMs,
      deviceIndex: input.artifact.deviceIndex,
      options: input.options,
    });
    const timeDeltaMs = adjustedTimestamp - input.referenceTimestampMs;
    const absoluteDeltaMs = Math.abs(timeDeltaMs);
    if (absoluteDeltaMs > input.options.toleranceMs) continue;
    if (!best || absoluteDeltaMs < Math.abs(best.timeDeltaMs)) {
      best = {
        frame,
        adjustedTimestampMs: adjustedTimestamp,
        timeDeltaMs,
      };
    }
  }
  return best;
}

function adjustedTimestampMs(input: {
  timestampMs: number;
  deviceIndex: number;
  options: NormalizedFrameSyncOptions;
}) {
  return (
    input.timestampMs +
    (input.options.timestampOffsetMsByDevice[input.deviceIndex] ?? 0)
  );
}

function buildObservation(input: {
  frame: PerCameraPoseFrame;
  deviceIndex: number;
  timeDeltaMs: number;
}): MultiViewMatchedFrameObservation {
  return {
    deviceIndex: input.deviceIndex,
    frameIndex: input.frame.frameIndex,
    timestampMs: input.frame.timestampMs,
    timeDeltaMs: input.timeDeltaMs,
    poseConfidence: input.frame.poseConfidence,
  };
}

function buildDeviceReports(input: {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  matchedFrames: readonly MultiViewMatchedFrameSet[];
  referenceDeviceIndex: number;
  method: MultiViewSyncDeviceReport["method"];
}): MultiViewSyncDeviceReport[] {
  return input.poseArtifacts.map((artifact) => {
    const observations = input.matchedFrames.flatMap((frameSet) =>
      frameSet.observations.filter(
        (observation) => observation.deviceIndex === artifact.deviceIndex,
      ),
    );
    const matchedFrameCount = observations.length;
    const droppedFrameCount = Math.max(
      0,
      artifact.frames.length - matchedFrameCount,
    );
    const timeDeltas = observations.map((observation) =>
      artifact.deviceIndex === input.referenceDeviceIndex
        ? 0
        : observation.timeDeltaMs,
    );
    const absoluteTimeDeltas = timeDeltas.map(Math.abs);

    return {
      deviceIndex: artifact.deviceIndex,
      offsetMs:
        artifact.deviceIndex === input.referenceDeviceIndex
          ? 0
          : average(timeDeltas),
      confidence:
        artifact.frames.length > 0 ? matchedFrameCount / artifact.frames.length : 0,
      method: input.method,
      matchedFrameCount,
      droppedFrameCount,
      averageTimeDeltaMs: average(absoluteTimeDeltas),
      maxTimeDeltaMs: maxOrZero(absoluteTimeDeltas),
    };
  });
}

function buildSyncMetrics(input: {
  matchedFrames: readonly MultiViewMatchedFrameSet[];
  devices: readonly MultiViewSyncDeviceReport[];
}): MultiViewSyncReport["metrics"] {
  const nonReferenceDeltas = input.matchedFrames.flatMap((frameSet) =>
    frameSet.observations
      .filter((observation) => observation.timeDeltaMs !== 0)
      .map((observation) => Math.abs(observation.timeDeltaMs)),
  );
  const matchedObservationCount = input.devices.reduce(
    (sum, device) => sum + device.matchedFrameCount,
    0,
  );
  const droppedFrameCount = input.devices.reduce(
    (sum, device) => sum + device.droppedFrameCount,
    0,
  );
  const confidenceDenominator = matchedObservationCount + droppedFrameCount;

  return {
    matchedFrameCount: input.matchedFrames.length,
    droppedFrameCount,
    averageTimeDeltaMs: average(nonReferenceDeltas),
    maxTimeDeltaMs: maxOrZero(nonReferenceDeltas),
    syncConfidence:
      confidenceDenominator > 0
        ? matchedObservationCount / confidenceDenominator
        : 0,
  };
}

function buildWarnings(input: {
  metrics: MultiViewSyncReport["metrics"];
  lowConfidenceWarningThreshold: number;
  highOffsetWarningThresholdMs: number;
}) {
  const warnings: MultiViewWarningCode[] = [];
  if (input.metrics.syncConfidence < input.lowConfidenceWarningThreshold) {
    warnings.push("sync_confidence_low");
  }
  if (input.metrics.maxTimeDeltaMs > input.highOffsetWarningThresholdMs) {
    warnings.push("sync_offset_high");
  }
  return warnings;
}

function averageAbsoluteNonReferenceDelta(input: {
  observations: readonly MultiViewMatchedFrameObservation[];
  referenceDeviceIndex: number;
}) {
  return average(
    input.observations
      .filter(
        (observation) =>
          observation.deviceIndex !== input.referenceDeviceIndex,
      )
      .map((observation) => Math.abs(observation.timeDeltaMs)),
  );
}

function validateDeviceReports(
  devices: readonly MultiViewSyncDeviceReport[],
  errors: string[],
) {
  if (!devices.length) errors.push("devices must not be empty");
  const seenDeviceIndexes = new Set<number>();
  const methods: readonly MultiViewSyncDeviceReport["method"][] = [
    "audio_marker",
    "metadata_clock_offset",
    "video_timestamps",
    "manual",
    "fallback",
  ];
  for (const [index, device] of devices.entries()) {
    if (!Number.isInteger(device.deviceIndex) || device.deviceIndex < 0) {
      errors.push(`devices[${index}].deviceIndex must be a non-negative integer`);
    }
    if (seenDeviceIndexes.has(device.deviceIndex)) {
      errors.push(`devices[${index}].deviceIndex must be unique`);
    }
    seenDeviceIndexes.add(device.deviceIndex);
    if (!methods.includes(device.method)) {
      errors.push(`devices[${index}].method is invalid`);
    }
    validateNonNegativeFiniteNumber(
      device.matchedFrameCount,
      `devices[${index}].matchedFrameCount`,
      errors,
    );
    validateNonNegativeFiniteNumber(
      device.droppedFrameCount,
      `devices[${index}].droppedFrameCount`,
      errors,
    );
    validateNonNegativeFiniteNumber(
      device.averageTimeDeltaMs,
      `devices[${index}].averageTimeDeltaMs`,
      errors,
    );
    validateNonNegativeFiniteNumber(
      device.maxTimeDeltaMs,
      `devices[${index}].maxTimeDeltaMs`,
      errors,
    );
    validateFiniteNumber(device.offsetMs, `devices[${index}].offsetMs`, errors);
    validateUnitInterval(device.confidence, `devices[${index}].confidence`, errors);
  }
}

function validateMatchedFrames(
  report: MultiViewSyncReport,
  errors: string[],
) {
  let previousTimestampMs = -1;
  for (const [frameIndex, frameSet] of report.matchedFrames.entries()) {
    if (
      !Number.isInteger(frameSet.referenceFrameIndex) ||
      frameSet.referenceFrameIndex < 0
    ) {
      errors.push(
        `matchedFrames[${frameIndex}].referenceFrameIndex must be a non-negative integer`,
      );
    }
    validateNonNegativeFiniteNumber(
      frameSet.timestampMs,
      `matchedFrames[${frameIndex}].timestampMs`,
      errors,
    );
    if (frameSet.timestampMs < previousTimestampMs) {
      errors.push("matchedFrames timestamps must be sorted ascending");
    }
    previousTimestampMs = frameSet.timestampMs;
    validateNonNegativeFiniteNumber(
      frameSet.averageTimeDeltaMs,
      `matchedFrames[${frameIndex}].averageTimeDeltaMs`,
      errors,
    );
    if (frameSet.observations.length < 2) {
      errors.push(
        `matchedFrames[${frameIndex}].observations must contain at least two devices`,
      );
    }
    if (
      !frameSet.observations.some(
        (observation) =>
          observation.deviceIndex === report.referenceDeviceIndex,
      )
    ) {
      errors.push(
        `matchedFrames[${frameIndex}] must include the reference device`,
      );
    }
    validateObservations(frameSet.observations, frameIndex, errors);
  }
}

function validateObservations(
  observations: readonly MultiViewMatchedFrameObservation[],
  frameSetIndex: number,
  errors: string[],
) {
  const seenDeviceIndexes = new Set<number>();
  for (const [index, observation] of observations.entries()) {
    if (!Number.isInteger(observation.deviceIndex) || observation.deviceIndex < 0) {
      errors.push(
        `matchedFrames[${frameSetIndex}].observations[${index}].deviceIndex must be a non-negative integer`,
      );
    }
    if (seenDeviceIndexes.has(observation.deviceIndex)) {
      errors.push(
        `matchedFrames[${frameSetIndex}].observations[${index}].deviceIndex must be unique within a frame set`,
      );
    }
    seenDeviceIndexes.add(observation.deviceIndex);
    if (!Number.isInteger(observation.frameIndex) || observation.frameIndex < 0) {
      errors.push(
        `matchedFrames[${frameSetIndex}].observations[${index}].frameIndex must be a non-negative integer`,
      );
    }
    validateNonNegativeFiniteNumber(
      observation.timestampMs,
      `matchedFrames[${frameSetIndex}].observations[${index}].timestampMs`,
      errors,
    );
    validateFiniteNumber(
      observation.timeDeltaMs,
      `matchedFrames[${frameSetIndex}].observations[${index}].timeDeltaMs`,
      errors,
    );
    validateUnitInterval(
      observation.poseConfidence,
      `matchedFrames[${frameSetIndex}].observations[${index}].poseConfidence`,
      errors,
    );
  }
}

function validateMetrics(
  metrics: MultiViewSyncReport["metrics"],
  errors: string[],
) {
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
    metrics.maxTimeDeltaMs,
    "metrics.maxTimeDeltaMs",
    errors,
  );
  validateUnitInterval(metrics.syncConfidence, "metrics.syncConfidence", errors);
}

function validateFiniteNumber(
  value: number,
  label: string,
  errors: string[],
) {
  if (!Number.isFinite(value)) {
    errors.push(`${label} must be finite`);
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

function maxOrZero(values: readonly number[]) {
  return values.length ? Math.max(...values) : 0;
}
