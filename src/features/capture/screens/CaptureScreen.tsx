import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { env } from "../../../app/config/env";
import { routes } from "../../../app/navigation/routes";
import { analyzeCalibration } from "../../../domain/mocap/pipeline/calibration/CalibrationAnalyzer";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import { colors, radii, spacing, typography } from "../../../ui/theme";

let CameraView: typeof import("../components/CameraView").CameraView;
try {
  CameraView = require("../components/CameraView").CameraView;
  console.log("[Entry] CameraView loaded");
} catch (e) {
  console.error("[Entry] CameraView failed to load", e);
  throw e;
}

let OverlaySkeleton: typeof import("../components/OverlaySkeleton").OverlaySkeleton;
try {
  OverlaySkeleton = require("../components/OverlaySkeleton").OverlaySkeleton;
  console.log("[Entry] OverlaySkeleton loaded");
} catch (e) {
  console.error("[Entry] OverlaySkeleton failed to load", e);
  throw e;
}

let StereoCalibrationWizard: typeof import("../components/StereoCalibrationWizard").StereoCalibrationWizard;
try {
  StereoCalibrationWizard = require("../components/StereoCalibrationWizard").StereoCalibrationWizard;
} catch (e) {
  console.error("[Entry] StereoCalibrationWizard failed to load", e);
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

let usePoseStream: typeof import("../hooks/usePoseStream").usePoseStream;
try {
  usePoseStream = require("../hooks/usePoseStream").usePoseStream;
  console.log("[Entry] usePoseStream loaded");
} catch (e) {
  console.error("[Entry] usePoseStream failed to load", e);
  throw e;
}

let useMultiViewCapture: typeof import("../hooks/useMultiViewCapture").useMultiViewCapture;
let setMultiViewCallbacks: typeof import("../hooks/useMultiViewCapture").setMultiViewCallbacks;
try {
  const mv = require("../hooks/useMultiViewCapture");
  useMultiViewCapture = mv.useMultiViewCapture;
  setMultiViewCallbacks = mv.setMultiViewCallbacks;
  console.log("[Entry] useMultiViewCapture loaded");
} catch (e) {
  console.error("[Entry] useMultiViewCapture failed to load", e);
  throw e;
}

let useMultiViewStore: typeof import("../state/multiViewStore").useMultiViewStore;
try {
  useMultiViewStore = require("../state/multiViewStore").useMultiViewStore;
  console.log("[Entry] useMultiViewStore loaded");
} catch (e) {
  console.error("[Entry] useMultiViewStore failed to load", e);
  throw e;
}

type Nav = any;
type CaptureModel = "lite" | "full";
type CaptureView = "front" | "back";

const RECORD_COUNTDOWN_SECONDS = 5;
const RECORD_COUNTDOWN_TICK_MS = 100;

function trackingLabel(state: "waiting" | "searching" | "stabilizing" | "ready" | "lost") {
  switch (state) {
    case "waiting":
      return "model boot";
    case "searching":
      return "find subject";
    case "stabilizing":
      return "hold pose";
    case "ready":
      return "ready";
    case "lost":
      return "tracking lost";
  }
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `${seconds}s`;
}

function RemotePoseMini({ frame }: { frame?: PoseFrame }) {
  if (!frame) return null;

  return (
    <View pointerEvents="none" style={styles.remotePoseCard}>
      <View style={styles.remotePoseViewport}>
        <OverlaySkeleton width={118} height={170} frame={frame} />
      </View>
      <View style={styles.remotePoseFooter}>
        <View style={styles.remoteLiveDot} />
        <Text style={styles.remotePoseText}>guest</Text>
      </View>
    </View>
  );
}

function formatMetric(value: number, suffix = "") {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(value >= 10 ? 0 : 1)}${suffix}`;
}

function MultiViewDebugPanel({
  state,
  remoteAgeMs,
  matchedAgeMs,
}: {
  state: ReturnType<typeof useMultiViewStore.getState>;
  remoteAgeMs: number | null;
  matchedAgeMs: number | null;
}) {
  const remoteFresh = remoteAgeMs != null && remoteAgeMs < 900;
  const matchedFresh = matchedAgeMs != null && matchedAgeMs < 900;
  const lastDelta = state.lastMultiViewFrame?.timeDelta ?? 0;

  return (
    <View pointerEvents="none" style={styles.debugPanel}>
      <View style={styles.debugHeader}>
        <Text style={styles.debugTitle}>dual camera</Text>
        <View
          style={[
            styles.debugDot,
            {
              backgroundColor:
                state.connectionState === "ready" || state.connectionState === "capturing"
                  ? colors.accent
                  : state.connectionState === "error"
                    ? colors.danger
                    : "rgba(255,255,255,0.45)",
            },
          ]}
        />
      </View>
      <Text style={styles.debugLine}>
        {state.peerRole} · {state.connectionState}
      </Text>
      <Text style={styles.debugLine}>
        remote {remoteFresh ? `${remoteAgeMs}ms` : "waiting"} · {state.remoteFrameCount}f
      </Text>
      <Text style={styles.debugLine}>
        match {matchedFresh ? `${matchedAgeMs}ms` : "waiting"} · Δ {formatMetric(lastDelta, "ms")}
      </Text>
      <Text style={styles.debugLine}>
        pairs {state.matchedFrameCount}/{state.droppedFrameCount} · tri {formatMetric(state.triangulationFps, "fps")}
      </Text>
      <Text style={styles.debugLine}>
        sync {formatMetric(state.syncRtt, "ms")} · err {formatMetric(state.avgReprojError, "px")}
      </Text>
    </View>
  );
}

export default function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const {
    status,
    error,
    engineState,
    trackingState,
    trackingHint,
    readyForRecording,
    recentFrames,
    trackingProfile,
    totalTrackedPoints,
    lastFrame,
    poseFps,
    setError,
    setTrackingProfile,
  } = useCaptureStore();

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [navOpen, setNavOpen] = useState(false);
  const [captureModel, setCaptureModel] = useState<CaptureModel>("full");
  const [captureView, setCaptureView] = useState<CaptureView>("front");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const countdownEndsAtRef = useRef<number | null>(null);

  const { processLocalFrame, sendFrameToHost, state: mvState } = useMultiViewCapture();

  const dualRobotFrame = useMemo<PoseFrame | undefined>(() => {
    const multiFrame = mvState.lastMultiViewFrame;
    if (!multiFrame) return undefined;

    return {
      ...multiFrame.frameA,
      ts: multiFrame.ts,
      frameId: multiFrame.frameId,
      trackingProfile: multiFrame.trackingProfile,
      sourceDevice: "dual-camera",
      triangulated: true,
      worldLandmarks: multiFrame.triangulated3D,
    };
  }, [mvState.lastMultiViewFrame]);

  const avatarFrame = dualRobotFrame ?? lastFrame;
  const remoteAgeMs = mvState.lastRemoteFrameAt ? Date.now() - mvState.lastRemoteFrameAt : null;
  const matchedAgeMs = mvState.lastMatchedFrameAt ? Date.now() - mvState.lastMatchedFrameAt : null;

  const handleFrame = useCallback(
    (frame: PoseFrame) => {
      if (mvState.connectionState === "ready" || mvState.connectionState === "capturing") {
        if (mvState.peerRole === "guest") {
          sendFrameToHost(frame);
        } else if (mvState.peerRole === "host") {
          return processLocalFrame(frame);
        }
      }
      return null;
    },
    [mvState.connectionState, mvState.peerRole, processLocalFrame, sendFrameToHost],
  );

  const {
    startCapture,
    stopCapture,
    recorderState,
    startRecording,
    stopRecording,
    currentTake,
  } = usePoseStream(handleFrame);

  const isRecording =
    recorderState.status === "recording" || recorderState.status === "stopping";
  const isEngineBusy = status === "starting" || status === "stopping";
  const preferredCalibrationPose =
    trackingProfile === "holistic" ? "t-pose" : "a-pose";
  const calibration = useMemo(
    () => analyzeCalibration(recentFrames, preferredCalibrationPose),
    [preferredCalibrationPose, recentFrames],
  );
  const readinessPercent = Math.round(calibration.readinessScore * 100);
  const modelLabel = captureModel === "full" ? "s1" : "lite";
  const captureReadyLabel = isRecording
    ? "recording"
    : status === "capturing"
      ? readyForRecording
        ? "ready"
        : trackingLabel(trackingState)
      : status;

  const onStartCapture = useCallback(async () => {
    await startCapture({
      model: captureModel,
      trackingProfile,
      targetFps: 30,
    });
  }, [captureModel, startCapture, trackingProfile]);

  const onStartRecord = useCallback(async () => {
    try {
      if (status !== "capturing") {
        setError?.("Start capture before recording.");
        return;
      }
      if (!readyForRecording) {
        setError?.(trackingHint);
        return;
      }
      if (recorderState.status !== "idle") return;

      const isProCapture =
        mvState.captureMode === "pro-4-camera" && Boolean(mvState.backendCaptureSessionId);
      const isDualCapture =
        !isProCapture &&
        (mvState.connectionState === "ready" || mvState.connectionState === "capturing");

      await startRecording({
        takeName: `${captureView === "front" ? "Front" : "Back"} Take ${new Date().toLocaleTimeString()}`,
        trackingProfile,
        calibration: {
          ...calibration,
          calibratedAt: Date.now(),
        },
        captureMode: isProCapture ? "pro-4-camera" : isDualCapture ? "dual-camera" : "solo",
        viewCount: isProCapture ? 4 : isDualCapture ? 2 : 1,
        deviceId: isProCapture ? mvState.proDeviceId : undefined,
        deviceRole: isProCapture
          ? mvState.proDeviceRole ?? "front"
          : mvState.peerRole === "guest"
            ? "secondary"
            : "primary",
        deviceIndex: isProCapture
          ? mvState.proDeviceIndex ?? 0
          : mvState.peerRole === "guest"
            ? 1
            : 0,
        captureSessionId: isProCapture
          ? mvState.backendCaptureSessionId
          : mvState.sessionId
            ? `cap_${mvState.sessionId}`
            : undefined,
        multiCameraSessionId: isProCapture ? mvState.backendCaptureSessionId : undefined,
        approxCameraAngle: isProCapture ? mvState.proApproxCameraAngle : undefined,
        calibrationClipId: isProCapture ? mvState.proCalibrationClipId : undefined,
        clockOffsetMs: mvState.clockOffset,
      });
    } catch (e: any) {
      console.error("[CaptureScreen] startRecording error", e);
      Alert.alert("Record hata", e?.message ?? "Start recording failed");
    }
  }, [
    calibration,
    captureView,
    readyForRecording,
    recorderState.status,
    setError,
    startRecording,
    status,
    trackingHint,
    trackingProfile,
    mvState.clockOffset,
    mvState.backendCaptureSessionId,
    mvState.connectionState,
    mvState.peerRole,
    mvState.proApproxCameraAngle,
    mvState.proCalibrationClipId,
    mvState.proDeviceId,
    mvState.proDeviceIndex,
    mvState.proDeviceRole,
    mvState.captureMode,
    mvState.sessionId,
  ]);
  const onStartRecordRef = useRef(onStartRecord);
  const countdownGuardsRef = useRef({
    isRecording,
    readyForRecording,
    status,
    trackingHint,
  });

  useEffect(() => {
    onStartRecordRef.current = onStartRecord;
  }, [onStartRecord]);

  useEffect(() => {
    countdownGuardsRef.current = {
      isRecording,
      readyForRecording,
      status,
      trackingHint,
    };
  }, [isRecording, readyForRecording, status, trackingHint]);

  const beginRecordingCountdown = useCallback(() => {
    if (isEngineBusy || recorderState.status === "stopping" || countdown != null) {
      return;
    }
    if (isRecording) {
      return;
    }
    if (status !== "capturing") {
      setError?.("Start capture before recording.");
      return;
    }
    if (!readyForRecording) {
      setError?.(trackingHint);
      return;
    }
    if (recorderState.status !== "idle") {
      return;
    }

    setError?.(undefined);
    countdownEndsAtRef.current = Date.now() + RECORD_COUNTDOWN_SECONDS * 1000;
    setCountdown(RECORD_COUNTDOWN_SECONDS);
  }, [
    countdown,
    isEngineBusy,
    isRecording,
    readyForRecording,
    recorderState.status,
    setError,
    status,
    trackingHint,
  ]);

  const onStopRecord = useCallback(async () => {
    try {
      if (recorderState.status !== "recording") return;

      const finalized = await stopRecording();
      const takeId = finalized?.id ?? currentTake?.id;
      if (!takeId) {
        navigation.navigate(routes.ReviewHub as never);
        return;
      }

      navigation.navigate(routes.MotionPreview as never, {
        takeId,
        continueBackend: env.enableBackendCaptureFlow,
      } as never);
    } catch (e: any) {
      console.error("[CaptureScreen] stopRecording error", e);
      Alert.alert("Stop hata", e?.message ?? "Stop recording failed");
    }
  }, [currentTake?.id, navigation, recorderState.status, stopRecording]);

  const onPrimaryPress = useCallback(() => {
    if (isEngineBusy || recorderState.status === "stopping") {
      return;
    }

    if (isRecording) {
      void onStopRecord();
      return;
    }

    if (status === "idle" || status === "error") {
      void onStartCapture();
      return;
    }

    if (status !== "capturing") {
      return;
    }

    beginRecordingCountdown();
  }, [
    beginRecordingCountdown,
    isEngineBusy,
    isRecording,
    onStartCapture,
    onStopRecord,
    recorderState.status,
    status,
  ]);

  const go = useCallback(
    (route: string) => {
      setNavOpen(false);
      navigation.navigate(route as never);
    },
    [navigation],
  );

  useEffect(() => {
    setMultiViewCallbacks({
      onCommand: (action) => {
        if (action === "start_capture") void onStartCapture();
        if (action === "stop_capture") void stopCapture();
        if (action === "start_recording") beginRecordingCountdown();
        if (action === "stop_recording") void stopRecording();
      },
    });
  }, [beginRecordingCountdown, onStartCapture, stopCapture, stopRecording]);

  useEffect(() => {
    if (!isRecording) {
      setRecordStartedAt(null);
      setElapsedMs(0);
      return;
    }

    const startedAt = recordStartedAt ?? Date.now();
    if (recordStartedAt == null) {
      setRecordStartedAt(startedAt);
    }

    setElapsedMs(Date.now() - startedAt);
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => clearInterval(interval);
  }, [isRecording, recordStartedAt]);

  const countdownActive = countdown != null;

  useEffect(() => {
    if (!countdownActive) {
      return;
    }

    const tick = () => {
      const { status, isRecording, readyForRecording, trackingHint } =
        countdownGuardsRef.current;

      if (status !== "capturing" || isRecording) {
        countdownEndsAtRef.current = null;
        setCountdown(null);
        return;
      }

      if (!readyForRecording) {
        countdownEndsAtRef.current = null;
        setCountdown(null);
        setError?.(trackingHint);
        return;
      }

      const endsAt = countdownEndsAtRef.current;
      if (endsAt == null) {
        setCountdown(null);
        return;
      }

      const remainingMs = endsAt - Date.now();
      if (remainingMs <= 0) {
        countdownEndsAtRef.current = null;
        setCountdown(null);
        void onStartRecordRef.current();
        return;
      }

      const nextCountdown = Math.max(
        1,
        Math.min(RECORD_COUNTDOWN_SECONDS, Math.ceil(remainingMs / 1000)),
      );
      setCountdown((value) => (value === nextCountdown ? value : nextCountdown));
    };

    tick();
    const interval = setInterval(tick, RECORD_COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [countdownActive, setError]);

  const showInstruction =
    countdown != null ||
    Boolean(error) ||
    (status === "capturing" && !readyForRecording) ||
    status === "starting" ||
    isRecording;
  const diagnosticsTop = insets.top + (showInstruction ? 178 : 104);

  const instructionTitle =
    countdown != null
      ? `Remember to stand in an ${preferredCalibrationPose.toUpperCase()} Pose and hold this pose until recording starts`
      : error
        ? error
        : isRecording
          ? "Recording motion"
          : status === "starting"
            ? "Starting native pose engine"
            : trackingHint;

  const instructionSubtitle =
    countdown != null
      ? "It's crucial to get the best possible results"
      : isRecording
        ? `${formatElapsed(elapsedMs)} captured · ${totalTrackedPoints} tracked points`
        : `${trackingProfile.toUpperCase()} · ${readinessPercent}% calibration · ${Math.round(poseFps || 0)} fps`;

  return (
    <View style={styles.root}>
      <View style={styles.cameraLayer}>
        <CameraView rounded={false} onLayoutSize={(w, h) => setSize({ w, h })} />
        <OverlaySkeleton width={size.w} height={size.h} frame={avatarFrame} />
      </View>

      <View pointerEvents="none" style={styles.vignette} />

      <View style={[styles.topChrome, { top: insets.top + spacing.sm }]}>
        <View style={styles.topLeftStack}>
          <View style={styles.segmentedPill}>
            <Pressable
              style={[
                styles.segmentButton,
                captureView === "front" && styles.segmentButtonActive,
              ]}
              onPress={() => setCaptureView("front")}
            >
              <Text style={styles.segmentText}>front</Text>
            </Pressable>
            <View style={styles.segmentDot} />
            <Pressable
              style={[
                styles.segmentButton,
                captureView === "back" && styles.segmentButtonActive,
              ]}
              onPress={() => setCaptureView("back")}
            >
              <Text style={styles.segmentText}>back</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.modelPill, status !== "idle" && status !== "error" && styles.pillDisabled]}
            disabled={status !== "idle" && status !== "error"}
            onPress={() => setCaptureModel((value) => (value === "full" ? "lite" : "full"))}
          >
            <Text style={styles.modelLabel}>model</Text>
            <Text style={styles.modelValue}>{modelLabel}</Text>
            <Text style={styles.modelChevron}>⌄</Text>
          </Pressable>
        </View>

        <View style={styles.topRightStack}>
          <Pressable style={styles.profileButton} onPress={() => setNavOpen((value) => !value)}>
            <View style={styles.profileHead} />
            <View style={styles.profileBody} />
          </Pressable>
        </View>
      </View>

      {showInstruction ? (
        <View
          pointerEvents="none"
          style={[
            styles.instructionBanner,
            { top: insets.top + 92 },
            error && styles.instructionDanger,
          ]}
        >
          <Text style={styles.instructionTitle}>{instructionTitle}</Text>
          <Text style={styles.instructionSubtitle}>{instructionSubtitle}</Text>
        </View>
      ) : null}

      {countdown != null && countdown > 0 ? (
        <View pointerEvents="none" style={styles.countdownWrap}>
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      ) : null}

      {mvState.peerRole === "host" && mvState.connectionState !== "disconnected" ? (
        <View style={[styles.remotePoseDock, { top: diagnosticsTop }]}>
          <RemotePoseMini frame={mvState.lastRemoteFrame} />
        </View>
      ) : null}

      {mvState.peerRole !== "solo" && mvState.connectionState !== "disconnected" ? (
        <View style={[styles.debugDock, { top: diagnosticsTop + (mvState.peerRole === "host" ? 218 : 0) }]}>
          <MultiViewDebugPanel
            state={mvState}
            remoteAgeMs={remoteAgeMs}
            matchedAgeMs={matchedAgeMs}
          />
        </View>
      ) : null}

      {mvState.peerRole === "host" && mvState.connectionState === "ready" && !mvState.stereoCalibration ? (
        <View style={[styles.wizardOverlay, { top: insets.top + 118 }]}>
          <StereoCalibrationWizard
            localLandmarks={lastFrame?.landmarks}
            remoteLandmarks={mvState.lastRemoteFrame?.landmarks}
            onCalibrationComplete={(cal) => {
              useCaptureStore.getState().setError?.(undefined);
              useMultiViewStore.getState().setStereoCalibration(cal);
            }}
            onCancel={() => setNavOpen(false)}
            onRequestGuestCapture={() => undefined}
          />
        </View>
      ) : null}

      {navOpen ? (
        <View style={[styles.navSheet, { bottom: insets.bottom + 124 }]}>
          <Pressable style={styles.navChip} onPress={() => go(routes.ReviewHub)}>
            <Text style={styles.navChipText}>Review</Text>
          </Pressable>
          <Pressable style={styles.navChip} onPress={() => go(routes.Projects)}>
            <Text style={styles.navChipText}>Projects</Text>
          </Pressable>
          <Pressable style={styles.navChip} onPress={() => go(routes.Exports)}>
            <Text style={styles.navChipText}>Exports</Text>
          </Pressable>
          <Pressable style={styles.navChip} onPress={() => go(routes.MultiViewSetup)}>
            <Text style={styles.navChipText}>Dual</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.bottomControls, { bottom: insets.bottom + spacing.md }]}>
        <Pressable style={styles.menuButton} onPress={() => setNavOpen((value) => !value)}>
          <View style={styles.menuGrid}>
            <View style={styles.menuSquareWide} />
            <View style={styles.menuSquare} />
            <View style={styles.menuSquare} />
            <View style={styles.menuSquareWide} />
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? "Stop recording" : "Start capture or recording"}
          style={[
            styles.shutterButton,
            isRecording && styles.shutterRecording,
            (isEngineBusy || recorderState.status === "stopping" || countdown != null) &&
              styles.shutterDisabled,
          ]}
          onPress={onPrimaryPress}
        >
          <View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} />
        </Pressable>

        <View style={styles.statusOrb}>
          <View style={styles.statusOrbRow}>
            <View
              style={[
                styles.liveDot,
                {
                  backgroundColor: isRecording
                    ? colors.danger
                    : readyForRecording
                      ? colors.accent
                      : colors.textMuted,
                },
              ]}
            />
            <Text style={styles.statusOrbTime}>
              {isRecording ? formatElapsed(elapsedMs) : `${readinessPercent}%`}
            </Text>
          </View>
          <Text style={styles.statusOrbLabel}>{captureReadyLabel}</Text>
        </View>
      </View>

      {status === "capturing" || status === "starting" ? (
        <Pressable
          style={[styles.stopCaptureButton, { bottom: insets.bottom + 22 }]}
          onPress={() => void stopCapture()}
        >
          <Text style={styles.stopCaptureText}>stop</Text>
        </Pressable>
      ) : null}

      <View style={[styles.modeRail, { bottom: insets.bottom + 98 }]}>
        <Pressable
          style={[styles.modeRailChip, trackingProfile === "pose" && styles.modeRailChipActive]}
          onPress={() => {
            if (status === "idle" || status === "error") setTrackingProfile("pose");
          }}
        >
          <Text style={styles.modeRailText}>body</Text>
        </Pressable>
        <Pressable
          style={[
            styles.modeRailChip,
            trackingProfile === "holistic" && styles.modeRailChipActive,
          ]}
          onPress={() => {
            if (status === "idle" || status === "error") setTrackingProfile("holistic");
          }}
        >
          <Text style={styles.modeRailText}>full</Text>
        </Pressable>
      </View>
    </View>
  );
}

const GLASS_BLACK = "rgba(0, 0, 0, 0.82)";
const GLASS_BORDER = "rgba(255, 255, 255, 0.16)";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },
  cameraLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  topChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  topLeftStack: {
    gap: spacing.xs,
  },
  topRightStack: {
    alignItems: "flex-end",
  },
  segmentedPill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: GLASS_BLACK,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  segmentButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 9,
    borderRadius: 9,
  },
  segmentButtonActive: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  segmentText: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 21,
    lineHeight: 25,
  },
  segmentDot: {
    width: 4,
    height: 4,
    marginHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  modelPill: {
    alignSelf: "flex-start",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    backgroundColor: GLASS_BLACK,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  pillDisabled: {
    opacity: 0.72,
  },
  modelLabel: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 20,
    lineHeight: 24,
  },
  modelValue: {
    ...typography.title.card,
    color: "rgba(255,255,255,0.72)",
    fontSize: 19,
    lineHeight: 24,
  },
  modelChevron: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 18,
    lineHeight: 20,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: GLASS_BLACK,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  profileHead: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.white,
    marginBottom: 3,
  },
  profileBody: {
    width: 22,
    height: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: colors.white,
  },
  instructionBanner: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    zIndex: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  instructionDanger: {
    borderColor: "rgba(255,115,143,0.34)",
  },
  instructionTitle: {
    ...typography.title.card,
    color: colors.white,
    textAlign: "center",
    fontSize: 19,
    lineHeight: 24,
  },
  instructionSubtitle: {
    ...typography.label.md,
    color: "rgba(255,255,255,0.58)",
    textAlign: "center",
    marginTop: 4,
    letterSpacing: 0,
  },
  countdownWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownText: {
    color: colors.white,
    fontSize: 282,
    lineHeight: 292,
    fontWeight: "900",
    textAlign: "center",
    includeFontPadding: false,
    textShadowColor: "rgba(0,0,0,0.32)",
    textShadowRadius: 20,
    textShadowOffset: { width: 0, height: 8 },
  },
  remotePoseDock: {
    position: "absolute",
    right: spacing.md,
    zIndex: 17,
  },
  remotePoseCard: {
    width: 136,
    height: 206,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  remotePoseViewport: {
    width: 136,
    height: 174,
    backgroundColor: "rgba(2,6,23,0.56)",
  },
  remotePoseFooter: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  remoteLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.accent,
  },
  remotePoseText: {
    ...typography.label.sm,
    color: colors.white,
    letterSpacing: 0,
  },
  debugDock: {
    position: "absolute",
    right: spacing.md,
    zIndex: 17,
  },
  debugPanel: {
    width: 190,
    padding: spacing.sm,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  debugHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  debugTitle: {
    ...typography.label.sm,
    color: colors.white,
    letterSpacing: 0,
  },
  debugDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  debugLine: {
    ...typography.label.sm,
    color: "rgba(255,255,255,0.72)",
    lineHeight: 17,
    letterSpacing: 0,
  },
  navSheet: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.82)",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  navChip: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  navChipText: {
    ...typography.label.md,
    color: colors.white,
    letterSpacing: 0,
  },
  wizardOverlay: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 30,
    elevation: 20,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  bottomControls: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuButton: {
    width: 74,
    height: 74,
    justifyContent: "center",
    alignItems: "center",
  },
  menuGrid: {
    width: 52,
    height: 52,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
    gap: 5,
  },
  menuSquareWide: {
    width: 26,
    height: 19,
    borderRadius: 4,
    backgroundColor: colors.white,
  },
  menuSquare: {
    width: 19,
    height: 26,
    borderRadius: 4,
    backgroundColor: colors.white,
  },
  shutterButton: {
    width: 98,
    height: 98,
    borderRadius: 49,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 8,
    borderColor: colors.white,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  shutterRecording: {
    borderColor: colors.white,
  },
  shutterDisabled: {
    opacity: 0.48,
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  shutterInnerRecording: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.danger,
  },
  statusOrb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusOrbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  statusOrbTime: {
    ...typography.title.card,
    color: colors.white,
    fontSize: 20,
    lineHeight: 23,
  },
  statusOrbLabel: {
    ...typography.label.sm,
    color: "rgba(255,255,255,0.48)",
    marginTop: 3,
    letterSpacing: 0,
  },
  stopCaptureButton: {
    position: "absolute",
    right: spacing.md,
    zIndex: 21,
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.66)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  stopCaptureText: {
    ...typography.label.sm,
    color: "rgba(255,255,255,0.72)",
    letterSpacing: 0,
  },
  modeRail: {
    position: "absolute",
    left: spacing.md,
    zIndex: 21,
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  modeRailChip: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  modeRailChipActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  modeRailText: {
    ...typography.label.sm,
    color: colors.white,
    letterSpacing: 0,
  },
});
