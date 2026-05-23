import { NativeModules, Platform } from "react-native";
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

  return {
    takeId: value.takeId,
    localUri: value.localUri,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationMs: value.durationMs,
    fps: value.fps,
    width: value.width,
    height: value.height,
    fileSizeBytes: value.fileSizeBytes,
    codec: value.codec,
    container: value.container === "mov" ? "mov" : "mp4",
    platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
    cameraPosition: normalizeCameraPosition(value.cameraPosition),
    orientation: normalizeOrientation(value.orientation),
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
};
