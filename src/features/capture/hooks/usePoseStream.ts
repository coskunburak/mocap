import { useCallback, useEffect, useRef } from "react";
import { lmAt } from "../../../domain/mocap/models/Landmark";
import { MP33 } from "../../../domain/mocap/models/MediapipePose33";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import type { PoseSmoother as PoseSmootherType } from "../../../domain/mocap/pipeline/filter/PoseSmoother";

let PoseEngine: typeof import("../../../domain/mocap/pipeline/pose/PoseEngine.native").PoseEngine;
try {
  PoseEngine = require("../../../domain/mocap/pipeline/pose/PoseEngine.native").PoseEngine;
  console.log("[Entry] PoseEngine loaded");
} catch (e) {
  console.error("[Entry] PoseEngine failed to load", e);
  throw e;
}

let useCaptureStore: typeof import("../state/captureStore").useCaptureStore;
try {
  useCaptureStore = require("../state/captureStore").useCaptureStore;
  console.log("[Entry] useCaptureStore loaded");
} catch (e) {
  console.error("[Entry] useCaptureStore failed to load", e);
  throw e;
}

let PoseSmoother: typeof import("../../../domain/mocap/pipeline/filter/PoseSmoother").PoseSmoother;
try {
  PoseSmoother = require("../../../domain/mocap/pipeline/filter/PoseSmoother").PoseSmoother;
  console.log("[Entry] PoseSmoother loaded");
} catch (e) {
  console.error("[Entry] PoseSmoother failed to load", e);
  throw e;
}

let landmarkCount: typeof import("../../../domain/mocap/models/Landmark").landmarkCount;
try {
  landmarkCount = require("../../../domain/mocap/models/Landmark").landmarkCount;
  console.log("[Entry] landmarkCount loaded");
} catch (e) {
  console.error("[Entry] landmarkCount failed to load", e);
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

function nowMs() {
  return Date.now();
}

type StartCaptureOptions = {
  model?: "lite" | "full";
  targetFps?: number;
  trackingProfile?: "auto" | "pose" | "holistic";
};

type StartRecordingOptions = {
  takeName?: string;
  projectId?: string;
  chunkFrames?: number;
  trackingProfile?: "pose" | "holistic";
  calibration?: import("../../../domain/mocap/models/Take").TakeCalibration;
};

const TRACKING_REQUIRED_JOINTS = [
  MP33.LEFT_SHOULDER,
  MP33.RIGHT_SHOULDER,
  MP33.LEFT_HIP,
  MP33.RIGHT_HIP,
  MP33.LEFT_ANKLE,
  MP33.RIGHT_ANKLE,
] as const;

const TRACKING_OPTIONAL_JOINTS = [
  MP33.NOSE,
  MP33.LEFT_ELBOW,
  MP33.RIGHT_ELBOW,
  MP33.LEFT_WRIST,
  MP33.RIGHT_WRIST,
  MP33.LEFT_KNEE,
  MP33.RIGHT_KNEE,
] as const;

const MIN_READY_FRAMES = 3;
const LOST_FRAME_TOLERANCE = 6;

function confidenceAt(frame: PoseFrame, index: number) {
  return lmAt(frame.landmarks, index).c ?? 0;
}

function countTracked(frame: PoseFrame, indices: readonly number[], threshold: number) {
  return indices.reduce((count, index) => {
    return count + (confidenceAt(frame, index) >= threshold ? 1 : 0);
  }, 0);
}

function hasTrackingLock(frame: PoseFrame, threshold: number) {
  const requiredTracked = countTracked(frame, TRACKING_REQUIRED_JOINTS, threshold);
  const optionalTracked = countTracked(frame, TRACKING_OPTIONAL_JOINTS, threshold * 0.92);

  return {
    requiredTracked,
    optionalTracked,
    locked: requiredTracked >= 5 && optionalTracked >= 3,
  };
}

export function usePoseStream(
  onFrame?: (frame: PoseFrame) => PoseFrame | import("../../../domain/mocap/models/MultiViewPoseFrame").MultiViewPoseFrame | void | null
) {
  const {
    setStatus,
    setError,
    setFrame,
    setEngineState,
    setTrackingState,
    resetSession,
    status,
    readyForRecording,
    smoothingEnabled,
    jointThreshold,
  } = useCaptureStore();

  const recorder = useRecorder();

  const lastTsRef = useRef<number | null>(null);
  const frameSubCleanupRef = useRef<null | (() => void)>(null);
  const statusSubCleanupRef = useRef<null | (() => void)>(null);
  const stableTrackingFramesRef = useRef(0);
  const lostTrackingFramesRef = useRef(0);
  const hasTrackingLockRef = useRef(false);

  const smootherRef = useRef<PoseSmootherType | null>(null);
  const worldSmootherRef = useRef<PoseSmootherType | null>(null);
  const faceSmootherRef = useRef<PoseSmootherType | null>(null);
  const leftHandSmootherRef = useRef<PoseSmootherType | null>(null);
  const leftHandWorldSmootherRef = useRef<PoseSmootherType | null>(null);
  const rightHandSmootherRef = useRef<PoseSmootherType | null>(null);
  const rightHandWorldSmootherRef = useRef<PoseSmootherType | null>(null);

  /**
   * ✅ Fix: stale closure
   * Native listener tek bir callback instance'ı tutuyor olabilir.
   * Bu yüzden "kayıt aktif mi" ve "pushFrame fonksiyonu" ref üzerinden okunmalı.
   */
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = recorder.state.status === "recording";
  }, [recorder.state.status]);

  const pushFrameRef = useRef<(f: PoseFrame | import("../../../domain/mocap/models/MultiViewPoseFrame").MultiViewPoseFrame) => void>(() => {});
  useEffect(() => {
    pushFrameRef.current = recorder.pushFrame;
  }, [recorder.pushFrame]);

  const cleanupListeners = useCallback(() => {
    frameSubCleanupRef.current?.();
    frameSubCleanupRef.current = null;
    statusSubCleanupRef.current?.();
    statusSubCleanupRef.current = null;
  }, []);

  const resetRuntimeState = useCallback(() => {
    cleanupListeners();
    smootherRef.current = null;
    worldSmootherRef.current = null;
    faceSmootherRef.current = null;
    leftHandSmootherRef.current = null;
    leftHandWorldSmootherRef.current = null;
    rightHandSmootherRef.current = null;
    rightHandWorldSmootherRef.current = null;
    lastTsRef.current = null;
    stableTrackingFramesRef.current = 0;
    lostTrackingFramesRef.current = 0;
    hasTrackingLockRef.current = false;
  }, [cleanupListeners]);

  const ping = useCallback(async () => {
    try {
      return await PoseEngine.ping();
    } catch (e: any) {
      setError(e?.message ?? "Ping failed");
      throw e;
    }
  }, [setError]);

  /**
   * ✅ handleIncomingFrame artık "recorder" objesine bağımlı değil.
   * Sadece ref'lerden okur.
   */
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
      if (frame.worldLandmarks && !worldSmootherRef.current) {
        const n = landmarkCount(frame.worldLandmarks);
        worldSmootherRef.current = new PoseSmoother(n, { confidenceGate: jointThreshold });
      }
      if (frame.faceLandmarks && !faceSmootherRef.current) {
        const n = landmarkCount(frame.faceLandmarks);
        faceSmootherRef.current = new PoseSmoother(n, { confidenceGate: jointThreshold });
      }
      if (frame.leftHandLandmarks && !leftHandSmootherRef.current) {
        const n = landmarkCount(frame.leftHandLandmarks);
        leftHandSmootherRef.current = new PoseSmoother(n, { confidenceGate: jointThreshold });
      }
      if (frame.leftHandWorldLandmarks && !leftHandWorldSmootherRef.current) {
        const n = landmarkCount(frame.leftHandWorldLandmarks);
        leftHandWorldSmootherRef.current = new PoseSmoother(n, {
          confidenceGate: jointThreshold,
        });
      }
      if (frame.rightHandLandmarks && !rightHandSmootherRef.current) {
        const n = landmarkCount(frame.rightHandLandmarks);
        rightHandSmootherRef.current = new PoseSmoother(n, { confidenceGate: jointThreshold });
      }
      if (frame.rightHandWorldLandmarks && !rightHandWorldSmootherRef.current) {
        const n = landmarkCount(frame.rightHandWorldLandmarks);
        rightHandWorldSmootherRef.current = new PoseSmoother(n, {
          confidenceGate: jointThreshold,
        });
      }

      const landmarks =
        smoothingEnabled && smootherRef.current
          ? smootherRef.current.filter(frame.landmarks, ts)
          : frame.landmarks;
      const worldLandmarks =
        frame.worldLandmarks && smoothingEnabled && worldSmootherRef.current
          ? worldSmootherRef.current.filter(frame.worldLandmarks, ts)
          : frame.worldLandmarks;
      const faceLandmarks =
        frame.faceLandmarks && smoothingEnabled && faceSmootherRef.current
          ? faceSmootherRef.current.filter(frame.faceLandmarks, ts)
          : frame.faceLandmarks;
      const leftHandLandmarks =
        frame.leftHandLandmarks && smoothingEnabled && leftHandSmootherRef.current
          ? leftHandSmootherRef.current.filter(frame.leftHandLandmarks, ts)
          : frame.leftHandLandmarks;
      const leftHandWorldLandmarks =
        frame.leftHandWorldLandmarks &&
        smoothingEnabled &&
        leftHandWorldSmootherRef.current
          ? leftHandWorldSmootherRef.current.filter(frame.leftHandWorldLandmarks, ts)
          : frame.leftHandWorldLandmarks;
      const rightHandLandmarks =
        frame.rightHandLandmarks && smoothingEnabled && rightHandSmootherRef.current
          ? rightHandSmootherRef.current.filter(frame.rightHandLandmarks, ts)
          : frame.rightHandLandmarks;
      const rightHandWorldLandmarks =
        frame.rightHandWorldLandmarks &&
        smoothingEnabled &&
        rightHandWorldSmootherRef.current
          ? rightHandWorldSmootherRef.current.filter(frame.rightHandWorldLandmarks, ts)
          : frame.rightHandWorldLandmarks;

      const next: PoseFrame = {
        ...frame,
        ts,
        landmarks,
        worldLandmarks,
        faceLandmarks,
        leftHandLandmarks,
        leftHandWorldLandmarks,
        rightHandLandmarks,
        rightHandWorldLandmarks,
      };

      const trackingThreshold = Math.max(0.34, jointThreshold * 0.85);
      const tracking = hasTrackingLock(next, trackingThreshold);
      if (tracking.locked) {
        stableTrackingFramesRef.current += 1;
        lostTrackingFramesRef.current = 0;

        const isReady = stableTrackingFramesRef.current >= MIN_READY_FRAMES;
        if (isReady) {
          hasTrackingLockRef.current = true;
        }

        setTrackingState(
          isReady ? "ready" : "stabilizing",
          isReady,
          isReady
            ? "Skeleton locked. You can start recording."
            : "Skeleton detected. Hold the pose for a moment.",
        );
      } else {
        stableTrackingFramesRef.current = 0;
        lostTrackingFramesRef.current += 1;

        const trackingDropped =
          hasTrackingLockRef.current &&
          lostTrackingFramesRef.current >= LOST_FRAME_TOLERANCE;

        setTrackingState(
          trackingDropped ? "lost" : "searching",
          false,
          trackingDropped
            ? "Tracking dropped. Re-center your full body before recording."
            : "Step into frame until shoulders, hips, and ankles are visible.",
        );
      }

      setFrame(next, poseFps);

      const overrideFrame = onFrame?.(next);

      // ✅ record aktifse frame'i yaz
      if (isRecordingRef.current) {
        pushFrameRef.current(overrideFrame || next);
      }
    },
    [jointThreshold, onFrame, setFrame, setTrackingState, smoothingEnabled]
  );

  const handleEngineStatus = useCallback(
    (payload: {
      status: string;
      engineState?: "idle" | "starting" | "running" | "stopping" | "error";
      message?: string;
    }) => {
      if (payload.engineState) {
        setEngineState(payload.engineState, payload.status);

        if (payload.engineState === "starting") {
          setStatus("starting");
          setTrackingState("waiting", false, "Booting pose model...");
        } else if (payload.engineState === "running") {
          setStatus("capturing");
          if (!hasTrackingLockRef.current) {
            setTrackingState("searching", false, "Model is live. Step fully into frame.");
          }
        } else if (payload.engineState === "stopping") {
          setStatus("stopping");
          setTrackingState("waiting", false, "Stopping capture...");
        } else if (payload.engineState === "error") {
          setStatus("error");
        }
      }

      const loweredStatus = payload.status.toLowerCase();
      if (payload.message && (payload.engineState === "error" || loweredStatus.includes("error"))) {
        setError(payload.message);
      }
    },
    [setEngineState, setError, setStatus, setTrackingState]
  );

  const startCapture = useCallback(
    async (opts?: StartCaptureOptions) => {
      if (status === "capturing" || status === "starting" || status === "stopping") return;

      setError(undefined);
      resetSession();
      resetRuntimeState();
      setEngineState("starting", "starting");
      setTrackingState("waiting", false, "Booting pose model...");
      setStatus("starting");

      try {
        // cleanup old listener
        cleanupListeners();
        frameSubCleanupRef.current = PoseEngine.addListener(handleIncomingFrame);
        statusSubCleanupRef.current = PoseEngine.addStatusListener(handleEngineStatus);

        const desiredModel = opts?.model ?? "full";

        await PoseEngine.start({
          model: desiredModel,
          trackingProfile: opts?.trackingProfile ?? "auto",
          minConfidence: jointThreshold,
          minPoseConfidence: jointThreshold,
          minFaceConfidence: jointThreshold,
          minHandConfidence: jointThreshold,
          outputFaceBlendshapes: true,
          targetFps: opts?.targetFps ?? 30,
          runningMode: "stream",
        });

        setEngineState("running", "running");
        setTrackingState("searching", false, "Model is live. Step fully into frame.");
        setStatus("capturing");
      } catch (e: any) {
        resetRuntimeState();
        setEngineState("error", "error_start_failed");
        setTrackingState("waiting", false, "Capture failed to start.");
        setStatus("error");
        setError(e?.message ?? "Start failed");
      }
    },
    [
      cleanupListeners,
      handleEngineStatus,
      handleIncomingFrame,
      jointThreshold,
      resetRuntimeState,
      resetSession,
      setEngineState,
      setError,
      setStatus,
      setTrackingState,
      status,
    ]
  );

  const stopCapture = useCallback(async () => {
    if (status !== "capturing" && status !== "starting") return;

    setStatus("stopping");
    setEngineState("stopping", "stopping");
    setTrackingState("waiting", false, "Stopping capture...");
    try {
      // Eğer kayıttaysa önce kaydı kapat (flush/finalize)
      if (recorder.state.status === "recording") {
        await recorder.stopRecording();
      }

      // sonra native engine stop
      await PoseEngine.stop();
    } finally {
      resetRuntimeState();
      resetSession();
      setEngineState("idle", "idle");
      setStatus("idle");
    }
  }, [recorder, resetRuntimeState, resetSession, setEngineState, setStatus, setTrackingState, status]);

  const startRecording = useCallback(
    async (opts?: StartRecordingOptions) => {
      if (status !== "capturing") {
        setError("Start capture before recording.");
        return;
      }
      if (!readyForRecording) {
        setError("Wait until the skeleton locks before recording.");
        return;
      }
      if (recorder.state.status !== "idle") return;

      await recorder.startRecording({
        takeName: opts?.takeName ?? `Take ${new Date().toLocaleTimeString()}`,
        projectId: opts?.projectId,
        chunkFrames: opts?.chunkFrames ?? 30,
        trackingProfile: opts?.trackingProfile,
        calibration: opts?.calibration,
      });
    },
    [readyForRecording, recorder, setError, status]
  );

  const stopRecording = useCallback(async () => {
    if (recorder.state.status !== "recording") return;
    return await recorder.stopRecording();
  }, [recorder]);

  useEffect(() => {
    return () => {
      resetRuntimeState();
    };
  }, [resetRuntimeState]);

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
