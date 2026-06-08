import type { LandmarkBuffer } from "../../models/Landmark";
import { LANDMARK_STRIDE } from "../../models/Landmark";
import type { PoseFrame } from "../../models/PoseFrame";

export type ProjectedPoint = Readonly<{
  x: number;
  y: number;
  visible: boolean;
}>;

export type PoseFrameQuality = Readonly<{
  reliable: boolean;
  reason?: PoseFrameQualityFailureReason;
  trackedCount: number;
  averageConfidence: number;
  coreConfidence: number;
  torsoVerticality: number;
  torsoArea: number;
}>;

export type PoseFrameQualityFailureReason =
  | "pose_landmarks_missing"
  | "body_landmark_coverage_low"
  | "core_landmarks_low_confidence"
  | "torso_scale_invalid"
  | "torso_orientation_unstable";

const CORE_JOINTS = [11, 12, 23, 24] as const;
const BODY_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
const EPS = 1e-6;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function landmarkCount(buf?: LandmarkBuffer) {
  return buf ? Math.floor(buf.length / LANDMARK_STRIDE) : 0;
}

function landmark(buf: LandmarkBuffer, index: number) {
  const offset = index * LANDMARK_STRIDE;
  return {
    x: finite(buf[offset]) ? buf[offset] : 0,
    y: finite(buf[offset + 1]) ? buf[offset + 1] : 0,
    confidence: finite(buf[offset + 3]) ? buf[offset + 3] : 0,
  };
}

export function averagePoseConfidence(
  landmarks: LandmarkBuffer | undefined,
  indices: readonly number[] = BODY_JOINTS,
) {
  if (!landmarks) return 0;

  let total = 0;
  let samples = 0;
  const count = landmarkCount(landmarks);
  for (const index of indices) {
    if (index >= count) continue;
    total += landmark(landmarks, index).confidence;
    samples++;
  }

  return samples > 0 ? total / samples : 0;
}

export function trackedPoseLandmarkCount(
  landmarks: LandmarkBuffer | undefined,
  minConfidence = 0.3,
  indices: readonly number[] = BODY_JOINTS,
) {
  if (!landmarks) return 0;

  let tracked = 0;
  const count = landmarkCount(landmarks);
  for (const index of indices) {
    if (index >= count) continue;
    if (landmark(landmarks, index).confidence >= minConfidence) tracked++;
  }

  return tracked;
}

export function evaluatePoseFrameQuality(frame?: PoseFrame): PoseFrameQuality {
  const landmarks = frame?.landmarks;
  if (!landmarks || landmarkCount(landmarks) < 29) {
    return {
      reliable: false,
      reason: "pose_landmarks_missing",
      trackedCount: 0,
      averageConfidence: 0,
      coreConfidence: 0,
      torsoVerticality: 0,
      torsoArea: 0,
    };
  }

  const trackedCount = trackedPoseLandmarkCount(landmarks);
  const averageConfidence = averagePoseConfidence(landmarks);
  const coreConfidence = averagePoseConfidence(landmarks, CORE_JOINTS);

  const leftShoulder = landmark(landmarks, 11);
  const rightShoulder = landmark(landmarks, 12);
  const leftHip = landmark(landmarks, 23);
  const rightHip = landmark(landmarks, 24);
  const midShoulder = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
  const midHip = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
  };
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  const hipWidth = Math.abs(rightHip.x - leftHip.x);
  const torsoHeight = Math.abs(midHip.y - midShoulder.y);
  const torsoWidth = Math.max(shoulderWidth, hipWidth, EPS);
  const torsoVerticality = torsoHeight / torsoWidth;
  const torsoArea = torsoWidth * torsoHeight;

  if (trackedCount < 8) {
    return {
      reliable: false,
      reason: "body_landmark_coverage_low",
      trackedCount,
      averageConfidence,
      coreConfidence,
      torsoVerticality,
      torsoArea,
    };
  }

  if (coreConfidence < 0.28) {
    return {
      reliable: false,
      reason: "core_landmarks_low_confidence",
      trackedCount,
      averageConfidence,
      coreConfidence,
      torsoVerticality,
      torsoArea,
    };
  }

  if (torsoArea < 0.006 || torsoArea > 0.45) {
    return {
      reliable: false,
      reason: "torso_scale_invalid",
      trackedCount,
      averageConfidence,
      coreConfidence,
      torsoVerticality,
      torsoArea,
    };
  }

  if (torsoVerticality < 0.45) {
    return {
      reliable: false,
      reason: "torso_orientation_unstable",
      trackedCount,
      averageConfidence,
      coreConfidence,
      torsoVerticality,
      torsoArea,
    };
  }

  return {
    reliable: true,
    trackedCount,
    averageConfidence,
    coreConfidence,
    torsoVerticality,
    torsoArea,
  };
}

export function poseQualityHint(quality: PoseFrameQuality) {
  switch (quality.reason) {
    case "pose_landmarks_missing":
      return "Subject pose not detected. Keep the full body visible.";
    case "body_landmark_coverage_low":
      return "Not enough body landmarks. Step back and keep limbs visible.";
    case "core_landmarks_low_confidence":
      return "Torso tracking confidence is low. Improve light and framing.";
    case "torso_scale_invalid":
      return "Subject scale is unstable. Keep the full body inside frame.";
    case "torso_orientation_unstable":
      return "Pose orientation is unstable. Keep the phone upright and subject vertical.";
    default:
      return "Ready to record. Dual-camera pose is stable.";
  }
}

export function projectNormalizedPointToView(
  x: number,
  y: number,
  frame: Pick<PoseFrame, "imageWidth" | "imageHeight" | "coordinateSpace"> | undefined,
  viewWidth: number,
  viewHeight: number,
): ProjectedPoint {
  const normalizedX = clamp01(x);
  const normalizedY = clamp01(y);

  if (
    !frame ||
    frame.coordinateSpace === "preview_normalized" ||
    !finite(frame.imageWidth) ||
    !finite(frame.imageHeight) ||
    frame.imageWidth <= 0 ||
    frame.imageHeight <= 0 ||
    viewWidth <= 0 ||
    viewHeight <= 0
  ) {
    return {
      x: normalizedX * viewWidth,
      y: normalizedY * viewHeight,
      visible: true,
    };
  }

  const scale = Math.max(viewWidth / frame.imageWidth, viewHeight / frame.imageHeight);
  const drawnWidth = frame.imageWidth * scale;
  const drawnHeight = frame.imageHeight * scale;
  const offsetX = (viewWidth - drawnWidth) / 2;
  const offsetY = (viewHeight - drawnHeight) / 2;
  const px = normalizedX * frame.imageWidth * scale + offsetX;
  const py = normalizedY * frame.imageHeight * scale + offsetY;

  return {
    x: px,
    y: py,
    visible: px >= -1 && px <= viewWidth + 1 && py >= -1 && py <= viewHeight + 1,
  };
}
