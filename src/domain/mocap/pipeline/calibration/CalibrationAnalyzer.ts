import { lmAt } from "../../models/Landmark";
import { MP33 } from "../../models/MediapipePose33";
import type { PoseFrame } from "../../models/PoseFrame";
import type { CalibrationPose, TakeCalibration } from "../../models/Take";
import { clamp } from "../../models/Skeleton";

const CORE_VISIBILITY = [
  MP33.LEFT_SHOULDER,
  MP33.RIGHT_SHOULDER,
  MP33.LEFT_HIP,
  MP33.RIGHT_HIP,
  MP33.LEFT_ANKLE,
  MP33.RIGHT_ANKLE,
] as const;

type StepKey = keyof TakeCalibration["stepScores"];

export type CalibrationAnalysis = TakeCalibration & {
  suggestions: string[];
  targetDistanceRange: readonly [number, number];
};

function avg(values: readonly number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lerpScore(
  value: number,
  idealMin: number,
  idealMax: number,
  hardMin: number,
  hardMax: number,
) {
  if (value >= idealMin && value <= idealMax) return 1;
  if (value <= hardMin || value >= hardMax) return 0;
  if (value < idealMin) return clamp((value - hardMin) / (idealMin - hardMin), 0, 1);
  return clamp((hardMax - value) / (hardMax - idealMax), 0, 1);
}

function visibility(buf: PoseFrame["landmarks"]) {
  return avg(CORE_VISIBILITY.map((index) => clamp(lmAt(buf, index).c, 0, 1)));
}

function estimateDistance(frame: PoseFrame) {
  const world = frame.worldLandmarks;
  if (world) {
    const depth = avg([
      Math.abs(lmAt(world, MP33.LEFT_SHOULDER).z),
      Math.abs(lmAt(world, MP33.RIGHT_SHOULDER).z),
      Math.abs(lmAt(world, MP33.LEFT_HIP).z),
      Math.abs(lmAt(world, MP33.RIGHT_HIP).z),
    ]);
    if (Number.isFinite(depth) && depth > 0) {
      return depth;
    }
  }

  const nose = lmAt(frame.landmarks, MP33.NOSE);
  const leftAnkle = lmAt(frame.landmarks, MP33.LEFT_ANKLE);
  const rightAnkle = lmAt(frame.landmarks, MP33.RIGHT_ANKLE);
  const bodyHeight = Math.max(0.001, avg([leftAnkle.y, rightAnkle.y]) - nose.y);
  return 1 / bodyHeight;
}

function analyzeCamera(frame: PoseFrame) {
  const leftShoulder = lmAt(frame.landmarks, MP33.LEFT_SHOULDER);
  const rightShoulder = lmAt(frame.landmarks, MP33.RIGHT_SHOULDER);
  const leftHip = lmAt(frame.landmarks, MP33.LEFT_HIP);
  const rightHip = lmAt(frame.landmarks, MP33.RIGHT_HIP);

  const centerX = avg([
    leftShoulder.x,
    rightShoulder.x,
    leftHip.x,
    rightHip.x,
  ]);
  const shoulderLevel = Math.abs(leftShoulder.y - rightShoulder.y);
  const hipLevel = Math.abs(leftHip.y - rightHip.y);

  const centered = lerpScore(Math.abs(centerX - 0.5), 0, 0.03, 0, 0.16);
  const shouldersFlat = lerpScore(shoulderLevel, 0, 0.015, 0, 0.08);
  const hipsFlat = lerpScore(hipLevel, 0, 0.02, 0, 0.1);

  return avg([centered, shouldersFlat, hipsFlat, visibility(frame.landmarks)]);
}

function analyzeDistance(frame: PoseFrame) {
  const nose = lmAt(frame.landmarks, MP33.NOSE);
  const leftAnkle = lmAt(frame.landmarks, MP33.LEFT_ANKLE);
  const rightAnkle = lmAt(frame.landmarks, MP33.RIGHT_ANKLE);
  const leftShoulder = lmAt(frame.landmarks, MP33.LEFT_SHOULDER);
  const rightShoulder = lmAt(frame.landmarks, MP33.RIGHT_SHOULDER);

  const bodyHeight = avg([leftAnkle.y, rightAnkle.y]) - nose.y;
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);

  const bodyFill = lerpScore(bodyHeight, 0.58, 0.84, 0.42, 0.96);
  const shoulderFill = lerpScore(shoulderWidth, 0.18, 0.3, 0.11, 0.42);
  return avg([bodyFill, shoulderFill, visibility(frame.landmarks)]);
}

function armAngleScore(frame: PoseFrame, targetPose: CalibrationPose) {
  const leftShoulder = lmAt(frame.landmarks, MP33.LEFT_SHOULDER);
  const rightShoulder = lmAt(frame.landmarks, MP33.RIGHT_SHOULDER);
  const leftWrist = lmAt(frame.landmarks, MP33.LEFT_WRIST);
  const rightWrist = lmAt(frame.landmarks, MP33.RIGHT_WRIST);

  const leftAngle =
    (Math.atan2(Math.abs(leftWrist.y - leftShoulder.y), Math.abs(leftWrist.x - leftShoulder.x)) *
      180) /
    Math.PI;
  const rightAngle =
    (Math.atan2(
      Math.abs(rightWrist.y - rightShoulder.y),
      Math.abs(rightWrist.x - rightShoulder.x),
    ) *
      180) /
    Math.PI;

  const target = targetPose === "t-pose" ? 6 : 34;
  const tolerance = targetPose === "t-pose" ? 18 : 24;
  const symmetryPenalty = clamp(Math.abs(leftAngle - rightAngle) / 30, 0, 1);

  const leftScore = 1 - clamp(Math.abs(leftAngle - target) / tolerance, 0, 1);
  const rightScore = 1 - clamp(Math.abs(rightAngle - target) / tolerance, 0, 1);

  return clamp(avg([leftScore, rightScore]) * (1 - symmetryPenalty * 0.35), 0, 1);
}

function analyzeGround(frame: PoseFrame) {
  const leftAnkle = lmAt(frame.landmarks, MP33.LEFT_ANKLE);
  const rightAnkle = lmAt(frame.landmarks, MP33.RIGHT_ANKLE);
  const leftFoot = lmAt(frame.landmarks, MP33.LEFT_FOOT_INDEX);
  const rightFoot = lmAt(frame.landmarks, MP33.RIGHT_FOOT_INDEX);

  const footLevel = lerpScore(Math.abs(leftAnkle.y - rightAnkle.y), 0, 0.02, 0, 0.08);
  const footPlacement = lerpScore(avg([leftFoot.y, rightFoot.y]), 0.8, 0.98, 0.68, 1.04);
  const footVisibility = avg([leftFoot.c, rightFoot.c, leftAnkle.c, rightAnkle.c]);

  return avg([footLevel, footPlacement, clamp(footVisibility, 0, 1)]);
}

function buildSuggestions(stepScores: TakeCalibration["stepScores"], targetPose: CalibrationPose, measuredDistance: number) {
  const suggestions: string[] = [];

  if (stepScores.camera < 0.72) {
    suggestions.push("Center your torso and level both shoulders before recording.");
  }
  if (stepScores.distance < 0.72) {
    suggestions.push(
      measuredDistance > 1.6
        ? "Step slightly closer so the full body fills more of the frame."
        : "Step back a little to keep the feet and wrists fully visible.",
    );
  }
  if (stepScores.pose < 0.72) {
    suggestions.push(
      targetPose === "t-pose"
        ? "Hold a clean T-pose with both wrists opened to shoulder height."
        : "Hold a relaxed A-pose with both elbows extended and symmetric.",
    );
  }
  if (stepScores.ground < 0.72) {
    suggestions.push("Keep both feet flat on the floor and make sure the ankles stay visible.");
  }

  return suggestions;
}

export function analyzeCalibration(
  frames: readonly PoseFrame[],
  targetPose: CalibrationPose = "a-pose",
): CalibrationAnalysis {
  const usable = frames.filter((frame) => frame.landmarks.length >= 33 * 4).slice(-18);
  const measuredDistance = usable.length
    ? avg(usable.map((frame) => estimateDistance(frame)))
    : 0;

  const stepScores: TakeCalibration["stepScores"] = {
    camera: usable.length ? avg(usable.map((frame) => analyzeCamera(frame))) : 0,
    distance: usable.length ? avg(usable.map((frame) => analyzeDistance(frame))) : 0,
    pose: usable.length ? avg(usable.map((frame) => armAngleScore(frame, targetPose))) : 0,
    ground: usable.length ? avg(usable.map((frame) => analyzeGround(frame))) : 0,
  };

  const readinessScore =
    stepScores.camera * 0.24 +
    stepScores.distance * 0.24 +
    stepScores.pose * 0.34 +
    stepScores.ground * 0.18;
  const suggestions = buildSuggestions(stepScores, targetPose, measuredDistance);

  return {
    status:
      usable.length >= 8 &&
      readinessScore >= 0.78 &&
      stepScores.camera >= 0.72 &&
      stepScores.distance >= 0.72 &&
      stepScores.pose >= 0.7 &&
      stepScores.ground >= 0.68
        ? "ready"
        : "pending",
    readinessScore,
    targetPose,
    issues: suggestions,
    suggestions,
    measuredDistance,
    targetDistanceRange: [0.9, 1.6],
    stepScores,
    calibratedAt: usable[usable.length - 1]?.ts ?? Date.now(),
  };
}

export function formatCalibrationDistance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "estimating";
  if (value >= 0.2 && value <= 4) return `${value.toFixed(2)} m`;
  return `${value.toFixed(2)} depth`;
}
