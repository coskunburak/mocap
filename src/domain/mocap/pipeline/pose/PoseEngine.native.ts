import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { IPoseEngine, PoseEngineOptions, PoseFrameListener } from "./IPoseEngine";
import type { PoseFrame } from "../../models/PoseFrame";
import { LANDMARK_STRIDE } from "../../models/Landmark";

const MODULE_NAME = "PoseEngineModule";
const EVENT_FRAME = "PoseEngineFrame";
const EVENT_STATUS = "PoseEngineStatus"; // optional (ileride bağlarız)

const NativePoseEngine = NativeModules[MODULE_NAME];

function assertAvailable() {
  if (!NativePoseEngine) {
    // eslint-disable-next-line no-console
    console.error("[PoseEngine] Native module missing", {
      module: MODULE_NAME,
      availableModules: Object.keys(NativeModules ?? {}).slice(0, 10),
    });
    const hint =
      Platform.OS === "ios"
        ? "iOS: pod install + rebuild. Ensure PoseEngineModule is exported."
        : "Android: gradle sync + rebuild. Ensure module is registered.";
    throw new Error(`[PoseEngine] Native module '${MODULE_NAME}' not found. ${hint}`);
  }
}

function clamp01(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : fallback;
  return Math.max(0, Math.min(1, n));
}

/** Swift payload landmark item */
type NativeLandmark = {
  id: number;
  x: number;
  y: number;
  v: number; // visibility/confidence
  z?: number; // currently not sent by swift mock; we default 0
};

type NativeFramePayload = {
  timestampMs?: number;
  ts?: number;
  frameId?: number;
  fps?: number;
  landmarks?: NativeLandmark[];
};

const DEFAULT_LM_COUNT = 33;

function landmarksToBuffer(items: NativeLandmark[] | undefined, count = DEFAULT_LM_COUNT) {
  // Always return fixed size buffer (count*4)
  const buf = new Float32Array(count * LANDMARK_STRIDE);
  // Init confidence = 0 so missing joints won't render
  for (let i = 0; i < count; i++) {
    const o = i * LANDMARK_STRIDE;
    buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0;
  }

  if (!items || !Array.isArray(items)) return buf;

  for (const lm of items) {
    const id = lm?.id;
    if (typeof id !== "number") continue;
    if (id < 0 || id >= count) continue;

    const o = id * LANDMARK_STRIDE;
    const x = typeof lm.x === "number" ? lm.x : 0;
    const y = typeof lm.y === "number" ? lm.y : 0;
    const z = typeof lm.z === "number" ? lm.z : 0;
    const c = typeof lm.v === "number" ? lm.v : 0;

    buf[o] = x;
    buf[o + 1] = y;
    buf[o + 2] = z;
    buf[o + 3] = clamp01(c, 0);
  }
  return buf;
}

function toPoseFrame(p: NativeFramePayload): PoseFrame {
  const ts =
    (typeof p.timestampMs === "number" && p.timestampMs) ||
    (typeof p.ts === "number" && p.ts) ||
    Date.now();

  const landmarks = landmarksToBuffer(p.landmarks, DEFAULT_LM_COUNT);

  return {
    ts,
    frameId: typeof p.frameId === "number" ? p.frameId : undefined,
    fps: typeof p.fps === "number" ? p.fps : undefined,
    landmarks,
  };
}

export const PoseEngine: IPoseEngine = (() => {
  let emitter: NativeEventEmitter | null = null;
  let started = false;

  const getEmitter = () => {
    if (!emitter) emitter = new NativeEventEmitter(NativePoseEngine);
    return emitter;
  };

  return {
    async ping() {
      assertAvailable();
      const res = await NativePoseEngine.ping?.();
      if (res && typeof res.ok === "boolean" && typeof res.version === "string") return res;
      return { ok: true, version: "unknown" };
    },

    async start(options: PoseEngineOptions) {
      assertAvailable();
      if (started) return; // idempotent
      started = true;

      const minConfidence = clamp01(options.minConfidence, 0.5);
      const minPoseConfidence = clamp01(options.minPoseConfidence, minConfidence);

      await NativePoseEngine.start({
        model: options.model ?? "lite",
        minConfidence,
        minPoseConfidence,
        runningMode: options.runningMode ?? "stream",
        targetFps: options.targetFps ?? 30,
        emitEveryNthFrame: options.emitEveryNthFrame ?? 1,
        debug: options.debug ?? false,
      });
    },

    async stop() {
      assertAvailable();
      if (!started) return;
      started = false;
      await NativePoseEngine.stop();
    },

    addListener(cb: PoseFrameListener) {
      assertAvailable();
      const sub = getEmitter().addListener(EVENT_FRAME, (payload: NativeFramePayload) => {
        try {
          cb(toPoseFrame(payload));
        } catch (e) {
          // frame parse errors should never crash the stream
          console.warn("[PoseEngine] frame parse error", e);
        }
      });
      return () => sub.remove();
    },
  };
})();
