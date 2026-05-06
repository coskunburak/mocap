export const CAPTURE_METADATA_SCHEMA = "mocap.capture.v1" as const;

export type CaptureMetadataSchema = typeof CAPTURE_METADATA_SCHEMA;
export type CaptureModeV1 = "solo" | "dual" | "pro_4_camera";
export type CaptureDeviceRole =
  | "primary"
  | "secondary"
  | "front"
  | "back"
  | "left"
  | "right"
  | "calibration";
export type CaptureDevicePlatform = "ios" | "android" | "web" | "unknown";
export type CaptureCameraPosition = "front" | "back" | "external" | "unknown";
export type CaptureVideoOrientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right"
  | "unknown";

export type CameraIntrinsics = Readonly<{
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  skew?: number;
  width: number;
  height: number;
}>;

export type CaptureVideoMetadata = Readonly<{
  fps: number;
  width: number;
  height: number;
  codec: string;
  orientation: CaptureVideoOrientation;
  isMirrored: boolean;
  fileSizeBytes: number;
  localUri?: string;
}>;

export type CaptureCameraMetadata = Readonly<{
  position: CaptureCameraPosition;
  focalLengthMm: number | null;
  intrinsics: CameraIntrinsics | null;
  lensModel: string | null;
}>;

export type CaptureQualityMetadata = Readonly<{
  averagePoseConfidence: number;
  fullBodyVisibleRatio: number;
  badFrames: number;
  trackingLossCount: number;
  poseFpsAverage: number;
}>;

export type CaptureSyncMetadata = Readonly<{
  syncMethod: "single_device_clock" | "network_time_sync" | "audio_marker" | "manual";
  clockOffsetMs: number | null;
  audioSyncMarker: string | null;
}>;

export type CaptureAppMetadata = Readonly<{
  version: string;
  platform: CaptureDevicePlatform;
  buildNumber: string | null;
}>;

export type CaptureMetadata = Readonly<{
  schema: CaptureMetadataSchema;
  takeId: string;
  captureSessionId: string;
  deviceId: string;
  deviceRole: CaptureDeviceRole;
  deviceIndex: number;
  captureMode: CaptureModeV1;
  multiCameraSessionId?: string;
  approxCameraAngle?: number;
  calibrationClipId?: string;
  recordingStartedAt: string;
  recordingEndedAt: string;
  durationMs: number;
  video: CaptureVideoMetadata;
  camera: CaptureCameraMetadata;
  quality: CaptureQualityMetadata;
  sync: CaptureSyncMetadata;
  app: CaptureAppMetadata;
}>;

export type CaptureMetadataValidationResult = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function pushRequiredRecord(
  errors: string[],
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const child = value[key];
  if (!isRecord(child)) {
    errors.push(`${key} must be an object`);
    return undefined;
  }
  return child;
}

export function validateCaptureMetadata(value: unknown): CaptureMetadataValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["metadata must be an object"] };
  }

  if (value.schema !== CAPTURE_METADATA_SCHEMA) {
    errors.push(`schema must be ${CAPTURE_METADATA_SCHEMA}`);
  }

  for (const key of [
    "takeId",
    "captureSessionId",
    "deviceId",
    "deviceRole",
    "recordingStartedAt",
    "recordingEndedAt",
  ] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  if (!Number.isInteger(value.deviceIndex) || (value.deviceIndex as number) < 0) {
    errors.push("deviceIndex must be a non-negative integer");
  }
  if (!["solo", "dual", "pro_4_camera"].includes(String(value.captureMode))) {
    errors.push("captureMode must be solo, dual or pro_4_camera");
  }
  if (
    value.approxCameraAngle != null &&
    !isFiniteNumber(value.approxCameraAngle)
  ) {
    errors.push("approxCameraAngle must be a finite number when provided");
  }
  if (!isFiniteNumber(value.durationMs) || (value.durationMs as number) < 0) {
    errors.push("durationMs must be a non-negative number");
  }

  const video = pushRequiredRecord(errors, value, "video");
  if (video) {
    for (const key of ["fps", "width", "height", "fileSizeBytes"] as const) {
      if (!isFiniteNumber(video[key]) || (video[key] as number) < 0) {
        errors.push(`video.${key} must be a non-negative number`);
      }
    }
    if (typeof video.codec !== "string" || video.codec.length === 0) {
      errors.push("video.codec must be a non-empty string");
    }
  }

  const quality = pushRequiredRecord(errors, value, "quality");
  if (quality) {
    for (const key of [
      "averagePoseConfidence",
      "fullBodyVisibleRatio",
      "badFrames",
      "trackingLossCount",
      "poseFpsAverage",
    ] as const) {
      if (!isFiniteNumber(quality[key]) || (quality[key] as number) < 0) {
        errors.push(`quality.${key} must be a non-negative number`);
      }
    }
  }

  pushRequiredRecord(errors, value, "camera");
  pushRequiredRecord(errors, value, "sync");
  pushRequiredRecord(errors, value, "app");

  return { ok: errors.length === 0, errors };
}
