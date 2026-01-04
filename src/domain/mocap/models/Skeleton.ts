// src/domain/mocap/models/Skeleton.ts
import type { JointName, Mp33Index } from "./MediapipePose33";

export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type RigNode = Readonly<{
  name: JointName;
  parent: JointName | null;
  mpIndex: Mp33Index | null; // null => derived joint
}>;

export type Rig = ReadonlyArray<RigNode>;

export type JointPose = Readonly<Record<JointName, Vec3>>;

export type SkeletonDef = Readonly<{
  name: string;
  rig: Rig;
  root: JointName; // usually "Hips"
  // channels order used in BVH output
  eulerOrder: "ZXY" | "XYZ";
}>;

export const DEFAULT_SKELETON: SkeletonDef = {
  name: "MocapExpoRig",
  rig: [] as any, // RIG'i MediapipePose33.ts'den export edip burada set edeceğiz (aşağıda kullanacağız)
  root: "Hips",
  eulerOrder: "ZXY",
};

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function len(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function norm(a: Vec3): Vec3 {
  const l = len(a);
  if (l < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
