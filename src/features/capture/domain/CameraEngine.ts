import type {
  CaptureCameraPosition,
  CaptureDevicePlatform,
  CaptureVideoOrientation,
} from "../../../domain/mocap/models/CaptureMetadata";

export type CameraRecordingState =
  | "idle"
  | "preparing"
  | "recording"
  | "stopping"
  | "failed";

export type StartVideoRecordingOptions = Readonly<{
  takeId: string;
  fps?: number;
  cameraPosition?: CaptureCameraPosition;
  orientation?: CaptureVideoOrientation;
}>;

export type VideoRecordingResult = Readonly<{
  takeId: string;
  localUri: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  recordingStartWallClockMs?: number;
  recordingStartMonotonicMs?: number;
  firstFrameTimestampMs?: number;
  framePresentationTimestampsMs?: readonly number[];
  frameCount?: number;
  hasAudioTrack?: boolean;
  audioSampleRate?: number;
  fileSizeBytes: number;
  codec: string;
  container: "mov" | "mp4";
  platform: CaptureDevicePlatform;
  cameraPosition: CaptureCameraPosition;
  orientation: CaptureVideoOrientation;
}>;

export interface CameraEngine {
  startPreview(): Promise<void>;
  stopPreview(): Promise<void>;
  startVideoRecording(options: StartVideoRecordingOptions): Promise<void>;
  stopVideoRecording(): Promise<VideoRecordingResult>;
}
