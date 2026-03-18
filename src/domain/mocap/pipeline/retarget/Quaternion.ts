import type { Vec3 } from "../../models/Skeleton";
import { clamp, cross, dot, len, norm, v3 } from "../../models/Skeleton";

export type Quaternion = Readonly<{
  w: number;
  x: number;
  y: number;
  z: number;
}>;

const EPS = 1e-6;

export function quatIdentity(): Quaternion {
  return { w: 1, x: 0, y: 0, z: 0 };
}

export function quatNormalize(q: Quaternion): Quaternion {
  const magnitude = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z) || 1;
  return { w: q.w / magnitude, x: q.x / magnitude, y: q.y / magnitude, z: q.z / magnitude };
}

export function quatMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return quatNormalize({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });
}

export function quatInverse(q: Quaternion): Quaternion {
  return quatNormalize({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
}

export function quatFromAxisAngle(axis: Vec3, radians: number): Quaternion {
  const safeAxis = len(axis) > EPS ? norm(axis) : v3(0, 1, 0);
  const half = radians * 0.5;
  const s = Math.sin(half);
  return quatNormalize({
    w: Math.cos(half),
    x: safeAxis.x * s,
    y: safeAxis.y * s,
    z: safeAxis.z * s,
  });
}

export function quatFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quaternion {
  const m00 = xAxis.x;
  const m01 = yAxis.x;
  const m02 = zAxis.x;
  const m10 = xAxis.y;
  const m11 = yAxis.y;
  const m12 = zAxis.y;
  const m20 = xAxis.z;
  const m21 = yAxis.z;
  const m22 = zAxis.z;

  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return quatNormalize({
      w: 0.25 * s,
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s,
    });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return quatNormalize({
      w: (m21 - m12) / s,
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s,
    });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return quatNormalize({
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s,
    });
  }

  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return quatNormalize({
    w: (m10 - m01) / s,
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: 0.25 * s,
  });
}

export function quatFromTo(from: Vec3, to: Vec3, fallbackAxis: Vec3 = v3(0, 1, 0)): Quaternion {
  const a = len(from) > EPS ? norm(from) : v3(0, 1, 0);
  const b = len(to) > EPS ? norm(to) : a;
  const d = clamp(dot(a, b), -1, 1);

  if (d >= 1 - EPS) {
    return quatIdentity();
  }
  if (d <= -1 + EPS) {
    const axis = len(cross(a, fallbackAxis)) > EPS ? cross(a, fallbackAxis) : cross(a, v3(1, 0, 0));
    return quatFromAxisAngle(axis, Math.PI);
  }

  const axis = cross(a, b);
  const s = Math.sqrt((1 + d) * 2);
  return quatNormalize({
    w: s * 0.5,
    x: axis.x / s,
    y: axis.y / s,
    z: axis.z / s,
  });
}

export function quatToEulerZXYDeg(qIn: Quaternion) {
  const q = quatNormalize(qIn);
  const m12 = 2 * (q.x * q.y - q.z * q.w);
  const m22 = 1 - 2 * (q.x * q.x + q.z * q.z);
  const m31 = 2 * (q.x * q.z - q.y * q.w);
  const m32 = 2 * (q.y * q.z + q.x * q.w);
  const m33 = 1 - 2 * (q.x * q.x + q.y * q.y);

  const xRad = Math.asin(clamp(m32, -1, 1));
  const zRad = Math.atan2(-m12, m22);
  const yRad = Math.atan2(-m31, m33);
  const toDeg = (radians: number) => (radians * 180) / Math.PI;

  return { x: toDeg(xRad), y: toDeg(yRad), z: toDeg(zRad) };
}

export function quatToEulerXYZDeg(qIn: Quaternion) {
  const q = quatNormalize(qIn);
  const sinrCosp = 2 * (q.w * q.x + q.y * q.z);
  const cosrCosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const xRad = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const yRad =
    Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(clamp(sinp, -1, 1));

  const sinyCosp = 2 * (q.w * q.z + q.x * q.y);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  const zRad = Math.atan2(sinyCosp, cosyCosp);

  const toDeg = (radians: number) => (radians * 180) / Math.PI;
  return { x: toDeg(xRad), y: toDeg(yRad), z: toDeg(zRad) };
}
