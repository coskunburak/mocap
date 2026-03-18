import React, { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { routes } from "../../../app/navigation/routes";
import { Card } from "../../../ui/components/Card";
import { Screen } from "../../../ui/components/Screen";
import { colors, radii, spacing, statusColors, typography } from "../../../ui/theme";
import { analyzeCalibration } from "../../../domain/mocap/pipeline/calibration/CalibrationAnalyzer";

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

let RecordControls: typeof import("../components/RecordControls").RecordControls;
try {
  RecordControls = require("../components/RecordControls").RecordControls;
  console.log("[Entry] RecordControls loaded");
} catch (e) {
  console.error("[Entry] RecordControls failed to load", e);
  throw e;
}

type Nav = any;

function trackingLabel(state: "waiting" | "searching" | "stabilizing" | "ready" | "lost") {
  switch (state) {
    case "waiting":
      return "Model Boot";
    case "searching":
      return "Searching Subject";
    case "stabilizing":
      return "Stabilizing Skeleton";
    case "ready":
      return "Ready To Record";
    case "lost":
      return "Tracking Lost";
  }
}

function trackingTone(
  state: "waiting" | "searching" | "stabilizing" | "ready" | "lost",
  hasError: boolean,
) {
  if (hasError || state === "lost") return "danger" as const;
  if (state === "ready") return "accent" as const;
  return "muted" as const;
}

export default function CaptureScreen() {
  const navigation = useNavigation<Nav>();
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
    setError,
  } = useCaptureStore();
  const [size, setSize] = useState({ w: 0, h: 0 });

  const {
    startCapture,
    stopCapture,
    recorderState,
    startRecording,
    stopRecording,
    currentTake,
  } = usePoseStream();

  const isRecording =
    recorderState.status === "recording" || recorderState.status === "stopping";
  const preferredCalibrationPose =
    trackingProfile === "holistic" ? "t-pose" : "a-pose";
  const calibration = useMemo(
    () => analyzeCalibration(recentFrames, preferredCalibrationPose),
    [preferredCalibrationPose, recentFrames],
  );
  const recordDisabledReason =
    status !== "capturing"
      ? "Start capture first."
      : readyForRecording
        ? undefined
        : trackingHint;

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

      await startRecording({
        takeName: `Take ${new Date().toLocaleTimeString()}`,
        trackingProfile,
        calibration: {
          ...calibration,
          calibratedAt: Date.now(),
        },
      });
    } catch (e: any) {
      console.error("[CaptureScreen] startRecording error", e);
      Alert.alert("Record hata", e?.message ?? "Start recording failed");
    }
  }, [
    calibration,
    readyForRecording,
    recorderState.status,
    setError,
    startRecording,
    status,
    trackingHint,
    trackingProfile,
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

      navigation.navigate(routes.Review as never, { takeId } as never);
    } catch (e: any) {
      console.error("[CaptureScreen] stopRecording error", e);
      Alert.alert("Stop hata", e?.message ?? "Stop recording failed");
    }
  }, [currentTake?.id, navigation, recorderState.status, stopRecording]);

  return (
    <Screen
      background={error ? "danger" : isRecording ? "accent" : "default"}
      contentContainerStyle={styles.screen}
    >
      <Card tone="accent" padding="sm" style={styles.previewCard}>
        <View style={styles.previewWrap}>
          <CameraView onLayoutSize={(w, h) => setSize({ w, h })} />
          <OverlaySkeleton width={size.w} height={size.h} frame={lastFrame} />
          <View pointerEvents="none" style={styles.statusOverlay}>
            <View style={styles.statusPill}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isRecording
                      ? colors.danger
                      : statusColors[status],
                  },
                ]}
              />
              <Text style={styles.statusLabel}>
                {isRecording ? "RECORDING" : status.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
      </Card>

      <Card
        tone={trackingTone(trackingState, Boolean(error))}
        padding="sm"
        style={styles.signalCard}
      >
        <View style={styles.signalHeader}>
          <View>
            <Text style={styles.signalEyebrow}>{trackingLabel(trackingState)}</Text>
            <Text style={styles.signalTitle}>{trackingHint}</Text>
          </View>
          <Text style={styles.signalMeta}>{engineState.toUpperCase()}</Text>
        </View>
        <Text style={styles.signalDetails}>
          {trackingProfile.toUpperCase()} solve · {totalTrackedPoints} tracked points · calibration{" "}
          {Math.round(calibration.readinessScore * 100)}%
        </Text>
      </Card>

      <View style={styles.controlsWrap}>
        <RecordControls
          status={status}
          isRecording={isRecording}
          isStoppingRec={recorderState.status === "stopping"}
          onStartCapture={startCapture}
          onStopCapture={stopCapture}
          onStartRecord={onStartRecord}
          onStopRecord={onStopRecord}
          recordDisabledReason={recordDisabledReason}
        />
        <Text style={error ? styles.errorText : styles.helperText}>
          {error ??
            (readyForRecording
              ? "Skeleton stable. Press Start recording when ready."
              : recordDisabledReason ?? "Start capture to initialize the model.")}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: 118,
  },
  previewCard: {
    flex: 1,
    minHeight: 0,
    padding: spacing.sm,
  },
  previewWrap: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.backgroundDeep,
  },
  statusOverlay: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: "rgba(8, 10, 14, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  statusLabel: {
    ...typography.label.sm,
    color: colors.textPrimary,
    letterSpacing: 0.6,
  },
  controlsWrap: {
    gap: spacing.sm,
  },
  signalCard: {
    gap: spacing.sm,
  },
  signalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  signalEyebrow: {
    ...typography.eyebrow.sm,
    color: colors.textSecondary,
  },
  signalTitle: {
    ...typography.title.card,
    marginTop: spacing.xs,
  },
  signalMeta: {
    ...typography.label.sm,
    color: colors.textSecondary,
    letterSpacing: 0.8,
  },
  signalDetails: {
    ...typography.body.sm,
    color: colors.textSecondary,
  },
  helperText: {
    ...typography.body.sm,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xs,
  },
  errorText: {
    ...typography.body.sm,
    color: colors.danger,
    paddingHorizontal: spacing.xs,
  },
});
