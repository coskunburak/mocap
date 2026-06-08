/**
 * useMultiViewCapture – Hook for the Host side of dual-camera capture.
 *
 * Coordinates:
 *   - Backend WebSocket relay for guest connection
 *   - FrameMatcher (timestamp-based frame pairing)
 *   - Triangulator (DLT 3D reconstruction)
 *   - TimeSync (clock offset management)
 *   - MultiViewStore (UI state)
 */

import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import type { PeerHostEvent } from "../../../infra/networking/PeerHost";
import type { PeerGuestEvent } from "../../../infra/networking/PeerGuest";
import { WebSocketPeerHost } from "../../../infra/networking/WebSocketPeerHost";
import { WebSocketPeerGuest } from "../../../infra/networking/WebSocketPeerGuest";
import {
  type DeviceInfo,
  base64ToFloat32,
} from "../../../infra/networking/PeerProtocol";
import { captureSessionWebSocketUrl } from "../../../infra/networking/WebSocketRelay";
import { FrameMatcher } from "../../../domain/mocap/pipeline/triangulation/FrameMatcher";
import {
  triangulateLandmarks,
  type ProjectionMatrix,
} from "../../../domain/mocap/pipeline/triangulation/Triangulator";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import type { MultiViewPoseFrame } from "../../../domain/mocap/models/MultiViewPoseFrame";
import { env } from "../../../app/config/env";
import { container } from "../../../app/di/container";
import { useMultiViewStore } from "../state/multiViewStore";

// ─── Types ──────────────────────────────────────────────────────────

export type MultiViewCaptureCallbacks = {
  /** Called when a triangulated multi-view frame is produced */
  onMultiViewFrame?: (frame: MultiViewPoseFrame) => void;
  /** Called when the remote frame is received (for preview) */
  onRemoteFrame?: (frame: PoseFrame) => void;
  /** Called when the guest receives a command from the host */
  onCommand?: (action: string, params?: Record<string, unknown>) => void;
};

// ─── Device ID ──────────────────────────────────────────────────────

function makeDeviceId(): string {
  return `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeDeviceInfo(role: "host" | "guest"): DeviceInfo {
  return {
    deviceId: makeDeviceId(),
    role,
    name: `${Platform.OS === "ios" ? "iPhone" : "Android"} (${role})`,
    platform: Platform.OS as "ios" | "android",
    appVersion: "1.0.0",
  };
}

// ─── Globals (Singleton) ────────────────────────────────────────────

let globalHost: WebSocketPeerHost | null = null;
let globalGuest: WebSocketPeerGuest | null = null;
let globalMatcher: FrameMatcher | null = null;
let globalHostCleanup: (() => void) | null = null;
let globalGuestCleanup: (() => void) | null = null;
let globalFrameId = 0;
let globalTriFpsCount = 0;
let globalTriFpsTimer: ReturnType<typeof setInterval> | null = null;
let globalCallbacks: MultiViewCaptureCallbacks | null = null;

export function setMultiViewCallbacks(callbacks: MultiViewCaptureCallbacks) {
  globalCallbacks = callbacks;
}

async function ensureProjectId() {
  if (env.defaultProjectId) return env.defaultProjectId;
  const project = await container.apiClient.createProject("Dual Captures");
  return project.id;
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useMultiViewCapture(callbacks?: MultiViewCaptureCallbacks) {
  const store = useMultiViewStore();

  // Update callbacks if provided
  if (callbacks) {
    globalCallbacks = callbacks;
  }


  // ─── Host mode ──────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    if (globalHost) return;

    const deviceInfo = makeDeviceInfo("host");
    store.setLocalDevice(deviceInfo);
    store.setCaptureMode("dual-camera");
    store.setPeerRole("host");
    store.setConnectionState("connecting");

    const projectId = await ensureProjectId();
    const result = await container.mocapSessionService.createCaptureSession(projectId, {
      name: `Dual Capture ${new Date().toLocaleTimeString()}`,
      captureMode: "dual",
      expectedDeviceCount: 2,
      hostDevice: {
        deviceId: deviceInfo.deviceId,
        deviceRole: "host",
        platform: Platform.OS,
        appVersion: deviceInfo.appVersion,
      },
      syncMetadata: {
        transport: "websocket_relay",
        protocolVersion: 1,
      },
    });

    store.setBackendCaptureSession({
      captureMode: "dual-camera",
      projectId,
      takeId: result.captureSession.takeId,
      captureSessionId: result.captureSession.id,
      joinToken: result.captureSession.joinToken,
      deviceRole: "host",
      deviceId: deviceInfo.deviceId,
      deviceIndex: 0,
    });

    const host = new WebSocketPeerHost(
      deviceInfo,
      captureSessionWebSocketUrl({
        captureSessionId: result.captureSession.id,
        role: "host",
        deviceId: deviceInfo.deviceId,
      }),
      result.captureSession.id,
    );
    globalHost = host;

    const matcher = new FrameMatcher({ toleranceMs: 20, maxBufferSize: 30 });
    globalMatcher = matcher;

    const cleanup = host.addListener((event: PeerHostEvent) => {
      switch (event.type) {
        case "state_change":
          if (event.state === "listening") {
            store.setConnectionState("listening");
          } else if (event.state === "connected") {
            store.setConnectionState("connected");
          } else if (event.state === "syncing") {
            store.setConnectionState("syncing");
          } else if (event.state === "ready") {
            store.setConnectionState("ready");
          } else if (event.state === "error") {
            store.setConnectionState("error", event.error);
          }
          break;

        case "guest_connected":
          store.setRemoteDevice(event.device);
          break;

        case "guest_disconnected":
          store.setRemoteDevice(undefined);
          store.setConnectionState("disconnected", event.reason);
          matcher.reset();
          break;

        case "time_sync_ready":
          store.setTimeSyncState(true, event.offset, event.rtt);
          matcher.setClockOffset(event.offset);
          break;

        case "frame_received": {
          // Decode landmark buffer from base64
          const landmarks = base64ToFloat32(event.payload.landmarksB64);
          const worldLandmarks = event.payload.worldLandmarksB64
            ? base64ToFloat32(event.payload.worldLandmarksB64)
            : undefined;

          const remoteFrame: PoseFrame = {
            ts: event.payload.tsLocal,
            landmarks,
            worldLandmarks,
            trackingProfile: event.payload.trackingProfile,
            frameId: event.payload.frameId,
          };

          // Push to matcher
          matcher.pushRemoteFrame(remoteFrame);
          store.setLastRemoteFrame(remoteFrame);

          // Notify callback for preview
          globalCallbacks?.onRemoteFrame?.(remoteFrame);
          break;
        }

        case "status_received":
          store.setRemoteStatus(
            event.payload.engineState,
            event.payload.trackingState,
            event.payload.fps,
            event.payload.batteryLevel,
          );
          break;

        case "error":
          store.setConnectionState("error", event.message);
          break;
      }
    });

    globalHostCleanup = cleanup;

    try {
      await host.start();
    } catch (err: any) {
      globalHostCleanup?.();
      globalHostCleanup = null;
      try {
        await host.stop();
      } catch { /* ignore */ }
      if (globalHost === host) {
        globalHost = null;
      }
      globalMatcher?.reset();
      globalMatcher = null;
      store.setConnectionState("error", err?.message);
    }
  }, [store]);

  const stopHost = useCallback(async () => {
    globalHostCleanup?.();
    globalHostCleanup = null;

    if (globalHost) {
      await globalHost.stop();
      globalHost = null;
    }
    globalMatcher?.reset();
    globalMatcher = null;
    store.resetMultiView();
  }, [store]);

  // ─── Guest mode ─────────────────────────────────────────────────

  const startGuest = useCallback(async (joinToken: string) => {
    if (globalGuest) return;

    const deviceInfo = makeDeviceInfo("guest");
    store.setLocalDevice(deviceInfo);
    store.setCaptureMode("dual-camera");
    store.setPeerRole("guest");
    store.setConnectionState("connecting");

    const result = await container.mocapSessionService.joinCaptureSession({
      joinToken: joinToken.trim().toUpperCase(),
      deviceId: deviceInfo.deviceId,
      deviceRole: "guest",
      platform: Platform.OS,
      appVersion: deviceInfo.appVersion,
    });

    store.setBackendCaptureSession({
      captureMode: "dual-camera",
      projectId: result.captureSession.projectId,
      takeId: result.captureSession.takeId,
      captureSessionId: result.captureSession.id,
      joinToken: result.captureSession.joinToken,
      deviceRole: "guest",
      deviceId: deviceInfo.deviceId,
      deviceIndex: result.device.deviceIndex,
    });

    const guest = new WebSocketPeerGuest(
      deviceInfo,
      captureSessionWebSocketUrl({
        captureSessionId: result.captureSession.id,
        role: "guest",
        deviceId: deviceInfo.deviceId,
      }),
    );
    globalGuest = guest;

    const cleanup = guest.addListener((event: PeerGuestEvent) => {
      switch (event.type) {
        case "state_change":
          if (event.state === "connecting") {
            store.setConnectionState("connecting");
          } else if (event.state === "handshaking") {
            store.setConnectionState("connecting");
          } else if (event.state === "syncing") {
            store.setConnectionState("syncing");
          } else if (event.state === "ready") {
            store.setConnectionState("ready");
          } else if (event.state === "error") {
            store.setConnectionState("error", event.error);
          }
          break;

        case "connected":
          store.setRemoteDevice(event.hostDevice);
          store.setSessionId(event.sessionId);
          break;

        case "disconnected":
          store.setRemoteDevice(undefined);
          store.setConnectionState("disconnected", event.reason);
          break;

        case "command":
          // Handle commands from host (start/stop capture, calibration)
          console.log("[MultiView] command from host:", event.payload.action);
          globalCallbacks?.onCommand?.(event.payload.action, event.payload.params);
          break;

        case "time_sync_ready":
          store.setTimeSyncState(true, event.offset, 0);
          break;

        case "error":
          store.setConnectionState("error", event.message);
          break;
      }
    });

    globalGuestCleanup = cleanup;

    try {
      await guest.connect();
    } catch (err: any) {
      globalGuestCleanup?.();
      globalGuestCleanup = null;
      try {
        await guest.disconnect();
      } catch { /* ignore */ }
      if (globalGuest === guest) {
        globalGuest = null;
      }
      store.setConnectionState("error", err?.message);
    }
  }, [store]);

  const stopGuest = useCallback(async () => {
    globalGuestCleanup?.();
    globalGuestCleanup = null;

    if (globalGuest) {
      await globalGuest.disconnect();
      globalGuest = null;
    }
    store.resetMultiView();
  }, [store]);

  // ─── Frame handling (Host) ──────────────────────────────────────

  /**
   * Legacy local-frame hook used by the host when a local frame arrives.
   * Tries to match with a remote frame and triangulate.
   */
  const processLocalFrame = useCallback(
    (localFrame: PoseFrame): MultiViewPoseFrame | null => {
      const matcher = globalMatcher;
      if (!matcher) return null;

      const cal = store.stereoCalibration;
      if (!cal) return null;

      const match = matcher.matchLocalFrame(localFrame);
      if (!match) return null;

      // Triangulate
      const P1 = cal.projectionA as unknown as ProjectionMatrix;
      const P2 = cal.projectionB as unknown as ProjectionMatrix;
      const result = triangulateLandmarks(
        match.frameA.landmarks,
        match.frameB.landmarks,
        P1,
        P2,
        0.3,
      );

      const multiFrame: MultiViewPoseFrame = {
        ts: match.matchTs,
        frameA: match.frameA,
        frameB: match.frameB,
        triangulated3D: result.landmarks3D,
        reprojErrors: result.reprojErrors,
        avgReprojError: result.avgReprojError,
        triangulatedCount: result.triangulatedCount,
        timeDelta: match.timeDelta,
        deviceA: store.localDevice?.deviceId ?? "host",
        deviceB: store.remoteDevice?.deviceId ?? "guest",
        trackingProfile: localFrame.trackingProfile ?? "pose",
        frameId: globalFrameId++,
      };

      // Update stats
      globalTriFpsCount++;
      store.setLastMultiViewFrame(multiFrame);
      const stats = matcher.stats;
      store.updateStats(
        stats.matchCount,
        stats.dropCount,
        result.avgReprojError,
        0, // will be updated by fps timer
      );

      globalCallbacks?.onMultiViewFrame?.(multiFrame);
      return multiFrame;
    },
    [store],
  );

  /**
   * Send a local frame to the host (Guest mode).
   */
  const sendFrameToHost = useCallback((frame: PoseFrame) => {
    globalGuest?.sendFrame(frame);
  }, []);

  /**
   * Send a command from host to guest.
   */
  const sendCommand = useCallback(
    (action: "start_capture" | "stop_capture" | "start_recording" | "stop_recording" | "start_calibration" | "abort_calibration") => {
      globalHost?.sendCommand(action);
    },
    [],
  );

  // ─── Triangulation FPS timer ────────────────────────────────────

  useEffect(() => {
    if (!globalTriFpsTimer) {
      globalTriFpsTimer = setInterval(() => {
        const fps = globalTriFpsCount;
        globalTriFpsCount = 0;
        store.updateStats(
          store.matchedFrameCount,
          store.droppedFrameCount,
          store.avgReprojError,
          fps,
        );
      }, 1000);
    }

    return () => {
      // Intentionally not clearing global timer to keep it running across screens
    };
  }, [store]);

  // ─── Cleanup ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Global singletons, do not auto-cleanup on unmount.
      // Call stopHost / stopGuest explicitly to cleanup.
    };
  }, []);

  return {
    // State
    state: store,

    // Host actions
    startHost,
    stopHost,

    // Guest actions
    startGuest,
    stopGuest,

    // Frame processing
    processLocalFrame,
    sendFrameToHost,

    // Commands
    sendCommand,

    // References
    host: globalHost,
    guest: globalGuest,
    matcher: globalMatcher,
  };
}
