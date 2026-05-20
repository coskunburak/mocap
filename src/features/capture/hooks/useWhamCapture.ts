import { useCallback } from "react";

let useCaptureStore: typeof import("../state/captureStore").useCaptureStore;
try {
  useCaptureStore = require("../state/captureStore").useCaptureStore;
  console.log("[Entry] useCaptureStore loaded");
} catch (e) {
  console.error("[Entry] useCaptureStore failed to load", e);
  throw e;
}

let useRecorder: typeof import("./useRecorder").useRecorder;
try {
  useRecorder = require("./useRecorder").useRecorder;
  console.log("[Entry] useRecorder loaded");
} catch (e) {
  console.error("[Entry] useRecorder failed to load", e);
  throw e;
}

type StartCaptureOptions = {
  model?: "lite" | "full";
  targetFps?: number;
  trackingProfile?: "auto" | "pose" | "holistic";
};

export function useWhamCapture(_onFrame?: unknown) {
  const {
    setStatus,
    setError,
    setEngineState,
    setTrackingState,
    resetSession,
    status,
  } = useCaptureStore();

  const recorder = useRecorder();

  const ping = useCallback(async () => {
    return { ok: true, pipeline: "wham_video_upload" };
  }, []);

  const startCapture = useCallback(
    async (_options?: StartCaptureOptions) => {
      if (status === "starting" || status === "capturing") return;
      resetSession();
      setError(undefined);
      setStatus("starting");
      setEngineState("starting", "camera_preview");

      try {
        setEngineState("running", "wham_video_upload_ready");
        setTrackingState(
          "ready",
          true,
          "Ready to record. WHAM/SMPL processing runs after upload.",
        );
        setStatus("capturing");
      } catch (e: any) {
        setEngineState("error", e?.message ?? "Capture start failed");
        setError(e?.message ?? "Capture start failed");
        setStatus("error");
        throw e;
      }
    },
    [resetSession, setEngineState, setError, setStatus, setTrackingState, status],
  );

  const stopCapture = useCallback(async () => {
    if (status !== "capturing" && status !== "starting" && status !== "error") return;
    setStatus("stopping");
    setEngineState("stopping", "camera_preview");
    resetSession();
    setStatus("idle");
  }, [resetSession, setEngineState, setStatus, status]);

  return {
    ping,
    startCapture,
    stopCapture,
    recorderState: recorder.state,
    startRecording: recorder.startRecording,
    stopRecording: recorder.stopRecording,
    currentTake: recorder.currentTake,
  };
}
