import { useCallback, useEffect, useRef } from "react";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";

let PoseEngine: typeof import("../../../domain/mocap/pipeline/pose/PoseEngine.native").PoseEngine;
try {
  PoseEngine = require("../../../domain/mocap/pipeline/pose/PoseEngine.native").PoseEngine;
  // eslint-disable-next-line no-console
  console.log("[Entry] PoseEngine loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] PoseEngine failed to load", e);
  throw e;
}

let useCaptureStore: typeof import("../state/captureStore").useCaptureStore;
try {
  useCaptureStore = require("../state/captureStore").useCaptureStore;
  // eslint-disable-next-line no-console
  console.log("[Entry] useCaptureStore (hook) loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] useCaptureStore (hook) failed to load", e);
  throw e;
}

let PoseSmoother: typeof import("../../../domain/mocap/pipeline/filter/PoseSmoother").PoseSmoother;
try {
  PoseSmoother = require("../../../domain/mocap/pipeline/filter/PoseSmoother").PoseSmoother;
  // eslint-disable-next-line no-console
  console.log("[Entry] PoseSmoother loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] PoseSmoother failed to load", e);
  throw e;
}

let landmarkCount: typeof import("../../../domain/mocap/models/Landmark").landmarkCount;
try {
  landmarkCount = require("../../../domain/mocap/models/Landmark").landmarkCount;
  // eslint-disable-next-line no-console
  console.log("[Entry] landmarkCount loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] landmarkCount failed to load", e);
  throw e;
}

let useRecorder: typeof import("./useRecorder").useRecorder;
try {
  useRecorder = require("./useRecorder").useRecorder;
  // eslint-disable-next-line no-console
  console.log("[Entry] useRecorder loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] useRecorder failed to load", e);
  throw e;
}

function nowMs() {
  return Date.now();
}

type StartCaptureOptions = {
  model?: "lite" | "full";
  targetFps?: number;
};

type StartRecordingOptions = {
  takeName?: string;
  projectId?: string;
  chunkFrames?: number;
};

export function usePoseStream(onFrame?: (frame: PoseFrame) => void) {
  const {
    setStatus,
    setError,
    setFrame,
    status,
    smoothingEnabled,
    jointThreshold,
  } = useCaptureStore();

  const recorder = useRecorder();

  const lastTsRef = useRef<number | null>(null);
  const subCleanupRef = useRef<null | (() => void)>(null);
  const smootherRef = useRef<PoseSmoother | null>(null);

  const isRecordingRef = useRef(false);
  isRecordingRef.current = recorder.state.status === "recording";

  const ping = useCallback(async () => {
    try {
      return await PoseEngine.ping();
    } catch (e: any) {
      setError(e?.message ?? "Ping failed");
      throw e;
    }
  }, [setError]);

  const handleIncomingFrame = useCallback(
    (frame: PoseFrame) => {
      const ts = frame.ts ?? nowMs();

      const prev = lastTsRef.current;
      const dt = prev ? Math.max(1, ts - prev) : 0;
      const poseFps = dt ? 1000 / dt : 0;
      lastTsRef.current = ts;

      if (!smootherRef.current) {
        const n = landmarkCount(frame.landmarks);
        smootherRef.current = new PoseSmoother(n, { confidenceGate: jointThreshold });
      }

      const landmarks =
        smoothingEnabled && smootherRef.current
          ? smootherRef.current.filter(frame.landmarks, ts)
          : frame.landmarks;

      const next: PoseFrame = { ...frame, ts, landmarks };

      setFrame(next, poseFps);

      if (isRecordingRef.current) {
        recorder.pushFrame(next);
      }

      onFrame?.(next);
    },
    [jointThreshold, onFrame, recorder, setFrame, smoothingEnabled]
  );

  const startCapture = useCallback(
    async (opts?: StartCaptureOptions) => {
      if (status === "capturing" || status === "starting") return;

      setError(undefined);
      setStatus("starting");

      try {
        subCleanupRef.current?.();
        subCleanupRef.current = PoseEngine.addListener(handleIncomingFrame);

        await PoseEngine.start({
          model: opts?.model ?? "lite",
          minConfidence: jointThreshold,
          minPoseConfidence: jointThreshold,
          targetFps: opts?.targetFps ?? 30,
          runningMode: "stream",
        });

        setStatus("capturing");
      } catch (e: any) {
        subCleanupRef.current?.();
        subCleanupRef.current = null;

        smootherRef.current = null;
        lastTsRef.current = null;

        setStatus("error");
        setError(e?.message ?? "Start failed");
      }
    },
    [handleIncomingFrame, jointThreshold, setError, setStatus, status]
  );

  const stopCapture = useCallback(async () => {
    if (status !== "capturing") return;

    setStatus("stopping");
    try {
      if (recorder.state.status === "recording") {
        await recorder.stopRecording();
      }
      await PoseEngine.stop();
    } finally {
      subCleanupRef.current?.();
      subCleanupRef.current = null;

      smootherRef.current = null;
      lastTsRef.current = null;

      setStatus("idle");
    }
  }, [recorder, setStatus, status]);

  const startRecording = useCallback(
    (opts?: StartRecordingOptions) => {
      if (status !== "capturing") {
        setError("Start capture before recording.");
        return;
      }
      if (recorder.state.status !== "idle") return;

      recorder.startRecording({
        takeName: opts?.takeName ?? `Take ${new Date().toLocaleTimeString()}`,
        projectId: opts?.projectId,
        chunkFrames: opts?.chunkFrames ?? 30,
      });
    },
    [recorder, setError, status]
  );

  const stopRecording = useCallback(async () => {
    if (recorder.state.status !== "recording") return;
    return await recorder.stopRecording();
  }, [recorder]);

  useEffect(() => {
    return () => {
      subCleanupRef.current?.();
    };
  }, []);

  return {
    ping,
    startCapture,
    stopCapture,
    recorderState: recorder.state,
    currentTake: recorder.currentTake,
    startRecording,
    stopRecording,
  };
}
