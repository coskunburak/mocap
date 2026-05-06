import { useCallback, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { validateCaptureMetadata } from "../../../domain/mocap/models/CaptureMetadata";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import type { MultiViewPoseFrame } from "../../../domain/mocap/models/MultiViewPoseFrame";
import type { Take, TakeCalibration } from "../../../domain/mocap/models/Take";
import { analyzeTakeReview } from "../../../domain/mocap/pipeline/review/TakeReviewAnalyzer";
import { readTakeFrames } from "../../../infra/persistence/takeRepoFs.reader";
import { captureFlags } from "../config/captureFlags";
import { NativeCameraEngine } from "../data/NativeCameraEngine";
import { buildCaptureMetadata } from "../domain/CaptureMetadataBuilder";
import {
  createCaptureQualityAccumulator,
  finalizeCaptureQuality,
  observeCaptureQualityFrame,
} from "../domain/CaptureQuality";
import type { CaptureQualityAccumulator } from "../domain/CaptureQuality";

type TakeRepo = typeof import("../../../infra/persistence/TakeRepo.fs").takeRepoFs;

let takeRepo: TakeRepo;
try {
  takeRepo = require("../../../infra/persistence/TakeRepo.fs").takeRepoFs;
  // eslint-disable-next-line no-console
  console.log("[Entry] takeRepoFs loaded");
} catch (e) {
  // eslint-disable-next-line no-console
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
  chunkFrames?: number; // default 30
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
  chunkFrames: number;
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

function qualityScore(quality: ReturnType<typeof finalizeCaptureQuality>) {
  const weighted =
    quality.averagePoseConfidence * 0.45 + quality.fullBodyVisibleRatio * 0.55;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });

  // refs (no rerender per frame)
  const takeRef = useRef<Take | null>(null);
  const chunkNoRef = useRef(0);
  const bufferRef = useRef<(PoseFrame | MultiViewPoseFrame)[]>([]);
  const firstTsRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const captureSessionIdRef = useRef<string | null>(null);
  const qualityRef = useRef<CaptureQualityAccumulator>(
    createCaptureQualityAccumulator(),
  );

  // flush concurrency control
  const flushingRef = useRef(false);
  const flushAgainRef = useRef(false);

  const optsRef = useRef<NormalizedRecorderOptions>({
    takeName: "Take",
    projectId: undefined,
    chunkFrames: 30,
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

  const updateCounters = useCallback(() => {
    setState((prev) => {
      if (prev.status === "recording" || prev.status === "stopping") {
        return {
          ...prev,
          buffered: bufferRef.current.length,
          flushedChunks: chunkNoRef.current,
        };
      }
      return prev;
    });
  }, []);

  /**
   * Drain buffer to storage.
   * Guarantees: if called while flushing, it schedules a follow-up flush.
   */
  const flush = useCallback(async () => {
    if (flushingRef.current) {
      flushAgainRef.current = true;
      return;
    }

    const take = takeRef.current;
    if (!take) return;

    const hasAnything = bufferRef.current.length > 0;
    if (!hasAnything) return;

    flushingRef.current = true;
    try {
      while (true) {
        const buffer = bufferRef.current;
        if (buffer.length === 0) break;

        // Keep frames in memory until persistence succeeds.
        const frames = buffer.slice(0, buffer.length);
        const chunkNo = chunkNoRef.current;

        // yield to UI (avoid blocking taps)
        await new Promise<void>((r) => setTimeout(r, 0));

        // Persist before mutating in-memory state so failed writes do not lose frames.
        await takeRepo.appendFrames(take.id, chunkNo, frames);
        buffer.splice(0, frames.length);
        chunkNoRef.current = chunkNo + 1;

        updateCounters();

        // If someone requested another flush while we were flushing, loop again
        if (flushAgainRef.current) {
          flushAgainRef.current = false;
          continue;
        }

        // if buffer got new frames during await, loop will continue anyway
      }
    } finally {
      flushingRef.current = false;
      flushAgainRef.current = false;
    }
  }, [updateCounters]);

  const queueFlush = useCallback(() => {
    void flush().catch((error) => {
      console.error("[Recorder] chunk flush failed", error);
    });
  }, [flush]);

  const startRecording = useCallback(
    async (options?: RecorderOptions) => {
      if (state.status !== "idle") return;

      optsRef.current = {
        takeName: options?.takeName ?? "Take",
        projectId: options?.projectId,
        chunkFrames: options?.chunkFrames ?? 30,
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

      // ✅ create take async
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
      chunkNoRef.current = 0;
      bufferRef.current = [];
      firstTsRef.current = null;
      lastTsRef.current = null;
      captureSessionIdRef.current = captureSessionId;
      qualityRef.current = createCaptureQualityAccumulator();

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
    [state.status]
  );

  const pushFrame = useCallback(
    (frame: PoseFrame | MultiViewPoseFrame) => {
      if (state.status !== "recording") return;
      if (!captureFlags.localFrameRecording) return;

      const take = takeRef.current;
      if (!take) return;

      bufferRef.current.push(frame);

      if (firstTsRef.current == null) firstTsRef.current = frame.ts;
      lastTsRef.current = frame.ts;

      // update UI counters occasionally
      if (bufferRef.current.length % 10 === 0) {
        updateCounters();
      }

      // chunk trigger
      if (bufferRef.current.length >= optsRef.current.chunkFrames) {
        queueFlush();
      }
    },
    [queueFlush, state.status, updateCounters]
  );

  const recordQualityFrame = useCallback(
    (frame: PoseFrame, poseFps: number, threshold: number) => {
      if (state.status !== "recording") return;
      observeCaptureQualityFrame(qualityRef.current, frame, poseFps, threshold);
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
      const quality = finalizeCaptureQuality(qualityRef.current);
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

      if (captureFlags.localFrameRecording) {
        await flush();

        const first = firstTsRef.current ?? 0;
        const last = lastTsRef.current ?? first;

        const finalized = await takeRepo.finalizeTake(take.id, first, last);
        const persistedFrames = await readTakeFrames(take.id);
        const inferredTrackingProfile =
          finalized.trackingProfile ?? persistedFrames[0]?.trackingProfile;
        const analysis =
          persistedFrames.length > 0 ? analyzeTakeReview(finalized, persistedFrames) : null;

        enriched = await takeRepo.updateTakeMeta(take.id, {
          calibration: analysis?.calibration ?? finalized.calibration,
          postProcess: analysis?.cleanup ?? finalized.postProcess,
          retarget: analysis?.retarget ?? finalized.retarget,
          review: analysis?.recommendedReview ?? finalized.review,
          motion: analysis?.motion ?? finalized.motion,
          qualityScore: analysis?.qualityScore ?? qualityScore(quality),
          trackingProfile: inferredTrackingProfile,
          video,
          captureMetadata: metadata,
        });
      } else {
        enriched = await takeRepo.updateTakeMeta(take.id, {
          durationMs: recording.durationMs,
          avgFps: recording.fps,
          qualityScore: qualityScore(quality),
          video,
          captureMetadata: metadata,
        });
      }
    } catch (error) {
      setState({
        status: "recording",
        take,
        buffered: bufferRef.current.length,
        flushedChunks: chunkNoRef.current,
      });
      throw error;
    }

    // reset
    takeRef.current = null;
    bufferRef.current = [];
    chunkNoRef.current = 0;
    firstTsRef.current = null;
    lastTsRef.current = null;
    captureSessionIdRef.current = null;
    qualityRef.current = createCaptureQualityAccumulator();

    setState({ status: "idle" });

    return enriched;
  }, [flush, state.status]);

  const currentTake = useMemo(() => {
    if (state.status === "recording" || state.status === "stopping") return state.take;
    return undefined;
  }, [state]);

  return {
    state,
    currentTake,
    startRecording,
    stopRecording,
    pushFrame,
    recordQualityFrame,
    flush,
  };
}
