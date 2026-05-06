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
  captureMode?: CaptureModeV1;
  multiCameraSessionId?: string;
  approxCameraAngle?: number;
  calibrationClipId?: string;
  orientation?: CaptureVideoOrientation;
  isMirrored?: boolean;
  camera?: Partial<CaptureCameraMetadata>;
  quality: CaptureQualityMetadata;
  sync?: Partial<CaptureSyncMetadata>;
  appVersion: string;
  buildNumber?: string | null;
}>;

export function buildCaptureMetadata(input: BuildCaptureMetadataInput): CaptureMetadata {
  return {
    schema: CAPTURE_METADATA_SCHEMA,
    takeId: input.recording.takeId,
    captureSessionId: input.captureSessionId,
    deviceId: input.deviceId,
    deviceRole: input.deviceRole ?? "primary",
    deviceIndex: input.deviceIndex ?? 0,
    captureMode: input.captureMode ?? "solo",
    multiCameraSessionId: input.multiCameraSessionId,
    approxCameraAngle: input.approxCameraAngle,
    calibrationClipId: input.calibrationClipId,
    recordingStartedAt: input.recording.startedAt,
    recordingEndedAt: input.recording.endedAt,
    durationMs: input.recording.durationMs,
    video: {
      fps: input.recording.fps,
      width: input.recording.width,
      height: input.recording.height,
      codec: input.recording.codec,
      orientation: input.orientation ?? "portrait",
      isMirrored: input.isMirrored ?? false,
      fileSizeBytes: input.recording.fileSizeBytes,
      localUri: input.recording.localUri,
    },
    camera: {
      position: input.camera?.position ?? "back",
      focalLengthMm: input.camera?.focalLengthMm ?? null,
      intrinsics: input.camera?.intrinsics ?? null,
      lensModel: input.camera?.lensModel ?? "wide",
    },
    quality: input.quality,
    sync: {
      syncMethod: input.sync?.syncMethod ?? "single_device_clock",
      clockOffsetMs: input.sync?.clockOffsetMs ?? 0,
      audioSyncMarker: input.sync?.audioSyncMarker ?? null,
    },
    app: {
      version: input.appVersion,
      platform: input.recording.platform,
      buildNumber: input.buildNumber ?? null,
    },
  };
}
