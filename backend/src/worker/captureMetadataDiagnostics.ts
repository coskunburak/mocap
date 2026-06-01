import type {
  CaptureMetadataCompleteness,
  CaptureMetadataDeviceCompleteness,
  CaptureMetadataDiagnostics,
} from "./types";

export type CaptureMetadataDiagnosticSource = {
  deviceIndex: number;
  deviceId?: string | null;
  deviceRole?: string | null;
  captureMetadata?: unknown | null;
};

type FieldSpec = {
  name: string;
  paths: readonly string[];
};

const TIMESTAMP_FIELD_PATHS = [
  "recordingStartedAt",
  "recordingStartTimeMs",
  "recordingStartWallClockMs",
  "recordingStartMonotonicMs",
  "firstFrameTimestampMs",
  "framePresentationTimestampsMs",
  "video.firstFrameTimestampMs",
  "video.framePresentationTimestampsMs",
  "localClockTimeMs",
  "sync.localClockTimeMs",
  "serverReceivedAtMs",
  "networkClockOffsetMs",
  "sync.networkClockOffsetMs",
  "sync.clockOffsetMs",
  "manualOffsetMs",
  "sync.manualOffsetMs",
] as const;

const CAMERA_FIELD_PATHS = [
  "cameraId",
  "cameraRole",
  "deviceRole",
  "camera.position",
  "camera.intrinsics",
  "camera.cameraIntrinsics",
  "camera.intrinsicMatrixK",
  "camera.lensDistortion",
  "camera.focalLength",
  "camera.focalLengthMm",
  "camera.sensorSize",
  "cameraIntrinsics",
  "intrinsicMatrixK",
  "lensDistortion",
  "focalLength",
  "sensorSize",
  "approxCameraAngle",
  "approximateCameraAngle",
] as const;

const COMPLETENESS_FIELDS: readonly FieldSpec[] = [
  { name: "cameraId", paths: ["cameraId"] },
  { name: "deviceId", paths: ["deviceId"] },
  { name: "cameraRole", paths: ["cameraRole", "deviceRole"] },
  {
    name: "recordingStartWallClockMs",
    paths: ["recordingStartWallClockMs", "recordingStartTimeMs", "recordingStartedAt"],
  },
  { name: "recordingStartMonotonicMs", paths: ["recordingStartMonotonicMs"] },
  {
    name: "firstFrameTimestampMs",
    paths: ["firstFrameTimestampMs", "video.firstFrameTimestampMs"],
  },
  {
    name: "framePresentationTimestampsMs",
    paths: ["framePresentationTimestampsMs", "video.framePresentationTimestampsMs"],
  },
  { name: "fps", paths: ["fps", "video.fps"] },
  { name: "width", paths: ["width", "video.width", "resolution.width", "video.resolution.width"] },
  { name: "height", paths: ["height", "video.height", "resolution.height", "video.resolution.height"] },
  { name: "durationMs", paths: ["durationMs", "video.durationMs"] },
  { name: "frameCount", paths: ["frameCount", "video.frameCount"] },
  { name: "localClockTimeMs", paths: ["localClockTimeMs", "sync.localClockTimeMs"] },
  { name: "serverReceivedAtMs", paths: ["serverReceivedAtMs"] },
  {
    name: "networkClockOffsetMs",
    paths: ["networkClockOffsetMs", "sync.networkClockOffsetMs", "sync.clockOffsetMs"],
  },
  { name: "manualOffsetMs", paths: ["manualOffsetMs", "sync.manualOffsetMs"] },
  { name: "hasAudioTrack", paths: ["hasAudioTrack", "video.hasAudioTrack"] },
  {
    name: "cameraIntrinsics",
    paths: ["cameraIntrinsics", "camera.cameraIntrinsics", "camera.intrinsics", "intrinsicMatrixK", "camera.intrinsicMatrixK"],
  },
  { name: "lensDistortion", paths: ["lensDistortion", "camera.lensDistortion"] },
  { name: "focalLength", paths: ["focalLength", "camera.focalLength", "camera.focalLengthMm"] },
  { name: "sensorSize", paths: ["sensorSize", "camera.sensorSize"] },
  {
    name: "approximateCameraAngle",
    paths: ["approximateCameraAngle", "approxCameraAngle"],
  },
] as const;

export function buildCaptureMetadataDiagnostics(
  sources: readonly CaptureMetadataDiagnosticSource[],
): CaptureMetadataDiagnostics {
  const perDevice = sources.map(buildDeviceCompleteness);
  const expectedFieldCount = perDevice.length * COMPLETENESS_FIELDS.length;
  const presentFieldCount = perDevice.reduce(
    (sum, device) => sum + device.presentFields.length,
    0,
  );
  const missingFieldCount = Math.max(0, expectedFieldCount - presentFieldCount);
  const ratio = expectedFieldCount > 0 ? presentFieldCount / expectedFieldCount : 0;
  const completeness: CaptureMetadataCompleteness = {
    status: completenessStatus(ratio, perDevice.length),
    ratio,
    presentFieldCount,
    expectedFieldCount,
    missingFieldCount,
    perDevice,
  };

  const availableTimestampFields = availableFields(sources, TIMESTAMP_FIELD_PATHS);
  const availableCameraMetadataFields = availableFields(sources, CAMERA_FIELD_PATHS);
  const audioTrackDeviceCount = perDevice.filter((device) => device.hasAudioTrack).length;
  const intrinsicsDeviceCount = perDevice.filter((device) => device.hasIntrinsics).length;
  const frameTimestampDeviceCount = perDevice.filter(
    (device) => device.hasFrameTimestamps,
  ).length;

  return {
    metadataCompleteness: completeness,
    availableTimestampFields,
    availableCameraMetadataFields,
    hasAudioTrack: sources.length > 0 && audioTrackDeviceCount === sources.length,
    hasIntrinsics: sources.length > 0 && intrinsicsDeviceCount === sources.length,
    hasFrameTimestamps:
      sources.length > 0 && frameTimestampDeviceCount === sources.length,
    missingMetadataWarnings: buildMissingMetadataWarnings({
      sources,
      perDevice,
      audioTrackDeviceCount,
      intrinsicsDeviceCount,
      frameTimestampDeviceCount,
    }),
    audioTrackDeviceCount,
    intrinsicsDeviceCount,
    frameTimestampDeviceCount,
  };
}

function buildDeviceCompleteness(
  source: CaptureMetadataDiagnosticSource,
): CaptureMetadataDeviceCompleteness {
  const metadata = recordOrNull(source.captureMetadata);
  if (!metadata) {
    return {
      deviceIndex: source.deviceIndex,
      ...(stringOrUndefined(source.deviceId) ? { deviceId: stringOrUndefined(source.deviceId) } : {}),
      ...(stringOrUndefined(source.deviceRole) ? { deviceRole: stringOrUndefined(source.deviceRole) } : {}),
      presentFields: [],
      missingFields: COMPLETENESS_FIELDS.map((field) => field.name),
      hasAudioTrack: false,
      hasIntrinsics: false,
      hasFrameTimestamps: false,
    };
  }

  const presentFields: string[] = [];
  const missingFields: string[] = [];
  for (const field of COMPLETENESS_FIELDS) {
    if (field.paths.some((path) => hasMeaningfulValue(metadata, path))) {
      presentFields.push(field.name);
    } else {
      missingFields.push(field.name);
    }
  }

  return {
    deviceIndex: source.deviceIndex,
    deviceId:
      stringOrUndefined(metadata.deviceId) ?? stringOrUndefined(source.deviceId),
    deviceRole:
      stringOrUndefined(metadata.deviceRole) ??
      stringOrUndefined(metadata.cameraRole) ??
      stringOrUndefined(source.deviceRole),
    presentFields,
    missingFields,
    hasAudioTrack: readBoolean(metadata, "hasAudioTrack") === true ||
      readBoolean(metadata, "video.hasAudioTrack") === true,
    hasIntrinsics: hasIntrinsics(metadata),
    hasFrameTimestamps: hasFrameTimestamps(metadata),
  };
}

function availableFields(
  sources: readonly CaptureMetadataDiagnosticSource[],
  paths: readonly string[],
) {
  const names = new Set<string>();
  for (const source of sources) {
    const metadata = recordOrNull(source.captureMetadata);
    if (!metadata) continue;
    for (const path of paths) {
      if (hasMeaningfulValue(metadata, path)) {
        names.add(path);
      }
    }
  }
  return Array.from(names).sort();
}

function buildMissingMetadataWarnings(input: {
  sources: readonly CaptureMetadataDiagnosticSource[];
  perDevice: readonly CaptureMetadataDeviceCompleteness[];
  audioTrackDeviceCount: number;
  intrinsicsDeviceCount: number;
  frameTimestampDeviceCount: number;
}) {
  const warnings = new Set<string>();
  for (const device of input.perDevice) {
    for (const field of device.missingFields) {
      warnings.add(`metadata_missing_device_${device.deviceIndex}_${field}`);
    }
    if (!device.hasFrameTimestamps) {
      warnings.add(`metadata_missing_device_${device.deviceIndex}_frame_timestamps`);
    }
    if (!device.hasIntrinsics) {
      warnings.add(`metadata_missing_device_${device.deviceIndex}_camera_intrinsics`);
    }
  }

  if (input.sources.length > 0 && input.audioTrackDeviceCount < input.sources.length) {
    warnings.add("metadata_audio_sync_unavailable");
  }
  if (input.sources.length > 0 && input.intrinsicsDeviceCount < input.sources.length) {
    warnings.add("metadata_camera_intrinsics_incomplete");
  }
  if (input.sources.length > 0 && input.frameTimestampDeviceCount < input.sources.length) {
    warnings.add("metadata_frame_timestamps_incomplete");
  }
  if (
    input.perDevice.some((device) =>
      device.missingFields.includes("networkClockOffsetMs"),
    )
  ) {
    warnings.add("metadata_network_clock_offset_missing");
  }

  return Array.from(warnings).sort();
}

function completenessStatus(ratio: number, sourceCount: number) {
  if (sourceCount === 0 || ratio === 0) return "missing";
  if (ratio >= 0.9) return "complete";
  if (ratio >= 0.4) return "partial";
  return "minimal";
}

function hasFrameTimestamps(metadata: Record<string, unknown>) {
  return (
    hasNonEmptyNumberArray(getPath(metadata, "framePresentationTimestampsMs")) ||
    hasNonEmptyNumberArray(getPath(metadata, "video.framePresentationTimestampsMs"))
  );
}

function hasIntrinsics(metadata: Record<string, unknown>) {
  return (
    hasIntrinsicRecord(getPath(metadata, "cameraIntrinsics")) ||
    hasIntrinsicRecord(getPath(metadata, "camera.cameraIntrinsics")) ||
    hasIntrinsicRecord(getPath(metadata, "camera.intrinsics")) ||
    hasIntrinsicMatrix(getPath(metadata, "intrinsicMatrixK")) ||
    hasIntrinsicMatrix(getPath(metadata, "camera.intrinsicMatrixK"))
  );
}

function hasIntrinsicRecord(value: unknown) {
  const record = recordOrNull(value);
  if (!record) return false;
  return (
    hasIntrinsicMatrix(record.matrix) ||
    hasIntrinsicMatrix(record.intrinsicMatrixK) ||
    (isFiniteNumber(record.fx) &&
      isFiniteNumber(record.cx) &&
      isFiniteNumber(record.cy))
  );
}

function hasIntrinsicMatrix(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === 9 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function hasMeaningfulValue(metadata: Record<string, unknown>, path: string) {
  const value = getPath(metadata, path);
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object";
}

function getPath(metadata: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[part];
  }, metadata);
}

function readBoolean(metadata: Record<string, unknown>, path: string) {
  const value = getPath(metadata, path);
  return typeof value === "boolean" ? value : undefined;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasNonEmptyNumberArray(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
