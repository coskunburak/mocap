import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import type { LandmarkBuffer } from "../../../domain/mocap/models/Landmark";
import { LANDMARK_STRIDE } from "../../../domain/mocap/models/Landmark";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import { useCaptureStore } from "../state/captureStore";
import { colors } from "../../../ui/theme";

type Props = {
  width: number;
  height: number;
  frame?: PoseFrame;
};

const POSE_BONES: Array<[number, number]> = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 12],
  [23, 24],
  [11, 23],
  [12, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

const HAND_BONES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const FACE_CONTOURS: number[][] = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152],
  [152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  [336, 296, 334, 293, 300, 285, 295, 282, 283, 276],
  [33, 7, 163, 144, 145, 153, 154, 155, 133],
  [362, 382, 381, 380, 374, 373, 390, 249, 263],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const FACE_STROKE = "#FFB071";
const LEFT_HAND_STROKE = "#67E8F9";
const RIGHT_HAND_STROKE = "#7CFFB2";

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

function count(buf?: LandmarkBuffer) {
  return buf ? Math.floor(buf.length / LANDMARK_STRIDE) : 0;
}

function projectJoint(
  landmarks: LandmarkBuffer | undefined,
  index: number,
  width: number,
  height: number,
  threshold: number,
) {
  if (!landmarks || index >= count(landmarks)) return null;

  const confidence = confAt(landmarks, index);
  if (confidence < threshold) return null;

  return {
    x: clamp01(xAt(landmarks, index)) * width,
    y: clamp01(yAt(landmarks, index)) * height,
  };
}

function buildSegments(
  landmarks: LandmarkBuffer | undefined,
  width: number,
  height: number,
  threshold: number,
  connections: Array<[number, number]>,
) {
  if (!landmarks || !width || !height) return [];

  const out: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (const [a, b] of connections) {
    const start = projectJoint(landmarks, a, width, height, threshold);
    const end = projectJoint(landmarks, b, width, height, threshold);
    if (!start || !end) continue;
    out.push({ ax: start.x, ay: start.y, bx: end.x, by: end.y });
  }

  return out;
}

function buildPolyline(
  landmarks: LandmarkBuffer | undefined,
  width: number,
  height: number,
  threshold: number,
  indices: number[],
) {
  if (!landmarks || !width || !height) return null;

  const points: string[] = [];
  for (const index of indices) {
    const point = projectJoint(landmarks, index, width, height, threshold);
    if (!point) return null;
    points.push(`${point.x},${point.y}`);
  }

  return points.join(" ");
}

function buildPoints(
  landmarks: LandmarkBuffer | undefined,
  width: number,
  height: number,
  threshold: number,
  indices?: number[],
) {
  if (!landmarks || !width || !height) return [];

  const targetIndices = indices ?? Array.from({ length: count(landmarks) }, (_, index) => index);
  const out: Array<{ i: number; x: number; y: number }> = [];

  for (const index of targetIndices) {
    const point = projectJoint(landmarks, index, width, height, threshold);
    if (!point) continue;
    out.push({ i: index, x: point.x, y: point.y });
  }

  return out;
}

export function OverlaySkeleton({ width, height, frame }: Props) {
  const { jointThreshold, boneThreshold } = useCaptureStore();
  const bodyLandmarks = frame?.landmarks;
  const faceLandmarks = frame?.faceLandmarks;
  const leftHandLandmarks = frame?.leftHandLandmarks;
  const rightHandLandmarks = frame?.rightHandLandmarks;

  const n = useMemo(() => count(bodyLandmarks), [bodyLandmarks]);
  const faceThreshold = Math.max(0.18, jointThreshold * 0.5);
  const handThreshold = Math.max(0.22, jointThreshold * 0.65);

  const poseJoints = useMemo(
    () => buildPoints(bodyLandmarks, width, height, jointThreshold),
    [jointThreshold, bodyLandmarks, width, height],
  );

  const poseBones = useMemo(
    () => buildSegments(bodyLandmarks, width, height, boneThreshold, POSE_BONES),
    [boneThreshold, bodyLandmarks, width, height],
  );
  const faceContours = useMemo(
    () =>
      FACE_CONTOURS.map((indices) =>
        buildPolyline(faceLandmarks, width, height, faceThreshold, indices),
      ).filter(Boolean) as string[],
    [faceLandmarks, faceThreshold, height, width],
  );
  const leftHandBones = useMemo(
    () => buildSegments(leftHandLandmarks, width, height, handThreshold, HAND_BONES),
    [handThreshold, height, leftHandLandmarks, width],
  );
  const rightHandBones = useMemo(
    () => buildSegments(rightHandLandmarks, width, height, handThreshold, HAND_BONES),
    [handThreshold, height, rightHandLandmarks, width],
  );
  const leftHandTips = useMemo(
    () => buildPoints(leftHandLandmarks, width, height, handThreshold, [4, 8, 12, 16, 20]),
    [handThreshold, height, leftHandLandmarks, width],
  );
  const rightHandTips = useMemo(
    () => buildPoints(rightHandLandmarks, width, height, handThreshold, [4, 8, 12, 16, 20]),
    [handThreshold, height, rightHandLandmarks, width],
  );
  const handBridges = useMemo(() => {
    const out: Array<{ ax: number; ay: number; bx: number; by: number; stroke: string }> = [];

    const bodyLeftWrist = projectJoint(bodyLandmarks, 15, width, height, boneThreshold);
    const bodyRightWrist = projectJoint(bodyLandmarks, 16, width, height, boneThreshold);
    const leftPalm = projectJoint(leftHandLandmarks, 0, width, height, handThreshold);
    const rightPalm = projectJoint(rightHandLandmarks, 0, width, height, handThreshold);

    if (bodyLeftWrist && leftPalm) {
      out.push({
        ax: bodyLeftWrist.x,
        ay: bodyLeftWrist.y,
        bx: leftPalm.x,
        by: leftPalm.y,
        stroke: LEFT_HAND_STROKE,
      });
    }

    if (bodyRightWrist && rightPalm) {
      out.push({
        ax: bodyRightWrist.x,
        ay: bodyRightWrist.y,
        bx: rightPalm.x,
        by: rightPalm.y,
        stroke: RIGHT_HAND_STROKE,
      });
    }

    return out;
  }, [
    boneThreshold,
    handThreshold,
    height,
    leftHandLandmarks,
    bodyLandmarks,
    rightHandLandmarks,
    width,
  ]);

  if (!width || !height || (n === 0 && !faceLandmarks && !leftHandLandmarks && !rightHandLandmarks)) {
    return null;
  }

  return (
    <View pointerEvents="none" style={[styles.overlay, { width, height }]}>
      <Svg width={width} height={height}>
        {faceContours.map((points, idx) => (
          <Polyline
            key={`face-${idx}`}
            points={points}
            fill="none"
            stroke={FACE_STROKE}
            strokeOpacity={0.64}
            strokeWidth={1.35}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {poseBones.map((b, idx) => (
          <Line
            key={`pose-bone-${idx}`}
            x1={b.ax}
            y1={b.ay}
            x2={b.bx}
            y2={b.by}
            stroke={colors.accent}
            strokeOpacity={0.92}
            strokeWidth={3.4}
            strokeLinecap="round"
          />
        ))}

        {leftHandBones.map((b, idx) => (
          <Line
            key={`left-hand-${idx}`}
            x1={b.ax}
            y1={b.ay}
            x2={b.bx}
            y2={b.by}
            stroke={LEFT_HAND_STROKE}
            strokeOpacity={0.94}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        ))}

        {rightHandBones.map((b, idx) => (
          <Line
            key={`right-hand-${idx}`}
            x1={b.ax}
            y1={b.ay}
            x2={b.bx}
            y2={b.by}
            stroke={RIGHT_HAND_STROKE}
            strokeOpacity={0.94}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        ))}

        {handBridges.map((b, idx) => (
          <Line
            key={`bridge-${idx}`}
            x1={b.ax}
            y1={b.ay}
            x2={b.bx}
            y2={b.by}
            stroke={b.stroke}
            strokeOpacity={0.88}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}

        {poseJoints.map((j) => (
          <Circle
            key={`pose-joint-${j.i}`}
            cx={j.x}
            cy={j.y}
            r={4.2}
            fill={colors.white}
            fillOpacity={0.96}
          />
        ))}

        {leftHandTips.map((j) => (
          <Circle
            key={`left-tip-${j.i}`}
            cx={j.x}
            cy={j.y}
            r={3.2}
            fill={LEFT_HAND_STROKE}
            fillOpacity={0.98}
          />
        ))}

        {rightHandTips.map((j) => (
          <Circle
            key={`right-tip-${j.i}`}
            cx={j.x}
            cy={j.y}
            r={3.2}
            fill={RIGHT_HAND_STROKE}
            fillOpacity={0.98}
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
