import { create } from "zustand";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import { landmarkCount } from "../../../domain/mocap/models/Landmark";
import { countTrackedLandmarks } from "../../../domain/mocap/models/PoseFrame";

type CaptureStatus = "idle" | "starting" | "capturing" | "stopping" | "error";
type EngineState = "idle" | "starting" | "running" | "stopping" | "error";
type TrackingState = "waiting" | "searching" | "stabilizing" | "ready" | "lost";

type CaptureState = {
  status: CaptureStatus;
  error?: string;
  engineState: EngineState;
  engineStatus?: string;
  trackingState: TrackingState;
  trackingHint: string;
  readyForRecording: boolean;

  lastFrame?: PoseFrame;
  recentFrames: PoseFrame[];
  poseFps: number;
  lmCount: number;
  faceLmCount: number;
  handLmCount: number;
  totalTrackedPoints: number;
  trackingProfile: "pose" | "holistic";
  hasFaceBlendshapes: boolean;
  hasPoseSegmentationMask: boolean;

  smoothingEnabled: boolean;
  jointThreshold: number;
  boneThreshold: number;

  setStatus: (s: CaptureStatus) => void;
  setError: (msg?: string) => void;
  setFrame: (f: PoseFrame, poseFps: number) => void;
  setEngineState: (engineState: EngineState, engineStatus?: string) => void;
  setTrackingState: (
    trackingState: TrackingState,
    readyForRecording: boolean,
    trackingHint: string,
  ) => void;
  resetSession: () => void;

  setSmoothing: (v: boolean) => void;
  setThresholds: (joint: number, bone: number) => void;
  setTrackingProfile: (profile: "pose" | "holistic") => void;
};

const INITIAL_TRACKING_HINT = "Tap Start to prepare video capture for WHAM processing.";

export const useCaptureStore = create<CaptureState>((set) => ({
  status: "idle",
  error: undefined,
  engineState: "idle",
  engineStatus: undefined,
  trackingState: "waiting",
  trackingHint: INITIAL_TRACKING_HINT,
  readyForRecording: false,

  lastFrame: undefined,
  recentFrames: [],
  poseFps: 0,
  lmCount: 0,
  faceLmCount: 0,
  handLmCount: 0,
  totalTrackedPoints: 0,
  trackingProfile: "pose",
  hasFaceBlendshapes: false,
  hasPoseSegmentationMask: false,

  smoothingEnabled: true,
  jointThreshold: 0.5,
  boneThreshold: 0.6,

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setEngineState: (engineState, engineStatus) =>
    set({ engineState, engineStatus }),
  setTrackingState: (trackingState, readyForRecording, trackingHint) =>
    set({ trackingState, readyForRecording, trackingHint }),

  setFrame: (f, poseFps) =>
    set((state) => ({
      lastFrame: f,
      recentFrames: [...state.recentFrames.slice(-23), f],
      poseFps,
      lmCount: landmarkCount(f.landmarks),
      faceLmCount: f.faceLandmarks ? landmarkCount(f.faceLandmarks) : 0,
      handLmCount:
        (f.leftHandLandmarks ? landmarkCount(f.leftHandLandmarks) : 0) +
        (f.rightHandLandmarks ? landmarkCount(f.rightHandLandmarks) : 0),
      totalTrackedPoints: countTrackedLandmarks(f),
      trackingProfile: f.trackingProfile ?? "pose",
      hasFaceBlendshapes: Boolean(f.faceBlendshapes?.length),
      hasPoseSegmentationMask: Boolean(f.hasPoseSegmentationMask),
    })),

  resetSession: () =>
    set({
      lastFrame: undefined,
      recentFrames: [],
      poseFps: 0,
      lmCount: 0,
      faceLmCount: 0,
      handLmCount: 0,
      totalTrackedPoints: 0,
      trackingProfile: "pose",
      hasFaceBlendshapes: false,
      hasPoseSegmentationMask: false,
      engineState: "idle",
      engineStatus: undefined,
      trackingState: "waiting",
      trackingHint: INITIAL_TRACKING_HINT,
      readyForRecording: false,
      error: undefined,
    }),

  setSmoothing: (smoothingEnabled) => set({ smoothingEnabled }),
  setThresholds: (joint, bone) =>
    set({
      jointThreshold: Math.max(0, Math.min(1, joint)),
      boneThreshold: Math.max(0, Math.min(1, bone)),
    }),
  setTrackingProfile: (trackingProfile) => set({ trackingProfile }),
}));
