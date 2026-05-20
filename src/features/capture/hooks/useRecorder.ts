import { useCallback, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { validateCaptureMetadata } from "../../../domain/mocap/models/CaptureMetadata";
import type { CaptureQualityMetadata } from "../../../domain/mocap/models/CaptureMetadata";
import type { Take, TakeCalibration } from "../../../domain/mocap/models/Take";
import { NativeCameraEngine } from "../data/NativeCameraEngine";
import { buildCaptureMetadata } from "../domain/CaptureMetadataBuilder";

type TakeRepo = typeof import("../../../infra/persistence/TakeRepo.fs").takeRepoFs;

let takeRepo: TakeRepo;
try {
  takeRepo = require("../../../infra/persistence/TakeRepo.fs").takeRepoFs;
  console.log("[Entry] takeRepoFs loaded");
} catch (e) {
  console.error("[Entry] takeRepoFs failed to load", e);
  throw e;
}

type RecorderState =
  | { status: "idle" }
  | { status: "recording"; take: Take; buffered: number; flushedChunks: number }
  | { status: "stopping"; take: Take; buffered: number; flushedChunks: number };

type RecorderOptions = {
  takeName?: string;
  projectId?: string;
  chunkFrames?: number;
  trackingProfile?: "pose" | "holistic";
  calibration?: TakeCalibration;
  captureMode?: "solo" | "dual-camera" | "pro-4-camera";
  viewCount?: number;
  deviceId?: string;
  deviceRole?: "primary" | "secondary" | "front" | "back" | "left" | "right" | "calibration";
  deviceIndex?: number;
  captureSessionId?: string;
  clockOffsetMs?: number | null;
  multiCameraSessionId?: string;
  approxCameraAngle?: number;
  calibrationClipId?: string;
};

type NormalizedRecorderOptions = {
  takeName: string;
  projectId?: string;
  trackingProfile?: "pose" | "holistic";
  calibration?: TakeCalibration;
  captureMode: "solo" | "dual-camera" | "pro-4-camera";
  viewCount: number;
  deviceId?: string;
  deviceRole: "primary" | "secondary" | "front" | "back" | "left" | "right" | "calibration";
  deviceIndex: number;
  captureSessionId?: string;
  clockOffsetMs?: number | null;
  multiCameraSessionId?: string;
  approxCameraAngle?: number;
  calibrationClipId?: string;
};

function createCaptureSessionId(takeId: string) {
  return `cap_${takeId}`;
}

function localDeviceId() {
  return `${Platform.OS}_local_device`;
}

function defaultVideoQuality(recordingFps: number): CaptureQualityMetadata {
  return {
    averagePoseConfidence: 1,
    fullBodyVisibleRatio: 1,
    badFrames: 0,
    trackingLossCount: 0,
    poseFpsAverage: recordingFps,
  };
}

function qualityScore(quality: CaptureQualityMetadata) {
  const weighted =
    quality.averagePoseConfidence * 0.45 + quality.fullBodyVisibleRatio * 0.55;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const takeRef = useRef<Take | null>(null);
  const captureSessionIdRef = useRef<string | null>(null);
  const optsRef = useRef<NormalizedRecorderOptions>({
    takeName: "Take",
    projectId: undefined,
    trackingProfile: undefined,
    calibration: undefined,
    captureMode: "solo",
    viewCount: 1,
    deviceId: undefined,
    deviceRole: "primary",
    deviceIndex: 0,
    captureSessionId: undefined,
    clockOffsetMs: 0,
    multiCameraSessionId: undefined,
    approxCameraAngle: undefined,
    calibrationClipId: undefined,
  });

  const flush = useCallback(async () => undefined, []);

  const startRecording = useCallback(
    async (options?: RecorderOptions) => {
      if (state.status !== "idle") return;

      optsRef.current = {
        takeName: options?.takeName ?? "Take",
        projectId: options?.projectId,
        trackingProfile: options?.trackingProfile,
        calibration: options?.calibration,
        captureMode: options?.captureMode ?? "solo",
        viewCount: options?.viewCount ?? 1,
        deviceId: options?.deviceId,
        deviceRole: options?.deviceRole ?? "primary",
        deviceIndex: options?.deviceIndex ?? 0,
        captureSessionId: options?.captureSessionId,
        clockOffsetMs: options?.clockOffsetMs ?? 0,
        multiCameraSessionId: options?.multiCameraSessionId,
        approxCameraAngle: options?.approxCameraAngle,
        calibrationClipId: options?.calibrationClipId,
      };

      const take = await takeRepo.createTake(
        optsRef.current.takeName,
        optsRef.current.projectId,
        {
          trackingProfile: optsRef.current.trackingProfile,
          calibration: optsRef.current.calibration,
          qualityScore: optsRef.current.calibration
            ? Math.round(optsRef.current.calibration.readinessScore * 100)
            : undefined,
          captureMode: optsRef.current.captureMode,
          viewCount: optsRef.current.viewCount,
        },
      );

      const captureSessionId =
        optsRef.current.captureSessionId ?? createCaptureSessionId(take.id);
      takeRef.current = take;
      captureSessionIdRef.current = captureSessionId;

      try {
        await NativeCameraEngine.startVideoRecording({
          takeId: take.id,
          fps: 30,
          cameraPosition: "back",
          orientation: "portrait",
        });
      } catch (error) {
        takeRef.current = null;
        captureSessionIdRef.current = null;
        await takeRepo.deleteTake(take.id);
        throw error;
      }

      setState({ status: "recording", take, buffered: 0, flushedChunks: 0 });
    },
    [state.status],
  );

  const stopRecording = useCallback(async () => {
    if (state.status !== "recording") return;

    const take = takeRef.current;
    if (!take) return;
    const captureSessionId = captureSessionIdRef.current ?? createCaptureSessionId(take.id);

    setState((prev) => {
      if (prev.status === "recording") return { ...prev, status: "stopping" as const };
      return prev;
    });

    let enriched: Take;
    try {
      const recording = await NativeCameraEngine.stopVideoRecording();
      const quality = defaultVideoQuality(recording.fps);
      const metadata = buildCaptureMetadata({
        recording,
        captureSessionId,
        deviceId: optsRef.current.deviceId ?? localDeviceId(),
        deviceRole: optsRef.current.deviceRole,
        deviceIndex: optsRef.current.deviceIndex,
        captureMode:
          optsRef.current.captureMode === "pro-4-camera"
            ? "pro_4_camera"
            : optsRef.current.captureMode === "dual-camera"
              ? "dual"
              : "solo",
        multiCameraSessionId: optsRef.current.multiCameraSessionId,
        approxCameraAngle: optsRef.current.approxCameraAngle,
        calibrationClipId: optsRef.current.calibrationClipId,
        quality,
        sync: {
          syncMethod:
            optsRef.current.captureMode === "dual-camera" ||
            optsRef.current.captureMode === "pro-4-camera"
              ? "network_time_sync"
              : "single_device_clock",
          clockOffsetMs: optsRef.current.clockOffsetMs ?? 0,
        },
        appVersion: "1.0.0",
        buildNumber: "1",
      });
      const validation = validateCaptureMetadata(metadata);
      if (!validation.ok) {
        throw new Error(`Capture metadata invalid: ${validation.errors.join(", ")}`);
      }

      const video = {
        localUri: recording.localUri,
        durationMs: recording.durationMs,
        fps: recording.fps,
        width: recording.width,
        height: recording.height,
        fileSizeBytes: recording.fileSizeBytes,
        codec: recording.codec,
        container: recording.container,
        recordedAt: Date.parse(recording.endedAt) || Date.now(),
      };

      enriched = await takeRepo.updateTakeMeta(take.id, {
        durationMs: recording.durationMs,
        avgFps: recording.fps,
        qualityScore: qualityScore(quality),
        video,
        captureMetadata: metadata,
      });
    } catch (error) {
      setState({ status: "recording", take, buffered: 0, flushedChunks: 0 });
      throw error;
    }

    takeRef.current = null;
    captureSessionIdRef.current = null;
    setState({ status: "idle" });

    return enriched;
  }, [state.status]);

  const currentTake = useMemo(() => {
    if (state.status === "recording" || state.status === "stopping") return state.take;
    return undefined;
  }, [state]);

  return {
    state,
    currentTake,
    startRecording,
    stopRecording,
    pushFrame: useCallback(() => undefined, []),
    recordQualityFrame: useCallback(() => undefined, []),
    flush,
  };
}
