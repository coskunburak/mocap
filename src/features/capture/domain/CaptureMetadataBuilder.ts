import type {
  CaptureCameraMetadata,
  CaptureDeviceRole,
  CaptureMetadata,
  CaptureModeV1,
  CaptureQualityMetadata,
  CaptureSyncMetadata,
  CaptureVideoOrientation,
} from "../../../domain/mocap/models/CaptureMetadata";
import { CAPTURE_METADATA_SCHEMA } from "../../../domain/mocap/models/CaptureMetadata";
import type { VideoRecordingResult } from "./CameraEngine";

export type BuildCaptureMetadataInput = Readonly<{
  recording: VideoRecordingResult;
  captureSessionId: string;
  deviceId: string;
  deviceRole?: CaptureDeviceRole;
  deviceIndex?: number;
  cameraId?: string;
  cameraRole?: CaptureDeviceRole;
  captureMode?: CaptureModeV1;
  multiCameraSessionId?: string;
  approxCameraAngle?: number;
  calibrationClipId?: string;
  localClockTimeMs?: number;
  uploadOrder?: number;
  orientation?: CaptureVideoOrientation;
  isMirrored?: boolean;
  camera?: Partial<CaptureCameraMetadata>;
  quality: CaptureQualityMetadata;
  sync?: Partial<CaptureSyncMetadata>;
  appVersion: string;
  buildNumber?: string | null;
}>;

function parseTimestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildCaptureMetadata(input: BuildCaptureMetadataInput): CaptureMetadata {
  const recordingStartTimeMs = parseTimestampMs(input.recording.startedAt);
  const recordingEndTimeMs = parseTimestampMs(input.recording.endedAt);
  const recordingStartWallClockMs =
    input.recording.recordingStartWallClockMs ?? recordingStartTimeMs;
  const cameraPosition = input.camera?.position ?? input.recording.cameraPosition;
  const deviceRole = input.deviceRole ?? "primary";
  const hasAudioTrack = input.recording.hasAudioTrack;
  const audioSampleRate = input.recording.audioSampleRate;
  const framePresentationTimestampsMs =
    input.recording.framePresentationTimestampsMs;
  const firstFrameTimestampMs = input.recording.firstFrameTimestampMs;
  const frameCount = input.recording.frameCount;
  const networkClockOffsetMs =
    input.sync?.networkClockOffsetMs ?? input.sync?.clockOffsetMs;

  return {
    schema: CAPTURE_METADATA_SCHEMA,
    takeId: input.recording.takeId,
    captureSessionId: input.captureSessionId,
    deviceId: input.deviceId,
    deviceRole,
    deviceIndex: input.deviceIndex ?? 0,
    cameraId: input.cameraId ?? `${input.deviceId}_${cameraPosition}`,
    cameraRole: input.cameraRole ?? deviceRole,
    captureMode: input.captureMode ?? "solo",
    multiCameraSessionId: input.multiCameraSessionId,
    approxCameraAngle: input.approxCameraAngle,
    calibrationClipId: input.calibrationClipId,
    recordingStartedAt: input.recording.startedAt,
    recordingEndedAt: input.recording.endedAt,
    recordingStartTimeMs,
    recordingEndTimeMs,
    recordingStartWallClockMs,
    recordingStartMonotonicMs: input.recording.recordingStartMonotonicMs,
    firstFrameTimestampMs,
    framePresentationTimestampsMs,
    frameCount,
    localClockTimeMs: input.localClockTimeMs ?? recordingStartTimeMs,
    networkClockOffsetMs,
    manualOffsetMs: input.sync?.manualOffsetMs,
    hasAudioTrack,
    audioSampleRate,
    uploadOrder: input.uploadOrder,
    durationMs: input.recording.durationMs,
    fps: input.recording.fps,
    width: input.recording.width,
    height: input.recording.height,
    resolution: {
      width: input.recording.width,
      height: input.recording.height,
    },
    cameraIntrinsics: input.camera?.cameraIntrinsics ?? input.camera?.intrinsics ?? null,
    intrinsicMatrixK: input.camera?.intrinsicMatrixK ?? null,
    lensDistortion: input.camera?.lensDistortion ?? null,
    focalLength: input.camera?.focalLength ?? input.camera?.focalLengthMm ?? null,
    sensorSize: input.camera?.sensorSize ?? null,
    approximateCameraAngle: input.approxCameraAngle,
    video: {
      fps: input.recording.fps,
      width: input.recording.width,
      height: input.recording.height,
      durationMs: input.recording.durationMs,
      resolution: {
        width: input.recording.width,
        height: input.recording.height,
      },
      firstFrameTimestampMs,
      framePresentationTimestampsMs,
      frameCount,
      hasAudioTrack,
      audioSampleRate,
      codec: input.recording.codec,
      orientation: input.orientation ?? input.recording.orientation,
      isMirrored: input.isMirrored ?? false,
      fileSizeBytes: input.recording.fileSizeBytes,
      localUri: input.recording.localUri,
    },
    camera: {
      position: cameraPosition,
      focalLengthMm: input.camera?.focalLengthMm ?? null,
      focalLength: input.camera?.focalLength ?? input.camera?.focalLengthMm ?? null,
      intrinsics: input.camera?.intrinsics ?? null,
      cameraIntrinsics: input.camera?.cameraIntrinsics ?? input.camera?.intrinsics ?? null,
      intrinsicMatrixK: input.camera?.intrinsicMatrixK ?? null,
      lensDistortion: input.camera?.lensDistortion ?? null,
      sensorSize: input.camera?.sensorSize ?? null,
      lensModel: input.camera?.lensModel ?? "wide",
    },
    quality: input.quality,
    sync: {
      syncMethod: input.sync?.syncMethod ?? "single_device_clock",
      clockOffsetMs: input.sync?.clockOffsetMs ?? 0,
      networkClockOffsetMs,
      localClockTimeMs: input.sync?.localClockTimeMs ?? input.localClockTimeMs ?? recordingStartTimeMs,
      manualOffsetMs: input.sync?.manualOffsetMs,
      audioSyncMarker: input.sync?.audioSyncMarker ?? null,
    },
    app: {
      version: input.appVersion,
      platform: input.recording.platform,
      buildNumber: input.buildNumber ?? null,
    },
  };
}
