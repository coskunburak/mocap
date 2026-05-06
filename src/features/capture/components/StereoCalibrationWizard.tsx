/**
 * StereoCalibrationWizard – Step-by-step calibration UI for dual-camera setup.
 *
 * Guides the user through placing two cameras and collecting calibration
 * landmark pairs from both views.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../../ui/components/Button";
import { Card } from "../../../ui/components/Card";
import { colors, radii, spacing, typography } from "../../../ui/theme";
import {
  calibrateStereo,
  type CalibrationSample,
} from "../../../domain/mocap/pipeline/calibration/StereoCalibration";
import type { StereoCalibrationResult } from "../../../domain/mocap/models/MultiViewPoseFrame";
import type { LandmarkBuffer } from "../../../domain/mocap/models/Landmark";

// ─── Types ──────────────────────────────────────────────────────────

type WizardStep = "setup" | "capture_1" | "capture_2" | "capture_3" | "computing" | "done" | "error";

type Props = {
  /** Latest landmarks from Camera A (host) */
  localLandmarks?: LandmarkBuffer;
  /** Latest landmarks from Camera B (guest) */
  remoteLandmarks?: LandmarkBuffer;
  /** Callback when calibration completes */
  onCalibrationComplete: (result: StereoCalibrationResult) => void;
  /** Callback to request calibration data from guest */
  onRequestGuestCapture?: (step: number) => void;
  /** Callback when user cancels */
  onCancel: () => void;
};

// ─── Instructions per step ─────────────────────────────────────────

const STEP_INSTRUCTIONS: Record<string, { title: string; desc: string }> = {
  setup: {
    title: "Position Cameras",
    desc: "Place both phones so they see the same area from different angles (60–120° apart). The subject should be visible from both cameras.",
  },
  capture_1: {
    title: "Capture Pose 1 — A-Pose",
    desc: "Subject: stand in A-pose (arms slightly out, feet apart). Make sure you're fully visible from both cameras. Press Capture when ready.",
  },
  capture_2: {
    title: "Capture Pose 2 — Step Left",
    desc: "Subject: take one step to the left, keep arms slightly out. Press Capture when ready.",
  },
  capture_3: {
    title: "Capture Pose 3 — Step Right",
    desc: "Subject: return to center and take one step to the right. Press Capture when ready.",
  },
  computing: {
    title: "Computing Calibration",
    desc: "Analyzing landmark pairs and computing camera geometry...",
  },
  done: {
    title: "Calibration Complete",
    desc: "Stereo calibration successful! You can now start dual-camera capture.",
  },
  error: {
    title: "Calibration Failed",
    desc: "Not enough matching landmarks were found. Try repositioning the cameras and ensure the subject is fully visible from both views.",
  },
};

// ─── Component ─────────────────────────────────────────────────────

export function StereoCalibrationWizard({
  localLandmarks,
  remoteLandmarks,
  onCalibrationComplete,
  onRequestGuestCapture,
  onCancel,
}: Props) {
  const [step, setStep] = useState<WizardStep>("setup");
  const [samples, setSamples] = useState<CalibrationSample[]>([]);
  const [result, setResult] = useState<StereoCalibrationResult | null>(null);

  const handleCapture = useCallback(() => {
    if (!localLandmarks || !remoteLandmarks) return;

    const sample: CalibrationSample = {
      landmarksA: new Float32Array(localLandmarks),
      landmarksB: new Float32Array(remoteLandmarks),
      ts: Date.now(),
    };

    const newSamples = [...samples, sample];
    setSamples(newSamples);

    // Also request guest to store its capture
    const stepNum = newSamples.length;
    onRequestGuestCapture?.(stepNum);

    // Move to next step
    if (step === "capture_1") {
      setStep("capture_2");
    } else if (step === "capture_2") {
      setStep("capture_3");
    } else if (step === "capture_3") {
      // All samples collected → compute
      setStep("computing");
      computeCalibration(newSamples);
    }
  }, [localLandmarks, remoteLandmarks, samples, step, onRequestGuestCapture]);

  const computeCalibration = useCallback(
    (collectedSamples: CalibrationSample[]) => {
      // Run in next tick to allow UI update
      setTimeout(() => {
        const cal = calibrateStereo(collectedSamples, {
          minConfidence: 0.4,
          minPointPairs: 8,
        });

        if (cal) {
          setResult(cal);
          setStep("done");
          onCalibrationComplete(cal);
        } else {
          setStep("error");
        }
      }, 100);
    },
    [onCalibrationComplete],
  );

  const handleRetry = useCallback(() => {
    setSamples([]);
    setResult(null);
    setStep("setup");
  }, []);

  const info = STEP_INSTRUCTIONS[step] ?? STEP_INSTRUCTIONS.setup;

  const canCapture =
    localLandmarks &&
    remoteLandmarks &&
    localLandmarks.length > 0 &&
    remoteLandmarks.length > 0;

  return (
    <Card tone="accent" padding="md" style={styles.container}>
      {/* Step indicator */}
      <View style={styles.stepRow}>
        {["1", "2", "3"].map((num, idx) => {
          const stepNames: WizardStep[] = ["capture_1", "capture_2", "capture_3"];
          const currentIdx = stepNames.indexOf(step);
          const isCompleted = idx < samples.length;
          const isCurrent = step === stepNames[idx];

          return (
            <View key={num} style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  isCompleted && styles.stepCircleCompleted,
                  isCurrent && styles.stepCircleCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.stepNum,
                    (isCompleted || isCurrent) && styles.stepNumActive,
                  ]}
                >
                  {isCompleted ? "✓" : num}
                </Text>
              </View>
              {idx < 2 && (
                <View
                  style={[
                    styles.stepLine,
                    isCompleted && styles.stepLineCompleted,
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>

      {/* Instructions */}
      <View style={styles.infoBlock}>
        <Text style={styles.infoTitle}>{info.title}</Text>
        <Text style={styles.infoDesc}>{info.desc}</Text>
      </View>

      {/* Quality result */}
      {result && step === "done" && (
        <View style={styles.resultBlock}>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Quality</Text>
            <Text style={styles.resultValue}>
              {Math.round(result.qualityScore * 100)}%
            </Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Convergence</Text>
            <Text style={styles.resultValue}>
              {result.convergenceAngle.toFixed(1)}°
            </Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Points Used</Text>
            <Text style={styles.resultValue}>{result.pointPairsUsed}</Text>
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {step === "setup" && (
          <Button
            label="Begin Calibration"
            variant="primary"
            size="md"
            fullWidth
            onPress={() => setStep("capture_1")}
          />
        )}

        {(step === "capture_1" || step === "capture_2" || step === "capture_3") && (
          <Button
            label="Capture"
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canCapture}
            onPress={handleCapture}
          />
        )}

        {step === "computing" && (
          <Button
            label="Computing..."
            variant="secondary"
            size="md"
            fullWidth
            loading
            disabled
          />
        )}

        {step === "error" && (
          <Button
            label="Retry"
            variant="danger"
            size="md"
            fullWidth
            onPress={handleRetry}
          />
        )}

        {step !== "computing" && (
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            onPress={onCancel}
          />
        )}
      </View>
    </Card>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  stepCircleCompleted: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  stepCircleCurrent: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  stepNum: {
    ...typography.label.sm,
    color: colors.textMuted,
  },
  stepNumActive: {
    color: colors.background,
    fontWeight: "700",
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  stepLineCompleted: {
    backgroundColor: colors.accent,
  },
  infoBlock: {
    gap: spacing.xs,
  },
  infoTitle: {
    ...typography.title.card,
  },
  infoDesc: {
    ...typography.body.md,
    color: colors.textSecondary,
  },
  resultBlock: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultLabel: {
    ...typography.label.sm,
    color: colors.textSecondary,
  },
  resultValue: {
    ...typography.label.md,
    color: colors.accent,
  },
  actions: {
    gap: spacing.sm,
    alignItems: "center",
  },
});
