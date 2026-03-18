import React from "react";
import { StyleSheet, View } from "react-native";
import type { Take } from "../../../domain/mocap/models/Take";
import { Button } from "../../../ui/components/Button";
import { radii, spacing } from "../../../ui/theme";

type Props = {
  status: "idle" | "starting" | "capturing" | "stopping" | "error";
  isRecording: boolean;
  isStoppingRec?: boolean;
  onStartCapture: () => Promise<void>;
  onStopCapture: () => Promise<void>;
  onStartRecord: () => void;
  onStopRecord: () => Promise<Take | void>;
  recordDisabledReason?: string;
};

export function RecordControls({
  status,
  isRecording,
  isStoppingRec,
  onStartCapture,
  onStopCapture,
  onStartRecord,
  onStopRecord,
  recordDisabledReason,
}: Props) {
  const canStartCapture = status === "idle" || status === "error";
  const canStopCapture = status === "capturing" || status === "starting";
  const canRecord = status === "capturing";
  const recordDisabled = isRecording
    ? Boolean(isStoppingRec)
    : !canRecord || isStoppingRec || Boolean(recordDisabledReason);

  return (
    <View style={styles.row}>
      <View style={styles.slot}>
        <Button
          label="Start"
          variant="secondary"
          size="md"
          fullWidth
          disabled={!canStartCapture}
          style={styles.button}
          onPress={() => void onStartCapture()}
        />
      </View>
      <View style={styles.slot}>
        <Button
          label="Stop"
          variant="ghost"
          size="md"
          fullWidth
          disabled={!canStopCapture}
          style={styles.button}
          onPress={() => void onStopCapture()}
        />
      </View>
      <View style={styles.recordSlot}>
        <Button
          label={isRecording ? (isStoppingRec ? "Finishing..." : "Finish") : "Start recording"}
          variant="danger"
          size="md"
          fullWidth
          disabled={recordDisabled}
          style={styles.button}
          onPress={isRecording ? () => void onStopRecord() : onStartRecord}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  slot: {
    flex: 1,
  },
  recordSlot: {
    flex: 1.35,
  },
  button: {
    borderRadius: radii.lg,
    minWidth: 0,
  },
});
