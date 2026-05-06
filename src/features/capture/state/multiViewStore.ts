/**
 * multiViewStore – Zustand store for dual-camera capture state.
 *
 * Tracks connection state, peer info, calibration, and remote frames.
 */

import { create } from "zustand";
import type { DeviceInfo, DeviceRole } from "../../../infra/networking/PeerProtocol";
import type {
  MultiViewPoseFrame,
  StereoCalibrationResult,
  CaptureMode,
} from "../../../domain/mocap/models/MultiViewPoseFrame";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";

// ─── Types ──────────────────────────────────────────────────────────

export type MultiViewConnectionState =
  | "disconnected"
  | "listening"
  | "connecting"
  | "connected"
  | "syncing"
  | "calibrating"
  | "ready"
  | "capturing"
  | "error";

export type MultiViewState = {
  // Mode
  captureMode: CaptureMode;
  peerRole: DeviceRole | "solo";

  // Connection
  connectionState: MultiViewConnectionState;
  connectionError?: string;
  hostIp?: string;
  hostPort?: number;

  // Peer info
  localDevice?: DeviceInfo;
  remoteDevice?: DeviceInfo;
  sessionId?: string;

  // Time sync
  timeSyncReady: boolean;
  clockOffset: number;
  syncRtt: number;

  // Calibration
  stereoCalibration?: StereoCalibrationResult;
  calibrationInProgress: boolean;
  calibrationStep: number;
  calibrationTotalSteps: number;

  // Remote status
  remoteEngineState: "idle" | "starting" | "running" | "stopping" | "error";
  remoteTrackingState: "waiting" | "searching" | "stabilizing" | "ready" | "lost";
  remoteFps: number;
  remoteBattery?: number;

  // Latest streams
  lastRemoteFrame?: PoseFrame;
  lastRemoteFrameAt?: number;
  remoteFrameCount: number;
  lastMultiViewFrame?: MultiViewPoseFrame;
  lastMatchedFrameAt?: number;

  // Stats
  matchedFrameCount: number;
  droppedFrameCount: number;
  avgReprojError: number;
  triangulationFps: number;

  // Actions
  setCaptureMode: (mode: CaptureMode) => void;
  setPeerRole: (role: DeviceRole | "solo") => void;
  setConnectionState: (state: MultiViewConnectionState, error?: string) => void;
  setHostAddress: (ip: string, port: number) => void;
  setLocalDevice: (device: DeviceInfo) => void;
  setRemoteDevice: (device: DeviceInfo | undefined) => void;
  setSessionId: (id: string) => void;
  setTimeSyncState: (ready: boolean, offset: number, rtt: number) => void;
  setStereoCalibration: (cal: StereoCalibrationResult | undefined) => void;
  setCalibrationProgress: (inProgress: boolean, step: number, total: number) => void;
  setRemoteStatus: (
    engineState: MultiViewState["remoteEngineState"],
    trackingState: MultiViewState["remoteTrackingState"],
    fps: number,
    battery?: number,
  ) => void;
  setLastRemoteFrame: (frame: PoseFrame | undefined) => void;
  setLastMultiViewFrame: (frame: MultiViewPoseFrame | undefined) => void;
  updateStats: (matched: number, dropped: number, reprojError: number, triFps: number) => void;
  resetMultiView: () => void;
};

// ─── Initial values ────────────────────────────────────────────────

const INITIAL: Omit<MultiViewState, keyof MultiViewActions> = {
  captureMode: "solo",
  peerRole: "solo",
  connectionState: "disconnected",
  connectionError: undefined,
  hostIp: undefined,
  hostPort: undefined,
  localDevice: undefined,
  remoteDevice: undefined,
  sessionId: undefined,
  timeSyncReady: false,
  clockOffset: 0,
  syncRtt: 0,
  stereoCalibration: undefined,
  calibrationInProgress: false,
  calibrationStep: 0,
  calibrationTotalSteps: 3,
  remoteEngineState: "idle",
  remoteTrackingState: "waiting",
  remoteFps: 0,
  remoteBattery: undefined,
  lastRemoteFrame: undefined,
  lastRemoteFrameAt: undefined,
  remoteFrameCount: 0,
  lastMultiViewFrame: undefined,
  lastMatchedFrameAt: undefined,
  matchedFrameCount: 0,
  droppedFrameCount: 0,
  avgReprojError: 0,
  triangulationFps: 0,
};

type MultiViewActions = Pick<
  MultiViewState,
  | "setCaptureMode"
  | "setPeerRole"
  | "setConnectionState"
  | "setHostAddress"
  | "setLocalDevice"
  | "setRemoteDevice"
  | "setSessionId"
  | "setTimeSyncState"
  | "setStereoCalibration"
  | "setCalibrationProgress"
  | "setRemoteStatus"
  | "setLastRemoteFrame"
  | "setLastMultiViewFrame"
  | "updateStats"
  | "resetMultiView"
>;

// ─── Store ─────────────────────────────────────────────────────────

export const useMultiViewStore = create<MultiViewState>((set) => ({
  ...INITIAL,

  setCaptureMode: (captureMode) =>
    set({ captureMode, peerRole: captureMode === "solo" ? "solo" : "host" }),

  setPeerRole: (peerRole) => set({ peerRole }),

  setConnectionState: (connectionState, connectionError) =>
    set({ connectionState, connectionError }),

  setHostAddress: (hostIp, hostPort) => set({ hostIp, hostPort }),

  setLocalDevice: (localDevice) => set({ localDevice }),

  setRemoteDevice: (remoteDevice) => set({ remoteDevice }),

  setSessionId: (sessionId) => set({ sessionId }),

  setTimeSyncState: (timeSyncReady, clockOffset, syncRtt) =>
    set({ timeSyncReady, clockOffset, syncRtt }),

  setStereoCalibration: (stereoCalibration) => set({ stereoCalibration }),

  setCalibrationProgress: (calibrationInProgress, calibrationStep, calibrationTotalSteps) =>
    set({ calibrationInProgress, calibrationStep, calibrationTotalSteps }),

  setRemoteStatus: (remoteEngineState, remoteTrackingState, remoteFps, remoteBattery) =>
    set({ remoteEngineState, remoteTrackingState, remoteFps, remoteBattery }),

  setLastRemoteFrame: (lastRemoteFrame) =>
    set((state) => ({
      lastRemoteFrame,
      lastRemoteFrameAt: lastRemoteFrame ? Date.now() : undefined,
      remoteFrameCount: lastRemoteFrame ? state.remoteFrameCount + 1 : 0,
    })),

  setLastMultiViewFrame: (lastMultiViewFrame) =>
    set({
      lastMultiViewFrame,
      lastMatchedFrameAt: lastMultiViewFrame ? Date.now() : undefined,
    }),

  updateStats: (matchedFrameCount, droppedFrameCount, avgReprojError, triangulationFps) =>
    set({ matchedFrameCount, droppedFrameCount, avgReprojError, triangulationFps }),

  resetMultiView: () => set(INITIAL),
}));
