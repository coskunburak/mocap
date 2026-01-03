import type { PoseFrame } from "../../models/PoseFrame";

export type PoseEngineOptions = Readonly<{
  model: "lite" | "full";
  runningMode?: "stream";

  minConfidence?: number;     // UI gate (0..1) default 0.5
  minPoseConfidence?: number; // native threshold, default = minConfidence

  targetFps?: number;         // native throttle hint, default 30
  emitEveryNthFrame?: number; // default 1
  debug?: boolean;
}>;

export type PoseFrameListener = (frame: PoseFrame) => void;

export interface IPoseEngine {
  ping(): Promise<{ ok: boolean; version: string }>;
  start(options: PoseEngineOptions): Promise<void>;
  stop(): Promise<void>;
  addListener(cb: PoseFrameListener): () => void;
}
