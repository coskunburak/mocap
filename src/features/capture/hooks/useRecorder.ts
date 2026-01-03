import { useCallback, useMemo, useRef, useState } from "react";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import type { Take } from "../../../domain/mocap/models/Take";

let takeRepo: typeof import("../../../infra/persistence/takeRepo").takeRepo;
try {
  takeRepo = require("../../../infra/persistence/takeRepo").takeRepo;
  // eslint-disable-next-line no-console
  console.log("[Entry] takeRepo loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] takeRepo failed to load", e);
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
};

type NormalizedRecorderOptions = {
  takeName: string;
  projectId?: string;
  chunkFrames: number;
};

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });

  // refs to avoid rerenders per frame
  const takeRef = useRef<Take | null>(null);
  const chunkNoRef = useRef(0);
  const bufferRef = useRef<PoseFrame[]>([]);
  const firstTsRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const flushingRef = useRef(false);

  const optsRef = useRef<NormalizedRecorderOptions>({
    takeName: "Take",
    projectId: undefined,
    chunkFrames: 30,
  });

  const flush = useCallback(async () => {
    if (flushingRef.current) return;

    const take = takeRef.current;
    if (!take) return;

    const buffer = bufferRef.current;
    if (buffer.length === 0) return;

    flushingRef.current = true;

    // move frames out quickly
    const frames = buffer.splice(0, buffer.length);
    const chunkNo = chunkNoRef.current;

    // yield to UI so we don't block taps
    await new Promise<void>((r) => setTimeout(r, 0));

    takeRepo.appendFrames(take.id, chunkNo, frames);
    chunkNoRef.current = chunkNo + 1;

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

    flushingRef.current = false;
  }, []);

  const startRecording = useCallback(
    (options?: RecorderOptions) => {
      if (state.status !== "idle") return;

      optsRef.current = {
        takeName: options?.takeName ?? "Take",
        projectId: options?.projectId, // <-- optional (fixed)
        chunkFrames: options?.chunkFrames ?? 30,
      };

      const take = takeRepo.createTake(optsRef.current.takeName, optsRef.current.projectId);

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
    (frame: PoseFrame) => {
      if (state.status !== "recording") return;

      const take = takeRef.current;
      if (!take) return;

      bufferRef.current.push(frame);

      if (firstTsRef.current == null) firstTsRef.current = frame.ts;
      lastTsRef.current = frame.ts;

      // update counters occasionally (avoid rerender on every frame)
      if (bufferRef.current.length % 10 === 0) {
        setState((prev) => {
          if (prev.status !== "recording") return prev;
          return {
            ...prev,
            buffered: bufferRef.current.length,
            flushedChunks: chunkNoRef.current,
          };
        });
      }

      if (bufferRef.current.length >= optsRef.current.chunkFrames) {
        void flush();
      }
    },
    [flush, state.status]
  );

  const stopRecording = useCallback(async () => {
    if (state.status !== "recording") return;

    const take = takeRef.current;
    if (!take) return;

    setState((prev) => {
      if (prev.status === "recording") return { ...prev, status: "stopping" as const };
      return prev;
    });

    await flush();

    const first = firstTsRef.current ?? 0;
    const last = lastTsRef.current ?? first;

    const finalized = takeRepo.finalizeTake(take.id, first, last);

    // reset
    takeRef.current = null;
    bufferRef.current = [];
    chunkNoRef.current = 0;
    firstTsRef.current = null;
    lastTsRef.current = null;

    setState({ status: "idle" });
    return finalized;
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
