import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import type { Take } from "../../../domain/mocap/models/Take";

type Props = {
  status: "idle" | "starting" | "capturing" | "stopping" | "error";
  isRecording: boolean;

  onPing: () => Promise<any>;
  onStartCapture: () => Promise<void>;
  onStopCapture: () => Promise<void>;

  onStartRecord: () => void;
  onStopRecord: () => Promise<Take | void>;
};

export function RecordControls({
  status,
  isRecording,
  onPing,
  onStartCapture,
  onStopCapture,
  onStartRecord,
  onStopRecord,
}: Props) {
  const canStartCapture = status === "idle" || status === "error";
  const canStopCapture = status === "capturing";
  const canRecord = status === "capturing";

  return (
    <View style={styles.row}>
      <Btn label="Ping" onPress={() => void onPing()} />

      <Btn
        label="Start"
        disabled={!canStartCapture}
        onPress={() => void onStartCapture()}
      />
      <Btn
        label="Stop"
        disabled={!canStopCapture}
        onPress={() => void onStopCapture()}
      />

      <View style={{ width: 12 }} />

      {!isRecording ? (
        <Btn
          label="Record"
          disabled={!canRecord}
          onPress={onStartRecord}
          variant="danger"
        />
      ) : (
        <Btn
          label="Stop Rec"
          disabled={!canRecord}
          onPress={() => void onStopRecord()}
          variant="danger"
        />
      )}
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "danger";
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        variant === "danger" && styles.btnDanger,
        disabled && styles.btnDisabled,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#111",
  },
  btnDanger: { backgroundColor: "#7a1023" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "white", fontWeight: "700" },
});
