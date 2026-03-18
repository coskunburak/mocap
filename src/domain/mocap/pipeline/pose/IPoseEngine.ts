import type { PoseFrame, TrackingProfileRequest } from "../../models/PoseFrame";

export type PoseEngineOptions = Readonly<{
  model: "lite" | "full";
  runningMode?: "stream";
  trackingProfile?: TrackingProfileRequest;

  minConfidence?: number;     // UI gate (0..1) default 0.5
  minPoseConfidence?: number; // native threshold, default = minConfidence
  minFaceConfidence?: number;
  minHandConfidence?: number;
  outputFaceBlendshapes?: boolean;
  outputPoseSegmentationMask?: boolean;

  targetFps?: number;         // native throttle hint, default 30
  emitEveryNthFrame?: number; // default 1
  debug?: boolean;
}>;

export type PoseFrameListener = (frame: PoseFrame) => void;

export type PoseEngineRuntimeState = "idle" | "starting" | "running" | "stopping" | "error";

export type PoseEngineStatus = Readonly<{
  status: string;
  engineState?: PoseEngineRuntimeState;
  message?: string;
  model?: string;
  requestedModel?: string;
  requestedTrackingProfile?: TrackingProfileRequest;
  targetFps?: number;
  emitEveryNthFrame?: number;
}>;

export type PoseEngineStatusListener = (status: PoseEngineStatus) => void;

export interface IPoseEngine {
  ping(): Promise<{ ok: boolean; version: string }>;
  setPreviewActive(active: boolean): Promise<void>;
  start(options: PoseEngineOptions): Promise<void>;
  stop(): Promise<void>;
  addListener(cb: PoseFrameListener): () => void;
  addStatusListener(cb: PoseEngineStatusListener): () => void;
}
