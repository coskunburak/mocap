import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";

let CameraView: typeof import("../components/CameraView").CameraView;
try {
  CameraView = require("../components/CameraView").CameraView;
  // eslint-disable-next-line no-console
  console.log("[Entry] CameraView loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] CameraView failed to load", e);
  throw e;
}

let OverlaySkeleton: typeof import("../components/OverlaySkeleton").OverlaySkeleton;
try {
  OverlaySkeleton = require("../components/OverlaySkeleton").OverlaySkeleton;
  // eslint-disable-next-line no-console
  console.log("[Entry] OverlaySkeleton loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] OverlaySkeleton failed to load", e);
  throw e;
}

let FPSBadge: typeof import("../components/FPSBadge").FPSBadge;
try {
  FPSBadge = require("../components/FPSBadge").FPSBadge;
  // eslint-disable-next-line no-console
  console.log("[Entry] FPSBadge loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] FPSBadge failed to load", e);
  throw e;
}

let useCaptureStore: typeof import("../state/captureStore").useCaptureStore;
try {
  useCaptureStore = require("../state/captureStore").useCaptureStore;
  // eslint-disable-next-line no-console
  console.log("[Entry] useCaptureStore loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] useCaptureStore failed to load", e);
  throw e;
}

let usePoseStream: typeof import("../hooks/usePoseStream").usePoseStream;
try {
  usePoseStream = require("../hooks/usePoseStream").usePoseStream;
  // eslint-disable-next-line no-console
  console.log("[Entry] usePoseStream loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] usePoseStream failed to load", e);
  throw e;
}

let RecordControls: typeof import("../components/RecordControls").RecordControls;
try {
  RecordControls = require("../components/RecordControls").RecordControls;
  // eslint-disable-next-line no-console
  console.log("[Entry] RecordControls loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] RecordControls failed to load", e);
  throw e;
}

export default function CaptureScreen() {
  const { status, error, poseFps, lmCount, lastFrame } = useCaptureStore();
  const [size, setSize] = useState({ w: 0, h: 0 });

  const {
    ping,
    startCapture,
    stopCapture,
    recorderState,
    startRecording,
    stopRecording,
  } = usePoseStream(); // <-- artık arg yok, istersen usePoseStream((f)=>{}) da olur

  const landmarks = useMemo(
    () => lastFrame?.landmarks ?? new Float32Array(),
    [lastFrame]
  );

  const isRecording =
    recorderState.status === "recording" || recorderState.status === "stopping";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Capture</Text>

      <Text style={styles.debug}>
        status={status} lm={lmCount} | poseFps={poseFps.toFixed(1)}
        {isRecording
          ? ` | REC buffered=${(recorderState as any).buffered ?? 0} chunks=${(recorderState as any).flushedChunks ?? 0}`
          : ""}
        {error ? ` | error=${error}` : ""}
      </Text>

      <View style={styles.previewWrap}>
        <CameraView onLayoutSize={(w, h) => setSize({ w, h })} />
        <OverlaySkeleton width={size.w} height={size.h} landmarks={landmarks} />
        <FPSBadge poseFps={poseFps} />
      </View>

      <RecordControls
        status={status}
        isRecording={isRecording}
        onPing={ping}
        onStartCapture={startCapture}
        onStopCapture={stopCapture}
        onStartRecord={() => startRecording({ takeName: `Take ${new Date().toLocaleTimeString()}` })}
        onStopRecord={stopRecording}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 34, fontWeight: "800" },
  debug: { color: "#555" },
  previewWrap: { flex: 1, borderRadius: 18, overflow: "hidden" },
  error: { color: "crimson", marginTop: 8 },
});
