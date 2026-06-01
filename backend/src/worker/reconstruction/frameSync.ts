import type {
  MultiViewMatchedFrameObservation,
  MultiViewMatchedFrameSet,
  MultiViewSyncDeviceReport,
  MultiViewSyncFramePair,
  MultiViewSyncMethod,
  MultiViewSyncReport,
  MultiViewSyncStatus,
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
  method?: MultiViewSyncMethod;
  lowConfidenceWarningThreshold?: number;
  highOffsetWarningThresholdMs?: number;
  timestampOffsetMsByDevice?: Readonly<Record<number, number>>;
  networkClockOffsetMsByDevice?: Readonly<Record<number, number>>;
  recordingStartTimeMsByDevice?: Readonly<Record<number, number>>;
  recordingStartWallClockMsByDevice?: Readonly<Record<number, number>>;
  recordingStartMonotonicMsByDevice?: Readonly<Record<number, number>>;
  firstFrameTimestampMsByDevice?: Readonly<Record<number, number>>;
  framePresentationTimestampsMsByDevice?: Readonly<Record<number, readonly number[]>>;
  fpsByDevice?: Readonly<Record<number, number>>;
  frameCountByDevice?: Readonly<Record<number, number>>;
  hasAudioTrackByDevice?: Readonly<Record<number, boolean>>;
  audioAnalysisAvailable?: boolean;
  manualOffsetMsByDevice?: Readonly<Record<number, number>>;
  audioMarkerOffsetMsByDevice?: Readonly<Record<number, number>>;
  allowIndexFallback?: boolean;
};

export type MatchMultiViewFramesInput = {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  options?: FrameSyncOptions;
};

export type MatchMultiViewFramesResult = {
  referenceDeviceIndex: number;
  toleranceMs: number;
  matchedFrames: MultiViewMatchedFrameSet[];
  framePairs: MultiViewSyncFramePair[];
  devices: MultiViewSyncDeviceReport[];
  metrics: MultiViewSyncReport["metrics"];
  syncMethod: MultiViewSyncMethod;
  status: MultiViewSyncStatus;
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
  method: MultiViewSyncMethod;
  lowConfidenceWarningThreshold: number;
  highOffsetWarningThresholdMs: number;
  allowIndexFallback: boolean;
  timestampOffsetMsByDevice: Readonly<Record<number, number>>;
  networkClockOffsetMsByDevice: Readonly<Record<number, number>>;
  recordingStartTimeMsByDevice: Readonly<Record<number, number>>;
  recordingStartWallClockMsByDevice: Readonly<Record<number, number>>;
  recordingStartMonotonicMsByDevice: Readonly<Record<number, number>>;
  firstFrameTimestampMsByDevice: Readonly<Record<number, number>>;
  framePresentationTimestampsMsByDevice: Readonly<Record<number, readonly number[]>>;
  fpsByDevice: Readonly<Record<number, number>>;
  frameCountByDevice: Readonly<Record<number, number>>;
  hasAudioTrackByDevice: Readonly<Record<number, boolean>>;
  manualOffsetMsByDevice: Readonly<Record<number, number>>;
  audioMarkerOffsetMsByDevice: Readonly<Record<number, number>>;
  status: MultiViewSyncStatus;
  preWarnings: readonly MultiViewWarningCode[];
  useIndexFallback: boolean;
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
  const matchedFrames =
    context.options.status === "missing_timestamps"
      ? []
      : context.options.useIndexFallback ||
          context.options.status === "insufficient_frames"
      ? matchFramesByIndex(context)
      : matchFramesByTimestamp(context);

  const devices = buildDeviceReports({
    poseArtifacts: context.poseArtifacts,
    matchedFrames,
    referenceDeviceIndex: context.options.referenceDeviceIndex,
    method: context.options.method,
  });
  const rawMetrics = buildSyncMetrics({
    matchedFrames,
    devices,
    referenceDeviceIndex: context.options.referenceDeviceIndex,
  });
  const status = syncStatusForResult({
    status: context.options.status,
    matchedFrames,
  });
  const metrics = adjustMetricsForStatus(rawMetrics, status, context.options.method);
  const warnings = buildWarnings({
    metrics,
    status,
    method: context.options.method,
    poseArtifacts: context.poseArtifacts,
    preWarnings: context.options.preWarnings,
    lowConfidenceWarningThreshold:
      context.options.lowConfidenceWarningThreshold,
    highOffsetWarningThresholdMs:
      context.options.highOffsetWarningThresholdMs,
  });
  const framePairs = buildFramePairs({
    matchedFrames,
    poseArtifacts: context.poseArtifacts,
    referenceDeviceIndex: context.options.referenceDeviceIndex,
  });

  return {
    referenceDeviceIndex: context.options.referenceDeviceIndex,
    toleranceMs: context.options.toleranceMs,
    matchedFrames,
    framePairs,
    devices,
    metrics,
    syncMethod: context.options.method,
    status,
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
    schemaVersion: "mocap.multi_view_sync.v1",
    takeId: context.referenceArtifact.takeId,
    jobId: context.referenceArtifact.jobId,
    syncMethod: result.syncMethod,
    referenceDeviceId: context.referenceArtifact.cameraId,
    targetDeviceIds: context.poseArtifacts
      .filter((artifact) => artifact.deviceIndex !== result.referenceDeviceIndex)
      .map((artifact) => artifact.cameraId),
    referenceDeviceIndex: result.referenceDeviceIndex,
    devices: result.devices,
    matchedFrames: result.matchedFrames,
    framePairs: result.framePairs,
    matchedFrameCount: result.metrics.matchedFrameCount,
    averageTimeDeltaMs: result.metrics.averageTimeDeltaMs,
    p95TimeDeltaMs: result.metrics.p95TimeDeltaMs,
    syncConfidence: result.metrics.syncConfidence,
    droppedFrameCount: result.metrics.droppedFrameCount,
    clockOffsetMs:
      result.syncMethod === "network_clock_offset_sync"
        ? representativeOffsetMs(
            context.options.networkClockOffsetMsByDevice,
            result.referenceDeviceIndex,
          )
        : null,
    manualOffsetMs:
      result.syncMethod === "manual_offset_sync"
        ? representativeOffsetMs(
            context.options.manualOffsetMsByDevice,
            result.referenceDeviceIndex,
          )
        : null,
    metadataCompleteness: buildMetadataCompleteness({
      poseArtifacts: context.poseArtifacts,
      options: context.options,
    }),
    status: result.status,
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
  validateSyncMethod(report.syncMethod, "syncMethod", errors);
  if (!report.referenceDeviceId) errors.push("referenceDeviceId is required");
  if (!Array.isArray(report.targetDeviceIds)) {
    errors.push("targetDeviceIds must be an array");
  }
  validateSyncStatus(report.status, errors);
  if (
    !Number.isInteger(report.referenceDeviceIndex) ||
    report.referenceDeviceIndex < 0
  ) {
    errors.push("referenceDeviceIndex must be a non-negative integer");
  }
  validateDeviceReports(report.devices, errors);
  validateMatchedFrames(report, errors);
  validateFramePairs(report.framePairs, errors);
  validateNonNegativeFiniteNumber(
    report.matchedFrameCount,
    "matchedFrameCount",
    errors,
  );
  validateNonNegativeFiniteNumber(
    report.averageTimeDeltaMs,
    "averageTimeDeltaMs",
    errors,
  );
  validateNonNegativeFiniteNumber(report.p95TimeDeltaMs, "p95TimeDeltaMs", errors);
  validateUnitInterval(report.syncConfidence, "syncConfidence", errors);
  validateNonNegativeFiniteNumber(
    report.droppedFrameCount,
    "droppedFrameCount",
    errors,
  );
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
  const syncPlan = resolveSyncPlan({
    poseArtifacts,
    referenceDeviceIndex,
    options: input.options,
  });

  return {
    poseArtifacts,
    referenceArtifact,
    options: {
      referenceDeviceIndex,
      toleranceMs,
      method: syncPlan.method,
      lowConfidenceWarningThreshold:
        input.options?.lowConfidenceWarningThreshold ??
        DEFAULT_LOW_CONFIDENCE_THRESHOLD,
      highOffsetWarningThresholdMs:
        input.options?.highOffsetWarningThresholdMs ??
        DEFAULT_HIGH_OFFSET_WARNING_THRESHOLD_MS,
      allowIndexFallback: input.options?.allowIndexFallback ?? true,
      timestampOffsetMsByDevice: syncPlan.offsetMsByDevice,
      networkClockOffsetMsByDevice:
        input.options?.networkClockOffsetMsByDevice ??
        input.options?.timestampOffsetMsByDevice ??
        {},
      recordingStartTimeMsByDevice:
        input.options?.recordingStartTimeMsByDevice ?? {},
      recordingStartWallClockMsByDevice:
        input.options?.recordingStartWallClockMsByDevice ??
        input.options?.recordingStartTimeMsByDevice ??
        {},
      recordingStartMonotonicMsByDevice:
        input.options?.recordingStartMonotonicMsByDevice ?? {},
      firstFrameTimestampMsByDevice:
        input.options?.firstFrameTimestampMsByDevice ?? {},
      framePresentationTimestampsMsByDevice:
        input.options?.framePresentationTimestampsMsByDevice ?? {},
      fpsByDevice: input.options?.fpsByDevice ?? {},
      frameCountByDevice: input.options?.frameCountByDevice ?? {},
      hasAudioTrackByDevice: input.options?.hasAudioTrackByDevice ?? {},
      manualOffsetMsByDevice: input.options?.manualOffsetMsByDevice ?? {},
      audioMarkerOffsetMsByDevice:
        input.options?.audioMarkerOffsetMsByDevice ?? {},
      status: syncPlan.status,
      preWarnings: syncPlan.warnings,
      useIndexFallback: syncPlan.useIndexFallback,
    },
  };
}

function resolveSyncPlan(input: {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  referenceDeviceIndex: number;
  options?: FrameSyncOptions;
}): {
  method: MultiViewSyncMethod;
  offsetMsByDevice: Readonly<Record<number, number>>;
  status: MultiViewSyncStatus;
  warnings: readonly MultiViewWarningCode[];
  useIndexFallback: boolean;
} {
  const options = input.options;
  const allowIndexFallback = options?.allowIndexFallback ?? true;
  const warnings: MultiViewWarningCode[] = [];
  const networkClockOffsetMsByDevice =
    options?.networkClockOffsetMsByDevice ?? options?.timestampOffsetMsByDevice;

  if (
    options?.audioAnalysisAvailable &&
    hasAllAudioTracks(input.poseArtifacts, options) &&
    hasAnyOffset(options?.audioMarkerOffsetMsByDevice)
  ) {
    return {
      method: "audio_marker_sync",
      offsetMsByDevice: options?.audioMarkerOffsetMsByDevice ?? {},
      status: "ready",
      warnings,
      useIndexFallback: false,
    };
  }

  if (hasAnyAudioTrackMetadata(options) && !options?.audioAnalysisAvailable) {
    warnings.push("sync_audio_analysis_unavailable");
  }
  if (hasExplicitMissingAudioTrack(input.poseArtifacts, options)) {
    warnings.push("sync_audio_track_missing");
  }

  if (
    hasAnyOffset(networkClockOffsetMsByDevice) &&
    hasRecordingTimelineForNetworkClock(input.poseArtifacts, options)
  ) {
    return {
      method: "network_clock_offset_sync",
      offsetMsByDevice: networkClockOffsetMsByDevice ?? {},
      status: "ready",
      warnings,
      useIndexFallback: false,
    };
  }

  if (hasAllFiniteMapValues(input.poseArtifacts, options?.recordingStartMonotonicMsByDevice) &&
      hasNativeFrameTiming(input.poseArtifacts, options)) {
    return {
      method: "monotonic_timestamp_sync",
      offsetMsByDevice: {},
      status: "ready",
      warnings,
      useIndexFallback: false,
    };
  }

  if (hasFramePresentationTimestamps(input.poseArtifacts, options)) {
    return {
      method: "frame_presentation_timestamp_sync",
      offsetMsByDevice: {},
      status: "ready",
      warnings,
      useIndexFallback: false,
    };
  }

  if (hasTrustedFrameTimestamps(input.poseArtifacts)) {
    return {
      method: canonicalSyncMethod(options?.method ?? "frame_presentation_timestamp_sync"),
      offsetMsByDevice: {},
      status: "ready",
      warnings,
      useIndexFallback: false,
    };
  }

  if (hasFirstFrameTimestampAndFps(input.poseArtifacts, options)) {
    return {
      method: "first_frame_timestamp_sync",
      offsetMsByDevice: {},
      status: "approximate",
      warnings: [
        ...warnings,
        "sync_first_frame_timestamp_approximation",
        "sync_diagnostic_approximation",
      ],
      useIndexFallback: false,
    };
  }

  if (
    hasRecordingStartTimes(input.poseArtifacts, input.referenceDeviceIndex, options) &&
    hasAnyFrameTiming(input.poseArtifacts, options)
  ) {
    return {
      method: "wall_clock_sync",
      offsetMsByDevice: {},
      status: "approximate",
      warnings: [
        ...warnings,
        "sync_wall_clock_drift_possible",
        "sync_diagnostic_approximation",
      ],
      useIndexFallback: false,
    };
  }

  if (hasAnyOffset(options?.manualOffsetMsByDevice)) {
    return {
      method: "manual_offset_sync",
      offsetMsByDevice: {},
      status: "approximate",
      warnings: [
        ...warnings,
        "sync_manual_offset_used",
        "sync_diagnostic_approximation",
      ],
      useIndexFallback: false,
    };
  }

  if (allowIndexFallback) {
    return {
      method: "index_based_diagnostic_sync",
      offsetMsByDevice: {},
      status: "diagnostic_only",
      warnings: [
        ...warnings,
        "missing_timestamps",
        "sync_index_based_diagnostic",
        "sync_diagnostic_approximation",
      ],
      useIndexFallback: true,
    };
  }

  return {
    method: "index_based_diagnostic_sync",
    offsetMsByDevice: {},
    status: "missing_timestamps",
    warnings: [...warnings, "missing_timestamps"],
    useIndexFallback: false,
  };
}

function hasAnyOffset(offsets: Readonly<Record<number, number>> | undefined) {
  return Boolean(
    offsets &&
      Object.values(offsets).some(
        (offset) => Number.isFinite(offset),
      ),
  );
}

function canonicalSyncMethod(method: MultiViewSyncMethod): MultiViewSyncMethod {
  switch (method) {
    case "audio_marker":
      return "audio_marker_sync";
    case "metadata_clock_offset":
      return "network_clock_offset_sync";
    case "manual":
      return "manual_offset_sync";
    case "fallback":
      return "index_based_diagnostic_sync";
    case "video_timestamps":
      return "frame_presentation_timestamp_sync";
    default:
      return method;
  }
}

function hasAllAudioTracks(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  return poseArtifacts.every(
    (artifact) => options?.hasAudioTrackByDevice?.[artifact.deviceIndex] === true,
  );
}

function hasAnyAudioTrackMetadata(options?: FrameSyncOptions) {
  return Boolean(
    options?.hasAudioTrackByDevice &&
      Object.values(options.hasAudioTrackByDevice).some((value) => value === true),
  );
}

function hasExplicitMissingAudioTrack(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  return poseArtifacts.some(
    (artifact) => options?.hasAudioTrackByDevice?.[artifact.deviceIndex] === false,
  );
}

function hasTrustedFrameTimestamps(
  poseArtifacts: readonly PerCameraPoseArtifact[],
) {
  return poseArtifacts.every(
    (artifact) =>
      artifact.frames.length > 0 &&
      artifact.frames.every(
        (frame) =>
          Number.isFinite(frame.timestampMs) &&
          frame.timestampSource !== "frame_index",
      ),
  );
}

function hasAllFiniteMapValues(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  values: Readonly<Record<number, number>> | undefined,
) {
  if (!values) return false;
  return poseArtifacts.every((artifact) =>
    Number.isFinite(values[artifact.deviceIndex]),
  );
}

function hasRecordingTimelineForNetworkClock(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  return (
    (hasAllFiniteMapValues(poseArtifacts, options?.recordingStartMonotonicMsByDevice) ||
      hasAllFiniteMapValues(
        poseArtifacts,
        options?.recordingStartWallClockMsByDevice ??
          options?.recordingStartTimeMsByDevice,
      )) &&
    hasNativeFrameTiming(poseArtifacts, options)
  );
}

function hasNativeFrameTiming(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  return (
    hasFramePresentationTimestamps(poseArtifacts, options) ||
    hasFirstFrameTimestampAndFps(poseArtifacts, options) ||
    hasTrustedFrameTimestamps(poseArtifacts)
  );
}

function hasAnyFrameTiming(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  return (
    hasNativeFrameTiming(poseArtifacts, options) ||
    poseArtifacts.every((artifact) =>
      artifact.frames.some((frame) => Number.isFinite(frame.timestampMs)),
    )
  );
}

function hasFramePresentationTimestamps(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  const timestampsByDevice = options?.framePresentationTimestampsMsByDevice;
  if (!timestampsByDevice) return false;
  return poseArtifacts.every((artifact) =>
    artifact.frames.length > 0 &&
    artifact.frames.every((frame) =>
      Number.isFinite(
        timestampsByDevice[artifact.deviceIndex]?.[frame.frameIndex],
      ),
    ),
  );
}

function hasFirstFrameTimestampAndFps(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  options?: FrameSyncOptions,
) {
  return poseArtifacts.every((artifact) => {
    const firstFrameTimestampMs =
      options?.firstFrameTimestampMsByDevice?.[artifact.deviceIndex];
    const fps = fpsForDevice(artifact, options);
    return (
      artifact.frames.length > 0 &&
      Number.isFinite(firstFrameTimestampMs) &&
      Number.isFinite(fps) &&
      fps > 0
    );
  });
}

function hasRecordingStartTimes(
  poseArtifacts: readonly PerCameraPoseArtifact[],
  referenceDeviceIndex: number,
  options?: FrameSyncOptions,
) {
  const starts =
    options?.recordingStartWallClockMsByDevice ??
    options?.recordingStartTimeMsByDevice;
  if (!starts) return false;
  const referenceStart = starts[referenceDeviceIndex];
  if (!Number.isFinite(referenceStart)) return false;
  return poseArtifacts.every((artifact) =>
    Number.isFinite(starts[artifact.deviceIndex]),
  );
}

function fpsForDevice(
  artifact: PerCameraPoseArtifact,
  options?: Pick<FrameSyncOptions, "fpsByDevice">,
) {
  return options?.fpsByDevice?.[artifact.deviceIndex] ?? artifact.sourceVideo.fps;
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

function matchFramesByTimestamp(context: SyncContext): MultiViewMatchedFrameSet[] {
  const referenceFrames = context.referenceArtifact.frames
    .map((frame) => ({
      frame,
      timestampMs: syncTimestampMs({
        frame,
        artifact: context.referenceArtifact,
        options: context.options,
      }),
    }))
    .filter((item) => Number.isFinite(item.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const nonReferenceArtifacts = context.poseArtifacts.filter(
    (artifact) => artifact.deviceIndex !== context.options.referenceDeviceIndex,
  );
  const usedFramesByDevice = new Map<number, Set<number>>();
  for (const artifact of context.poseArtifacts) {
    usedFramesByDevice.set(artifact.deviceIndex, new Set<number>());
  }

  const matchedFrames: MultiViewMatchedFrameSet[] = [];
  for (const reference of referenceFrames) {
    const referenceFrame = reference.frame;
    const referenceTimestampMs = reference.timestampMs;
    const observations: MultiViewMatchedFrameObservation[] = [
      buildObservation({
        frame: referenceFrame,
        deviceIndex: context.referenceArtifact.deviceIndex,
        timestampMs: referenceTimestampMs,
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
          timestampMs: candidate.adjustedTimestampMs,
          timeDeltaMs: candidate.timeDeltaMs,
        }),
      );
    }

    if (observations.length >= 2) {
      matchedFrames.push({
        referenceFrameIndex: referenceFrame.frameIndex,
        timestampMs: referenceTimestampMs,
        observations,
        averageTimeDeltaMs: averageAbsoluteNonReferenceDelta({
          observations,
          referenceDeviceIndex: context.options.referenceDeviceIndex,
        }),
      });
    }
  }
  return matchedFrames;
}

function matchFramesByIndex(context: SyncContext): MultiViewMatchedFrameSet[] {
  if (context.poseArtifacts.some((artifact) => artifact.frames.length === 0)) {
    return [];
  }
  const referenceFrames = [...context.referenceArtifact.frames].sort(
    (a, b) => a.frameIndex - b.frameIndex,
  );
  const nonReferenceArtifacts = context.poseArtifacts
    .filter(
      (artifact) => artifact.deviceIndex !== context.options.referenceDeviceIndex,
    )
    .map((artifact) => ({
      artifact,
      frames: [...artifact.frames].sort((a, b) => a.frameIndex - b.frameIndex),
    }));
  const matchableFrameCount = Math.min(
    referenceFrames.length,
    ...nonReferenceArtifacts.map((item) => item.frames.length),
  );
  const matchedFrames: MultiViewMatchedFrameSet[] = [];

  for (let index = 0; index < matchableFrameCount; index += 1) {
    const referenceFrame = referenceFrames[index];
    if (!referenceFrame) continue;
    const observations: MultiViewMatchedFrameObservation[] = [
      buildObservation({
        frame: referenceFrame,
        deviceIndex: context.referenceArtifact.deviceIndex,
        timestampMs: referenceFrame.timestampMs,
        timeDeltaMs: 0,
      }),
    ];
    for (const item of nonReferenceArtifacts) {
      const targetFrame = item.frames[index];
      if (!targetFrame) continue;
      observations.push(
        buildObservation({
          frame: targetFrame,
          deviceIndex: item.artifact.deviceIndex,
          timestampMs: targetFrame.timestampMs,
          timeDeltaMs: targetFrame.timestampMs - referenceFrame.timestampMs,
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

  return matchedFrames;
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
    const adjustedTimestamp = syncTimestampMs({
      frame,
      artifact: input.artifact,
      options: input.options,
    });
    if (!Number.isFinite(adjustedTimestamp)) continue;
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

function syncTimestampMs(input: {
  frame: PerCameraPoseFrame;
  artifact: PerCameraPoseArtifact;
  options: NormalizedFrameSyncOptions;
}) {
  const deviceIndex = input.artifact.deviceIndex;
  switch (input.options.method) {
    case "audio_marker_sync":
    case "network_clock_offset_sync": {
      const startMs = recordingStartForDevice(deviceIndex, input.options);
      const frameTimestampMs = nativeFrameTimestampMs(input);
      if (!Number.isFinite(startMs) || !Number.isFinite(frameTimestampMs)) {
        return Number.NaN;
      }
      return adjustedTimestampMs({
        timestampMs: startMs + frameTimestampMs,
        deviceIndex,
        options: input.options,
      });
    }
    case "monotonic_timestamp_sync": {
      const startMs = input.options.recordingStartMonotonicMsByDevice[deviceIndex];
      const frameTimestampMs = nativeFrameTimestampMs(input);
      if (!Number.isFinite(startMs) || !Number.isFinite(frameTimestampMs)) {
        return Number.NaN;
      }
      return startMs + frameTimestampMs;
    }
    case "frame_presentation_timestamp_sync":
    case "video_timestamps": {
      return nativeFrameTimestampMs(input);
    }
    case "first_frame_timestamp_sync": {
      return firstFrameDerivedTimestampMs(input);
    }
    case "wall_clock_sync": {
      const startMs =
        input.options.recordingStartWallClockMsByDevice[deviceIndex] ??
        input.options.recordingStartTimeMsByDevice[deviceIndex];
      const frameTimestampMs = approximateFrameTimestampMs(input);
      if (!Number.isFinite(startMs) || !Number.isFinite(frameTimestampMs)) {
        return Number.NaN;
      }
      return startMs + frameTimestampMs;
    }
    case "manual_offset_sync":
    case "manual": {
      const baseTimestampMs = approximateFrameTimestampMs(input);
      if (!Number.isFinite(baseTimestampMs)) return Number.NaN;
      return (
        baseTimestampMs +
        (input.options.manualOffsetMsByDevice[deviceIndex] ?? 0)
      );
    }
    case "metadata_clock_offset":
    case "audio_marker": {
      return adjustedTimestampMs({
        timestampMs: input.frame.timestampMs,
        deviceIndex,
        options: input.options,
      });
    }
    case "fallback":
    case "index_based_diagnostic_sync":
    default:
      return input.frame.timestampMs;
  }
}

function recordingStartForDevice(
  deviceIndex: number,
  options: NormalizedFrameSyncOptions,
) {
  return (
    options.recordingStartMonotonicMsByDevice[deviceIndex] ??
    options.recordingStartWallClockMsByDevice[deviceIndex] ??
    options.recordingStartTimeMsByDevice[deviceIndex]
  );
}

function nativeFrameTimestampMs(input: {
  frame: PerCameraPoseFrame;
  artifact: PerCameraPoseArtifact;
  options: NormalizedFrameSyncOptions;
}) {
  const deviceIndex = input.artifact.deviceIndex;
  const presentationTimestampMs =
    input.options.framePresentationTimestampsMsByDevice[deviceIndex]?.[
      input.frame.frameIndex
    ];
  if (Number.isFinite(presentationTimestampMs)) {
    return presentationTimestampMs;
  }
  const firstFrameTimestampMs =
    input.options.firstFrameTimestampMsByDevice[deviceIndex];
  const fps = fpsForDevice(input.artifact, input.options);
  if (
    Number.isFinite(firstFrameTimestampMs) &&
    Number.isFinite(fps) &&
    fps > 0
  ) {
    return firstFrameTimestampMs + (input.frame.frameIndex * 1000) / fps;
  }
  if (
    Number.isFinite(input.frame.timestampMs) &&
    input.frame.timestampSource !== "frame_index"
  ) {
    return input.frame.timestampMs;
  }
  return Number.NaN;
}

function approximateFrameTimestampMs(input: {
  frame: PerCameraPoseFrame;
  artifact: PerCameraPoseArtifact;
  options: NormalizedFrameSyncOptions;
}) {
  const nativeTimestampMs = nativeFrameTimestampMs(input);
  if (Number.isFinite(nativeTimestampMs)) return nativeTimestampMs;
  return Number.isFinite(input.frame.timestampMs)
    ? input.frame.timestampMs
    : Number.NaN;
}

function firstFrameDerivedTimestampMs(input: {
  frame: PerCameraPoseFrame;
  artifact: PerCameraPoseArtifact;
  options: NormalizedFrameSyncOptions;
}) {
  const deviceIndex = input.artifact.deviceIndex;
  const firstFrameTimestampMs =
    input.options.firstFrameTimestampMsByDevice[deviceIndex];
  const fps = fpsForDevice(input.artifact, input.options);
  if (
    !Number.isFinite(firstFrameTimestampMs) ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    return Number.NaN;
  }
  return firstFrameTimestampMs + (input.frame.frameIndex * 1000) / fps;
}

function buildObservation(input: {
  frame: PerCameraPoseFrame;
  deviceIndex: number;
  timestampMs: number;
  timeDeltaMs: number;
}): MultiViewMatchedFrameObservation {
  return {
    deviceIndex: input.deviceIndex,
    frameIndex: input.frame.frameIndex,
    timestampMs: input.timestampMs,
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
  referenceDeviceIndex: number;
}): MultiViewSyncReport["metrics"] {
  const nonReferenceDeltas = input.matchedFrames.flatMap((frameSet) =>
    frameSet.observations
      .filter((observation) => observation.deviceIndex !== input.referenceDeviceIndex)
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
    p95TimeDeltaMs: percentile(nonReferenceDeltas, 0.95),
    syncConfidence:
      confidenceDenominator > 0
        ? matchedObservationCount / confidenceDenominator
        : 0,
  };
}

function syncStatusForResult(input: {
  status: MultiViewSyncStatus;
  matchedFrames: readonly MultiViewMatchedFrameSet[];
}): MultiViewSyncStatus {
  if (input.status === "missing_timestamps") {
    return "missing_timestamps";
  }
  if (input.matchedFrames.length === 0) {
    return "insufficient_frames";
  }
  return input.status;
}

function adjustMetricsForStatus(
  metrics: MultiViewSyncReport["metrics"],
  status: MultiViewSyncStatus,
  method: MultiViewSyncMethod,
): MultiViewSyncReport["metrics"] {
  if (status === "diagnostic_only") {
    return {
      ...metrics,
      syncConfidence: Math.min(metrics.syncConfidence, 0.45),
    };
  }
  if (status === "approximate") {
    return {
      ...metrics,
      syncConfidence: Math.min(metrics.syncConfidence, confidenceCapForMethod(method)),
    };
  }
  if (
    status === "missing_timestamps" ||
    status === "insufficient_frames" ||
    status === "failed"
  ) {
    return {
      ...metrics,
      syncConfidence: 0,
    };
  }
  return metrics;
}

function confidenceCapForMethod(method: MultiViewSyncMethod) {
  switch (method) {
    case "wall_clock_sync":
      return 0.65;
    case "first_frame_timestamp_sync":
      return 0.7;
    case "manual_offset_sync":
    case "manual":
      return 0.65;
    case "index_based_diagnostic_sync":
    case "fallback":
      return 0.45;
    default:
      return 1;
  }
}

function buildFramePairs(input: {
  matchedFrames: readonly MultiViewMatchedFrameSet[];
  poseArtifacts: readonly PerCameraPoseArtifact[];
  referenceDeviceIndex: number;
}): MultiViewSyncFramePair[] {
  const cameraIdByDevice = new Map(
    input.poseArtifacts.map((artifact) => [artifact.deviceIndex, artifact.cameraId]),
  );
  const pairs: MultiViewSyncFramePair[] = [];
  for (const frameSet of input.matchedFrames) {
    const reference = frameSet.observations.find(
      (observation) => observation.deviceIndex === input.referenceDeviceIndex,
    );
    if (!reference) continue;
    for (const target of frameSet.observations) {
      if (target.deviceIndex === input.referenceDeviceIndex) continue;
      pairs.push({
        referenceCameraId: cameraIdByDevice.get(reference.deviceIndex),
        referenceFrameIndex: reference.frameIndex,
        targetFrameIndex: target.frameIndex,
        referenceTimestampMs: reference.timestampMs,
        targetTimestampMs: target.timestampMs,
        deltaMs: target.timeDeltaMs,
        targetCameraId: cameraIdByDevice.get(target.deviceIndex),
        targetDeviceIndex: target.deviceIndex,
        targetDeviceId: cameraIdByDevice.get(target.deviceIndex),
      });
    }
  }
  return pairs;
}

function representativeOffsetMs(
  offsets: Readonly<Record<number, number>>,
  referenceDeviceIndex: number,
) {
  const nonReferenceOffsets = Object.entries(offsets)
    .map(([deviceIndex, offsetMs]) => ({
      deviceIndex: Number(deviceIndex),
      offsetMs,
    }))
    .filter(
      (entry) =>
        entry.deviceIndex !== referenceDeviceIndex &&
        Number.isFinite(entry.offsetMs),
    );
  if (nonReferenceOffsets.length === 0) {
    return null;
  }
  if (nonReferenceOffsets.length === 1) {
    return nonReferenceOffsets[0]?.offsetMs ?? null;
  }
  return average(nonReferenceOffsets.map((entry) => entry.offsetMs));
}

function buildMetadataCompleteness(input: {
  poseArtifacts: readonly PerCameraPoseArtifact[];
  options: NormalizedFrameSyncOptions;
}): MultiViewSyncReport["metadataCompleteness"] {
  return Object.fromEntries(
    input.poseArtifacts.map((artifact) => {
      const deviceIndex = artifact.deviceIndex;
      const key = `device_${deviceIndex}`;
      const framePresentationTimestamps =
        input.options.framePresentationTimestampsMsByDevice[deviceIndex];
      const hasFrameTimestamps =
        Boolean(framePresentationTimestamps?.length) ||
        artifact.frames.some(
          (frame) =>
            Number.isFinite(frame.timestampMs) &&
            frame.timestampSource !== "frame_index",
        );
      return [
        key,
        {
          hasFrameTimestamps,
          hasFirstFrameTimestamp: Number.isFinite(
            input.options.firstFrameTimestampMsByDevice[deviceIndex],
          ),
          hasMonotonicStart: Number.isFinite(
            input.options.recordingStartMonotonicMsByDevice[deviceIndex],
          ),
          hasWallClockStart:
            Number.isFinite(
              input.options.recordingStartWallClockMsByDevice[deviceIndex],
            ) ||
            Number.isFinite(
              input.options.recordingStartTimeMsByDevice[deviceIndex],
            ),
          hasAudioTrack:
            input.options.hasAudioTrackByDevice[deviceIndex] === true,
          hasNetworkClockOffset: Number.isFinite(
            input.options.networkClockOffsetMsByDevice[deviceIndex],
          ),
          hasManualOffset: Number.isFinite(
            input.options.manualOffsetMsByDevice[deviceIndex],
          ),
        },
      ];
    }),
  );
}

function buildWarnings(input: {
  metrics: MultiViewSyncReport["metrics"];
  status: MultiViewSyncStatus;
  method: MultiViewSyncMethod;
  poseArtifacts: readonly PerCameraPoseArtifact[];
  preWarnings: readonly MultiViewWarningCode[];
  lowConfidenceWarningThreshold: number;
  highOffsetWarningThresholdMs: number;
}) {
  const warnings: MultiViewWarningCode[] = [...input.preWarnings];
  const frameCounts = input.poseArtifacts.map((artifact) => artifact.frames.length);
  if (new Set(frameCounts).size > 1) {
    warnings.push("sync_frame_count_mismatch");
  }
  if (input.metrics.syncConfidence < input.lowConfidenceWarningThreshold) {
    warnings.push("sync_confidence_low");
  }
  if (input.metrics.maxTimeDeltaMs > input.highOffsetWarningThresholdMs) {
    warnings.push("sync_offset_high");
  }
  if (input.status === "insufficient_frames") {
    warnings.push("insufficient_frames");
  }
  if (input.status === "missing_timestamps") {
    warnings.push("missing_timestamps");
  }
  if (input.method === "wall_clock_sync") {
    warnings.push("sync_wall_clock_drift_possible");
  }
  if (input.method === "index_based_diagnostic_sync") {
    warnings.push("sync_index_based_diagnostic");
  }
  return Array.from(new Set(warnings));
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
  for (const [index, device] of devices.entries()) {
    if (!Number.isInteger(device.deviceIndex) || device.deviceIndex < 0) {
      errors.push(`devices[${index}].deviceIndex must be a non-negative integer`);
    }
    if (seenDeviceIndexes.has(device.deviceIndex)) {
      errors.push(`devices[${index}].deviceIndex must be unique`);
    }
    seenDeviceIndexes.add(device.deviceIndex);
    validateSyncMethod(device.method, `devices[${index}].method`, errors);
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

function validateSyncMethod(
  method: MultiViewSyncMethod,
  label: string,
  errors: string[],
) {
  const methods: readonly MultiViewSyncMethod[] = [
    "audio_marker_sync",
    "network_clock_offset_sync",
    "monotonic_timestamp_sync",
    "frame_presentation_timestamp_sync",
    "first_frame_timestamp_sync",
    "wall_clock_sync",
    "manual_offset_sync",
    "index_based_diagnostic_sync",
    "audio_marker",
    "metadata_clock_offset",
    "video_timestamps",
    "manual",
    "fallback",
  ];
  if (!methods.includes(method)) {
    errors.push(`${label} is invalid`);
  }
}

function validateSyncStatus(
  status: MultiViewSyncStatus,
  errors: string[],
) {
  const statuses: readonly MultiViewSyncStatus[] = [
    "ready",
    "approximate",
    "diagnostic_only",
    "missing_timestamps",
    "insufficient_frames",
    "failed",
  ];
  if (!statuses.includes(status)) {
    errors.push("status is invalid");
  }
}

function validateFramePairs(
  framePairs: readonly MultiViewSyncFramePair[],
  errors: string[],
) {
  for (const [index, pair] of framePairs.entries()) {
    if (
      !Number.isInteger(pair.referenceFrameIndex) ||
      pair.referenceFrameIndex < 0
    ) {
      errors.push(`framePairs[${index}].referenceFrameIndex must be a non-negative integer`);
    }
    if (!Number.isInteger(pair.targetFrameIndex) || pair.targetFrameIndex < 0) {
      errors.push(`framePairs[${index}].targetFrameIndex must be a non-negative integer`);
    }
    validateFiniteNumber(
      pair.referenceTimestampMs,
      `framePairs[${index}].referenceTimestampMs`,
      errors,
    );
    validateFiniteNumber(
      pair.targetTimestampMs,
      `framePairs[${index}].targetTimestampMs`,
      errors,
    );
    validateFiniteNumber(pair.deltaMs, `framePairs[${index}].deltaMs`, errors);
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
    validateFiniteNumber(
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
    validateFiniteNumber(
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
  validateNonNegativeFiniteNumber(
    metrics.p95TimeDeltaMs,
    "metrics.p95TimeDeltaMs",
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

function percentile(values: readonly number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index] ?? 0;
}
