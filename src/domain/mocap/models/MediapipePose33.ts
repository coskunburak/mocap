// src/domain/mocap/models/MediapipePose33.ts
import { lmAt, type LandmarkBuffer } from "./Landmark";
import type { Vec3, JointPose } from "./Skeleton";
import { add, mul, sub, v3 } from "./Skeleton";

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

// Production v1 skeleton (rig) – BVH hierarchy için
export type JointName =
  | "Hips"
  | "Spine"
  | "Neck"
  | "Head"
  | "LeftShoulder"
  | "LeftElbow"
  | "LeftWrist"
  | "RightShoulder"
  | "RightElbow"
  | "RightWrist"
  | "LeftHip"
  | "LeftKnee"
  | "LeftAnkle"
  | "RightHip"
  | "RightKnee"
  | "RightAnkle";

export const RIG: ReadonlyArray<{
  name: JointName;
  parent: JointName | null;
  mpIndex: Mp33Index | null; // null => derived joint
}> = [
  { name: "Hips", parent: null, mpIndex: null }, // derived: midpoint(LHIP,RHIP)
  { name: "Spine", parent: "Hips", mpIndex: null }, // derived: between hips & neck
  { name: "Neck", parent: "Spine", mpIndex: null }, // derived: midpoint(LSHO,RSHO)
  { name: "Head", parent: "Neck", mpIndex: MP33.NOSE }, // simple

  { name: "LeftShoulder", parent: "Neck", mpIndex: MP33.LEFT_SHOULDER },
  { name: "LeftElbow", parent: "LeftShoulder", mpIndex: MP33.LEFT_ELBOW },
  { name: "LeftWrist", parent: "LeftElbow", mpIndex: MP33.LEFT_WRIST },

  { name: "RightShoulder", parent: "Neck", mpIndex: MP33.RIGHT_SHOULDER },
  { name: "RightElbow", parent: "RightShoulder", mpIndex: MP33.RIGHT_ELBOW },
  { name: "RightWrist", parent: "RightElbow", mpIndex: MP33.RIGHT_WRIST },

  { name: "LeftHip", parent: "Hips", mpIndex: MP33.LEFT_HIP },
  { name: "LeftKnee", parent: "LeftHip", mpIndex: MP33.LEFT_KNEE },
  { name: "LeftAnkle", parent: "LeftKnee", mpIndex: MP33.LEFT_ANKLE },

  { name: "RightHip", parent: "Hips", mpIndex: MP33.RIGHT_HIP },
  { name: "RightKnee", parent: "RightHip", mpIndex: MP33.RIGHT_KNEE },
  { name: "RightAnkle", parent: "RightKnee", mpIndex: MP33.RIGHT_ANKLE },
] as const;

/**
 * MediaPipe normalized coords -> our world coords (simple v1)
 * - x: center at 0 (x-0.5)
 * - y: invert so up is positive (0.5 - y)
 * - z: invert (mediapipe z often negative towards camera)
 * scale: tune later (default 1.0)
 */
export type MpWorldOptions = {
  scale?: number; // overall scale (BVH units)
};

function mpToWorld(buf: LandmarkBuffer, i: number, opts?: MpWorldOptions): Vec3 {
  const { x, y, z } = lmAt(buf, i);
  const s = opts?.scale ?? 100; // ✅ BVH’de okunur olsun diye 100 öneriyorum (cm gibi düşün)
  return v3((x - 0.5) * s, (0.5 - y) * s, (-z) * s);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return mul(add(a, b), 0.5);
}

/**
 * Produce joint positions for our RIG from one MP33 landmark buffer.
 * Derived joints:
 * - Hips = midpoint(L_HIP, R_HIP)
 * - Neck = midpoint(L_SHO, R_SHO)
 * - Spine = halfway between Hips and Neck
 */
export function mp33ToJointPose(buf: LandmarkBuffer, opts?: MpWorldOptions): JointPose {
  const LHIP = mpToWorld(buf, MP33.LEFT_HIP, opts);
  const RHIP = mpToWorld(buf, MP33.RIGHT_HIP, opts);
  const LSHO = mpToWorld(buf, MP33.LEFT_SHOULDER, opts);
  const RSHO = mpToWorld(buf, MP33.RIGHT_SHOULDER, opts);

  const hips = midpoint(LHIP, RHIP);
  const neck = midpoint(LSHO, RSHO);
  const spine = add(hips, mul(sub(neck, hips), 0.5));

  const head = mpToWorld(buf, MP33.NOSE, opts);

  // direct mapped joints
  const pose: any = {
    Hips: hips,
    Spine: spine,
    Neck: neck,
    Head: head,

    LeftShoulder: mpToWorld(buf, MP33.LEFT_SHOULDER, opts),
    LeftElbow: mpToWorld(buf, MP33.LEFT_ELBOW, opts),
    LeftWrist: mpToWorld(buf, MP33.LEFT_WRIST, opts),

    RightShoulder: mpToWorld(buf, MP33.RIGHT_SHOULDER, opts),
    RightElbow: mpToWorld(buf, MP33.RIGHT_ELBOW, opts),
    RightWrist: mpToWorld(buf, MP33.RIGHT_WRIST, opts),

    LeftHip: mpToWorld(buf, MP33.LEFT_HIP, opts),
    LeftKnee: mpToWorld(buf, MP33.LEFT_KNEE, opts),
    LeftAnkle: mpToWorld(buf, MP33.LEFT_ANKLE, opts),

    RightHip: mpToWorld(buf, MP33.RIGHT_HIP, opts),
    RightKnee: mpToWorld(buf, MP33.RIGHT_KNEE, opts),
    RightAnkle: mpToWorld(buf, MP33.RIGHT_ANKLE, opts),
  };

  return pose as JointPose;
}
