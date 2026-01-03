import { create } from "zustand";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import { landmarkCount } from "../../../domain/mocap/models/Landmark";

type CaptureStatus = "idle" | "starting" | "capturing" | "stopping" | "error";

type CaptureState = {
  status: CaptureStatus;
  error?: string;

  lastFrame?: PoseFrame;
  poseFps: number;
  lmCount: number;

  smoothingEnabled: boolean;
  jointThreshold: number;
  boneThreshold: number;

  setStatus: (s: CaptureStatus) => void;
  setError: (msg?: string) => void;
  setFrame: (f: PoseFrame, poseFps: number) => void;

  setSmoothing: (v: boolean) => void;
  setThresholds: (joint: number, bone: number) => void;
};

export const useCaptureStore = create<CaptureState>((set) => ({
  status: "idle",
  error: undefined,

  lastFrame: undefined,
  poseFps: 0,
  lmCount: 0,

  smoothingEnabled: true,
  jointThreshold: 0.5,
  boneThreshold: 0.6,

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),

  setFrame: (f, poseFps) =>
    set({
      lastFrame: f,
      poseFps,
      lmCount: landmarkCount(f.landmarks),
    }),

  setSmoothing: (smoothingEnabled) => set({ smoothingEnabled }),
  setThresholds: (joint, bone) =>
    set({
      jointThreshold: Math.max(0, Math.min(1, joint)),
      boneThreshold: Math.max(0, Math.min(1, bone)),
    }),
}));
