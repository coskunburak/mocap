import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import type { LandmarkBuffer } from "../../../domain/mocap/models/Landmark";
import { LANDMARK_STRIDE } from "../../../domain/mocap/models/Landmark";
import { useCaptureStore } from "../state/captureStore";

type Props = {
  width: number;
  height: number;
  landmarks: LandmarkBuffer; // Float32Array (N*4)
};

/**
 * MediaPipe Pose landmark indices (common ones)
 * You can extend this list later.
 */
const BONES: Array<[number, number]> = [
  [11, 13],
  [13, 15], // left arm
  [12, 14],
  [14, 16], // right arm
  [11, 12], // shoulders
  [23, 24], // hips
  [11, 23],
  [12, 24], // torso
  [23, 25],
  [25, 27], // left leg
  [24, 26],
  [26, 28], // right leg
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function confAt(buf: LandmarkBuffer, i: number) {
  const o = i * LANDMARK_STRIDE;
  return buf[o + 3] ?? 0;
}
function xAt(buf: LandmarkBuffer, i: number) {
  return buf[i * LANDMARK_STRIDE] ?? 0;
}
function yAt(buf: LandmarkBuffer, i: number) {
  return buf[i * LANDMARK_STRIDE + 1] ?? 0;
}

export function OverlaySkeleton({ width, height, landmarks }: Props) {
  const { jointThreshold, boneThreshold } = useCaptureStore();

  // Landmark count (N)
  const n = useMemo(
    () => Math.floor(landmarks.length / LANDMARK_STRIDE),
    [landmarks]
  );

  const joints = useMemo(() => {
    if (!width || !height || n === 0) return [];

    const out: Array<{ i: number; x: number; y: number }> = [];
    // iterate joints
    for (let i = 0; i < n; i++) {
      const c = confAt(landmarks, i);
      if (c < jointThreshold) continue;

      const x = clamp01(xAt(landmarks, i)) * width;
      const y = clamp01(yAt(landmarks, i)) * height;

      out.push({ i, x, y });
    }
    return out;
  }, [jointThreshold, landmarks, n, width, height]);

  const bones = useMemo(() => {
    if (!width || !height || n === 0) return [];

    const out: Array<{ ax: number; ay: number; bx: number; by: number }> = [];

    for (const [a, b] of BONES) {
      // safety: if model landmark count differs
      if (a >= n || b >= n) continue;

      const ca = confAt(landmarks, a);
      const cb = confAt(landmarks, b);
      if (ca < boneThreshold || cb < boneThreshold) continue;

      const ax = clamp01(xAt(landmarks, a)) * width;
      const ay = clamp01(yAt(landmarks, a)) * height;
      const bx = clamp01(xAt(landmarks, b)) * width;
      const by = clamp01(yAt(landmarks, b)) * height;

      out.push({ ax, ay, bx, by });
    }

    return out;
  }, [boneThreshold, landmarks, n, width, height]);

  // If no canvas area or no data, don't render
  if (!width || !height || n === 0) return null;

  return (
    <View pointerEvents="none" style={[styles.overlay, { width, height }]}>
      <Svg width={width} height={height}>
        {bones.map((b, idx) => (
          <Line
            key={`bone-${idx}`}
            x1={b.ax}
            y1={b.ay}
            x2={b.bx}
            y2={b.by}
            stroke="rgba(0,255,180,0.9)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}

        {joints.map((j) => (
          <Circle
            key={`joint-${j.i}`}
            cx={j.x}
            cy={j.y}
            r={4}
            fill="rgba(255,255,255,0.95)"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
