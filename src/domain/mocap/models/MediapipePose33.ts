import { lmAt, type LandmarkBuffer } from "./Landmark";
import type { Vec3, JointPose } from "./Skeleton";
import { add, clamp, mul, sub, v3 } from "./Skeleton";

// MediaPipe Pose 33 landmark indices
export const MP33 = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,

  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,

  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type Mp33Index = (typeof MP33)[keyof typeof MP33];

export type JointName =
  | "Hips"
  | "Spine"
  | "Chest"
  | "Neck"
  | "Head"
  | "LeftShoulder"
  | "LeftUpperArm"
  | "LeftLowerArm"
  | "LeftHand"
  | "RightShoulder"
  | "RightUpperArm"
  | "RightLowerArm"
  | "RightHand"
  | "LeftUpperLeg"
  | "LeftLowerLeg"
  | "LeftFoot"
  | "LeftToes"
  | "RightUpperLeg"
  | "RightLowerLeg"
  | "RightFoot"
  | "RightToes";

export const RIG: ReadonlyArray<{
  name: JointName;
  parent: JointName | null;
  mpIndex: Mp33Index | null; // null => derived joint
}> = [
  { name: "Hips", parent: null, mpIndex: null },
  { name: "Spine", parent: "Hips", mpIndex: null },
  { name: "Chest", parent: "Spine", mpIndex: null },
  { name: "Neck", parent: "Chest", mpIndex: null },
  { name: "Head", parent: "Neck", mpIndex: null },

  { name: "LeftShoulder", parent: "Chest", mpIndex: null },
  { name: "LeftUpperArm", parent: "LeftShoulder", mpIndex: MP33.LEFT_SHOULDER },
  { name: "LeftLowerArm", parent: "LeftUpperArm", mpIndex: MP33.LEFT_ELBOW },
  { name: "LeftHand", parent: "LeftLowerArm", mpIndex: MP33.LEFT_WRIST },

  { name: "RightShoulder", parent: "Chest", mpIndex: null },
  { name: "RightUpperArm", parent: "RightShoulder", mpIndex: MP33.RIGHT_SHOULDER },
  { name: "RightLowerArm", parent: "RightUpperArm", mpIndex: MP33.RIGHT_ELBOW },
  { name: "RightHand", parent: "RightLowerArm", mpIndex: MP33.RIGHT_WRIST },

  { name: "LeftUpperLeg", parent: "Hips", mpIndex: MP33.LEFT_HIP },
  { name: "LeftLowerLeg", parent: "LeftUpperLeg", mpIndex: MP33.LEFT_KNEE },
  { name: "LeftFoot", parent: "LeftLowerLeg", mpIndex: MP33.LEFT_ANKLE },
  { name: "LeftToes", parent: "LeftFoot", mpIndex: MP33.LEFT_FOOT_INDEX },

  { name: "RightUpperLeg", parent: "Hips", mpIndex: MP33.RIGHT_HIP },
  { name: "RightLowerLeg", parent: "RightUpperLeg", mpIndex: MP33.RIGHT_KNEE },
  { name: "RightFoot", parent: "RightLowerLeg", mpIndex: MP33.RIGHT_ANKLE },
  { name: "RightToes", parent: "RightFoot", mpIndex: MP33.RIGHT_FOOT_INDEX },
] as const;

export const RIG_ROOT: JointName = "Hips";

export const JOINT_NAMES = RIG.map((node) => node.name) as readonly JointName[];

export function parentOf(name: JointName): JointName | null {
  return RIG.find((node) => node.name === name)?.parent ?? null;
}

export function childrenOf(name: JointName): JointName[] {
  return RIG.filter((node) => node.parent === name).map((node) => node.name);
}

/**
 * MediaPipe normalized coords -> our world coords (simple v1)
 * - x: center at 0 (x-0.5)
 * - y: invert so up is positive (0.5 - y)
 * - z: invert (mediapipe z often negative towards camera)
 * scale: tune later (default 1.0)
 */
export type MpWorldOptions = {
  scale?: number; // overall scale (BVH units)
  space?: "normalized" | "world";
};

function normalizedToRig(buf: LandmarkBuffer, i: number, opts?: MpWorldOptions): Vec3 {
  const { x, y, z } = lmAt(buf, i);
  const s = opts?.scale ?? 100; // ✅ BVH’de okunur olsun diye 100 öneriyorum (cm gibi düşün)
  return v3((x - 0.5) * s, (0.5 - y) * s, (-z) * s);
}

function worldToRig(buf: LandmarkBuffer, i: number, opts?: MpWorldOptions): Vec3 {
  const { x, y, z } = lmAt(buf, i);
  const s = opts?.scale ?? 100;
  return v3(x * s, -y * s, -z * s);
}

function mpToWorld(buf: LandmarkBuffer, i: number, opts?: MpWorldOptions): Vec3 {
  if (opts?.space === "world") {
    return worldToRig(buf, i, opts);
  }
  return normalizedToRig(buf, i, opts);
}

export function mpLandmarkToRig(
  buf: LandmarkBuffer,
  index: number,
  opts?: MpWorldOptions,
): Vec3 {
  return mpToWorld(buf, index, opts);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return mul(add(a, b), 0.5);
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, mul(sub(b, a), t));
}

function pointWithWeight(
  buf: LandmarkBuffer,
  index: number,
  opts: MpWorldOptions | undefined,
  baseWeight = 1,
  minConfidence = 0.05,
) {
  const confidence = clamp(lmAt(buf, index).c ?? 0, 0, 1);
  if (confidence < minConfidence) {
    return null;
  }
  return {
    point: mpToWorld(buf, index, opts),
    weight: confidence * baseWeight,
  };
}

function weightedAverage(
  samples: Array<{ point: Vec3; weight: number } | null>,
  fallback: Vec3,
): Vec3 {
  let totalWeight = 0;
  let sum = v3(0, 0, 0);

  for (const sample of samples) {
    if (!sample || sample.weight <= 0) {
      continue;
    }
    totalWeight += sample.weight;
    sum = add(sum, mul(sample.point, sample.weight));
  }

  if (totalWeight <= 0) {
    return fallback;
  }

  return mul(sum, 1 / totalWeight);
}

/**
 */
export function mp33ToJointPose(buf: LandmarkBuffer, opts?: MpWorldOptions): JointPose {
  const leftUpperLeg = mpToWorld(buf, MP33.LEFT_HIP, opts);
  const rightUpperLeg = mpToWorld(buf, MP33.RIGHT_HIP, opts);
  const leftUpperArm = mpToWorld(buf, MP33.LEFT_SHOULDER, opts);
  const rightUpperArm = mpToWorld(buf, MP33.RIGHT_SHOULDER, opts);

  const hips = midpoint(leftUpperLeg, rightUpperLeg);
  const neck = midpoint(leftUpperArm, rightUpperArm);
  const spine = lerp(hips, neck, 0.35);
  const chest = lerp(hips, neck, 0.7);

  const headFallback = add(neck, mul(sub(neck, chest), 0.9));
  const head = weightedAverage(
    [
      pointWithWeight(buf, MP33.NOSE, opts, 0.7),
      pointWithWeight(buf, MP33.LEFT_EAR, opts, 0.15),
      pointWithWeight(buf, MP33.RIGHT_EAR, opts, 0.15),
    ],
    headFallback,
  );

  const leftShoulder = lerp(chest, leftUpperArm, 0.6);
  const rightShoulder = lerp(chest, rightUpperArm, 0.6);
  const leftLowerArm = mpToWorld(buf, MP33.LEFT_ELBOW, opts);
  const rightLowerArm = mpToWorld(buf, MP33.RIGHT_ELBOW, opts);
  const leftHand = mpToWorld(buf, MP33.LEFT_WRIST, opts);
  const rightHand = mpToWorld(buf, MP33.RIGHT_WRIST, opts);

  const leftLowerLeg = mpToWorld(buf, MP33.LEFT_KNEE, opts);
  const rightLowerLeg = mpToWorld(buf, MP33.RIGHT_KNEE, opts);
  const leftFoot = mpToWorld(buf, MP33.LEFT_ANKLE, opts);
  const rightFoot = mpToWorld(buf, MP33.RIGHT_ANKLE, opts);
  const leftToes = weightedAverage(
    [pointWithWeight(buf, MP33.LEFT_FOOT_INDEX, opts, 1)],
    leftFoot,
  );
  const rightToes = weightedAverage(
    [pointWithWeight(buf, MP33.RIGHT_FOOT_INDEX, opts, 1)],
    rightFoot,
  );

  const pose: Record<JointName, Vec3> = {
    Hips: hips,
    Spine: spine,
    Chest: chest,
    Neck: neck,
    Head: head,

    LeftShoulder: leftShoulder,
    LeftUpperArm: leftUpperArm,
    LeftLowerArm: leftLowerArm,
    LeftHand: leftHand,

    RightShoulder: rightShoulder,
    RightUpperArm: rightUpperArm,
    RightLowerArm: rightLowerArm,
    RightHand: rightHand,

    LeftUpperLeg: leftUpperLeg,
    LeftLowerLeg: leftLowerLeg,
    LeftFoot: leftFoot,
    LeftToes: leftToes,

    RightUpperLeg: rightUpperLeg,
    RightLowerLeg: rightLowerLeg,
    RightFoot: rightFoot,
    RightToes: rightToes,
  };

  return pose;
}
