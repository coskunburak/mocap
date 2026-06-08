import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { PoseFrame, TrackingProfile } from "../../../domain/mocap/models/PoseFrame";
import type {
  CaptureCameraPosition,
  CaptureVideoOrientation,
} from "../../../domain/mocap/models/CaptureMetadata";
import type {
  CameraEngine,
  StartVideoRecordingOptions,
  VideoRecordingResult,
} from "../domain/CameraEngine";

const MODULE_NAME = "PoseEngineModule";
const FRAME_EVENT_NAME = "PoseEngineFrame";
const NativePoseEngine = NativeModules[MODULE_NAME];

function assertAvailable() {
  if (!NativePoseEngine) {
    throw new Error(`[CameraEngine] Native module '${MODULE_NAME}' not found.`);
  }
}

function assertMethod(name: "setPreviewActive" | "startVideoRecording" | "stopVideoRecording") {
  assertAvailable();
  if (typeof NativePoseEngine[name] !== "function") {
    throw new Error(`[CameraEngine] Native method '${name}' is not available. Rebuild the native app.`);
  }
}

function normalizeCameraPosition(value: unknown): CaptureCameraPosition {
  return value === "front" || value === "back" || value === "external" || value === "unknown"
    ? value
    : "back";
}

function normalizeOrientation(value: unknown): CaptureVideoOrientation {
  return value === "portrait" ||
    value === "portrait_upside_down" ||
    value === "landscape_left" ||
    value === "landscape_right" ||
    value === "unknown"
    ? value
    : "portrait";
}

function assertRecordingResult(value: any): VideoRecordingResult {
  if (!value || typeof value !== "object") {
    throw new Error("[CameraEngine] Native recording result is missing.");
  }

  const requiredStrings = ["takeId", "localUri", "startedAt", "endedAt", "codec"];
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`[CameraEngine] Native recording result missing '${key}'.`);
    }
  }

  for (const key of ["durationMs", "fps", "width", "height", "fileSizeBytes"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      throw new Error(`[CameraEngine] Native recording result missing '${key}'.`);
    }
  }

  if (value.fileSizeBytes <= 0) {
    throw new Error("[CameraEngine] Recorded video is empty.");
  }

  const optionalNumber = (key: string) =>
    typeof value[key] === "number" && Number.isFinite(value[key])
      ? value[key]
      : undefined;
  const framePresentationTimestampsMs = Array.isArray(value.framePresentationTimestampsMs)
    ? value.framePresentationTimestampsMs.filter(
        (timestamp: unknown): timestamp is number =>
          typeof timestamp === "number" && Number.isFinite(timestamp),
      )
    : undefined;

  return {
    takeId: value.takeId,
    localUri: value.localUri,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationMs: value.durationMs,
    fps: value.fps,
    width: value.width,
    height: value.height,
    recordingStartWallClockMs: optionalNumber("recordingStartWallClockMs"),
    recordingStartMonotonicMs: optionalNumber("recordingStartMonotonicMs"),
    firstFrameTimestampMs: optionalNumber("firstFrameTimestampMs"),
    framePresentationTimestampsMs:
      framePresentationTimestampsMs && framePresentationTimestampsMs.length > 0
        ? framePresentationTimestampsMs
        : undefined,
    frameCount:
      Number.isInteger(value.frameCount) && value.frameCount >= 0
        ? value.frameCount
        : undefined,
    hasAudioTrack:
      typeof value.hasAudioTrack === "boolean" ? value.hasAudioTrack : undefined,
    audioSampleRate: optionalNumber("audioSampleRate"),
    fileSizeBytes: value.fileSizeBytes,
    codec: value.codec,
    container: value.container === "mov" ? "mov" : "mp4",
    platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
    cameraPosition: normalizeCameraPosition(value.cameraPosition),
    orientation: normalizeOrientation(value.orientation),
  };
}

function normalizeTrackingProfile(value: unknown): TrackingProfile {
  return value === "holistic" ? "holistic" : "pose";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toFloat32Array(value: unknown): Float32Array | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out = new Float32Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    out[i] = typeof item === "number" && Number.isFinite(item) ? item : 0;
  }
  return out;
}

function normalizePoseFrameEvent(value: any): PoseFrame | null {
  if (!value || typeof value !== "object") return null;

  const landmarks = toFloat32Array(value.landmarks);
  if (!landmarks || landmarks.length < 4) return null;

  return {
    ts: finiteNumber(value.ts, Date.now()),
    landmarks,
    worldLandmarks: toFloat32Array(value.worldLandmarks),
    trackingProfile: normalizeTrackingProfile(value.trackingProfile),
    requestedTrackingProfile: normalizeTrackingProfile(value.requestedTrackingProfile),
    frameId:
      typeof value.frameId === "number" && Number.isInteger(value.frameId)
        ? value.frameId
        : undefined,
    sourceDevice: typeof value.sourceDevice === "string" ? value.sourceDevice : Platform.OS,
    coordinateSpace:
      value.coordinateSpace === "preview_normalized" ? "preview_normalized" : "image_normalized",
    imageWidth: finiteNumber(value.imageWidth, 0) > 0 ? finiteNumber(value.imageWidth, 0) : undefined,
    imageHeight:
      finiteNumber(value.imageHeight, 0) > 0 ? finiteNumber(value.imageHeight, 0) : undefined,
    inputImageWidth:
      finiteNumber(value.inputImageWidth, 0) > 0
        ? finiteNumber(value.inputImageWidth, 0)
        : undefined,
    inputImageHeight:
      finiteNumber(value.inputImageHeight, 0) > 0
        ? finiteNumber(value.inputImageHeight, 0)
        : undefined,
    videoOrientation: normalizeOrientation(value.videoOrientation),
    cameraPosition: normalizeCameraPosition(value.cameraPosition),
    isMirrored: typeof value.isMirrored === "boolean" ? value.isMirrored : false,
    orientationCorrection:
      typeof value.orientationCorrection === "string" ? value.orientationCorrection : undefined,
  };
}

export const NativeCameraEngine: CameraEngine = {
  async startPreview() {
    assertMethod("setPreviewActive");
    await NativePoseEngine.setPreviewActive(true);
  },

  async stopPreview() {
    assertMethod("setPreviewActive");
    await NativePoseEngine.setPreviewActive(false);
  },

  async startVideoRecording(options: StartVideoRecordingOptions) {
    assertMethod("startVideoRecording");
    if (typeof options.takeId !== "string" || options.takeId.length === 0) {
      throw new Error("[CameraEngine] takeId is required.");
    }

    await NativePoseEngine.startVideoRecording({
      takeId: options.takeId,
      fps: options.fps ?? 30,
      cameraPosition: options.cameraPosition ?? "back",
      orientation: options.orientation ?? "portrait",
    });
  },

  async stopVideoRecording() {
    assertMethod("stopVideoRecording");
    const result = await NativePoseEngine.stopVideoRecording();
    return assertRecordingResult(result);
  },

  subscribePoseFrames(listener: (frame: PoseFrame, fps: number) => void) {
    assertAvailable();
    const emitter = new NativeEventEmitter(NativePoseEngine);
    const subscription = emitter.addListener(FRAME_EVENT_NAME, (event) => {
      const frame = normalizePoseFrameEvent(event);
      if (!frame) return;
      listener(frame, finiteNumber(event?.fps, 0));
    });

    return () => subscription.remove();
  },
};
