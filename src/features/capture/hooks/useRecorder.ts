import { useCallback, useMemo, useRef, useState } from "react";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import type { MultiViewPoseFrame } from "../../../domain/mocap/models/MultiViewPoseFrame";
import type { Take, TakeCalibration } from "../../../domain/mocap/models/Take";
import { analyzeTakeReview } from "../../../domain/mocap/pipeline/review/TakeReviewAnalyzer";
import { readTakeFrames } from "../../../infra/persistence/takeRepoFs.reader";

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
};

type NormalizedRecorderOptions = {
  takeName: string;
  projectId?: string;
  chunkFrames: number;
  trackingProfile?: "pose" | "holistic";
  calibration?: TakeCalibration;
};

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });

  // refs (no rerender per frame)
  const takeRef = useRef<Take | null>(null);
  const chunkNoRef = useRef(0);
  const bufferRef = useRef<(PoseFrame | MultiViewPoseFrame)[]>([]);
  const firstTsRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // flush concurrency control
  const flushingRef = useRef(false);
  const flushAgainRef = useRef(false);

  const optsRef = useRef<NormalizedRecorderOptions>({
    takeName: "Take",
    projectId: undefined,
    chunkFrames: 30,
    trackingProfile: undefined,
    calibration: undefined,
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
        },
      );

      takeRef.current = take;
      chunkNoRef.current = 0;
      bufferRef.current = [];
      firstTsRef.current = null;
      lastTsRef.current = null;

      setState({ status: "recording", take, buffered: 0, flushedChunks: 0 });
    },
    [state.status]
  );

  const pushFrame = useCallback(
    (frame: PoseFrame | MultiViewPoseFrame) => {
      if (state.status !== "recording") return;

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

  const stopRecording = useCallback(async () => {
    if (state.status !== "recording") return;

    const take = takeRef.current;
    if (!take) return;

    setState((prev) => {
      if (prev.status === "recording") return { ...prev, status: "stopping" as const };
      return prev;
    });

    let enriched: Take;
    try {
      await flush();

      const first = firstTsRef.current ?? 0;
      const last = lastTsRef.current ?? first;

      const finalized = await takeRepo.finalizeTake(take.id, first, last);
      const persistedFrames = await readTakeFrames(take.id);
      const inferredTrackingProfile =
        finalized.trackingProfile ?? persistedFrames[0]?.trackingProfile;
      const analysis =
        persistedFrames.length > 0 ? analyzeTakeReview(finalized, persistedFrames) : null;

      enriched =
        analysis || inferredTrackingProfile !== finalized.trackingProfile
          ? await takeRepo.updateTakeMeta(take.id, {
              calibration: analysis?.calibration ?? finalized.calibration,
              postProcess: analysis?.cleanup ?? finalized.postProcess,
              retarget: analysis?.retarget ?? finalized.retarget,
              review: analysis?.recommendedReview ?? finalized.review,
              motion: analysis?.motion ?? finalized.motion,
              qualityScore: analysis?.qualityScore ?? finalized.qualityScore,
              trackingProfile: inferredTrackingProfile,
            })
          : finalized;
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
    flush,
  };
}
