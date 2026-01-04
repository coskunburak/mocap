// src/domain/mocap/pipeline/export/BVHWriter.ts
import type { PoseFrame } from "../../models/PoseFrame";
import { RIG, mp33ToJointPose, type JointName } from "../../models/MediapipePose33";
import type { JointPose, Vec3 } from "../../models/Skeleton";
import {
  clamp,
  cross,
  dot,
  len,
  norm,
  sub,
  v3,
} from "../../models/Skeleton";

type BVHOptions = {
  fps?: number;
  scale?: number; // forwarded to mp33ToJointPose
};

type Quat = { w: number; x: number; y: number; z: number };

function quatNormalize(q: Quat): Quat {
  const m = Math.sqrt(q.w*q.w + q.x*q.x + q.y*q.y + q.z*q.z) || 1;
  return { w: q.w/m, x: q.x/m, y: q.y/m, z: q.z/m };
}

function quatFromTo(a: Vec3, b: Vec3): Quat {
  const v0 = norm(a);
  const v1 = norm(b);

  const d = clamp(dot(v0, v1), -1, 1);

  // if vectors are nearly opposite
  if (d < -0.999999) {
    // find orthogonal axis
    const axis = norm(Math.abs(v0.x) < 0.1 ? cross(v0, v3(1,0,0)) : cross(v0, v3(0,1,0)));
    return quatNormalize({ w: 0, x: axis.x, y: axis.y, z: axis.z });
  }

  const c = cross(v0, v1);
  const q = { w: 1 + d, x: c.x, y: c.y, z: c.z };
  return quatNormalize(q);
}

function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
  };
}

function quatInv(q: Quat): Quat {
  // unit quat inverse = conjugate
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

/**
 * Convert quaternion to Euler degrees in ZXY order (BVH common).
 * Returns {x,y,z} in degrees where BVH line expects Xrot Yrot Zrot order typically.
 * We'll output: Zrotation Xrotation Yrotation if we choose; BUT:
 * In BVH, CHANNELS order defines per-joint. We'll set "Zrotation Xrotation Yrotation".
 */
function quatToEulerZXYDeg(q: Quat) {
  // ZXY intrinsic (one common approach)
  const w=q.w, x=q.x, y=q.y, z=q.z;

  // based on rotation matrix
  const m11 = 1 - 2*(y*y + z*z);
  const m12 = 2*(x*y - z*w);
  const m13 = 2*(x*z + y*w);

  const m21 = 2*(x*y + z*w);
  const m22 = 1 - 2*(x*x + z*z);
  const m23 = 2*(y*z - x*w);

  const m31 = 2*(x*z - y*w);
  const m32 = 2*(y*z + x*w);
  const m33 = 1 - 2*(x*x + y*y);

  // For ZXY:
  // x = asin(clamp(m32))
  const xRad = Math.asin(clamp(m32, -1, 1));
  const zRad = Math.atan2(-m12, m22);
  const yRad = Math.atan2(-m31, m33);

  const toDeg = (r: number) => (r * 180) / Math.PI;
  return { x: toDeg(xRad), y: toDeg(yRad), z: toDeg(zRad) };
}

function fmt(n: number) {
  // BVH wants plain floats
  const v = Math.abs(n) < 1e-8 ? 0 : n;
  return v.toFixed(6);
}

function childrenOf(name: JointName): JointName[] {
  return RIG.filter(r => r.parent === name).map(r => r.name);
}

function isLeaf(name: JointName) {
  return childrenOf(name).length === 0;
}

function getRoot(): JointName {
  return "Hips";
}

function buildRestOffsets(rest: JointPose): Record<JointName, Vec3> {
  const out: any = {};
  for (const node of RIG) {
    if (node.parent == null) {
      out[node.name] = v3(0,0,0);
    } else {
      out[node.name] = sub(rest[node.name], rest[node.parent]);
    }
  }
  return out;
}

/**
 * Compute local rotation that aligns rest bone direction to current bone direction.
 * For leaf joints: return identity (no child to define direction).
 * For joints with 1+ children: use first child as main bone direction.
 */
function localRotation(rest: JointPose, cur: JointPose, joint: JointName): Quat {
  const kids = childrenOf(joint);
  if (kids.length === 0) return { w: 1, x: 0, y: 0, z: 0 };

  const child = kids[0];
  const restDir = sub(rest[child], rest[joint]);
  const curDir  = sub(cur[child], cur[joint]);

  if (len(restDir) < 1e-6 || len(curDir) < 1e-6) {
    return { w: 1, x: 0, y: 0, z: 0 };
  }
  return quatFromTo(restDir, curDir);
}

function writeHierarchy(offsets: Record<JointName, Vec3>) {
  const root = getRoot();

  const lines: string[] = [];
  lines.push("HIERARCHY");
  lines.push(`ROOT ${root}`);
  lines.push("{");
  lines.push(`  OFFSET 0.000000 0.000000 0.000000`);
  lines.push(`  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`);

  const writeJoint = (name: JointName, indent: number) => {
    const pad = "  ".repeat(indent);
    const off = offsets[name];
    const kids = childrenOf(name);

    if (kids.length === 0) {
      // End Site
      lines.push(`${pad}End Site`);
      lines.push(`${pad}{`);
      lines.push(`${pad}  OFFSET 0.000000 0.000000 0.000000`);
      lines.push(`${pad}}`);
      return;
    }

    for (const k of kids) {
      const koff = offsets[k];
      lines.push(`${pad}JOINT ${k}`);
      lines.push(`${pad}{`);
      lines.push(`${pad}  OFFSET ${fmt(koff.x)} ${fmt(koff.y)} ${fmt(koff.z)}`);
      lines.push(`${pad}  CHANNELS 3 Zrotation Xrotation Yrotation`);

      writeJoint(k, indent + 1);

      lines.push(`${pad}}`);
    }
  };

  writeJoint(root, 1);

  lines.push("}");
  return lines.join("\n");
}

function writeMotion(frames: PoseFrame[], rest: JointPose, fps: number, scale: number) {
  const root = getRoot();
  const lines: string[] = [];
  lines.push("MOTION");
  lines.push(`Frames: ${frames.length}`);
  lines.push(`Frame Time: ${(1 / fps).toFixed(6)}`);

  const restPose = mp33ToJointPose(frames[0].landmarks, { scale });
  const restRoot = restPose[root];

  // Precompute parent world rotation accumulation per frame? v1: assume local only (good enough)
  // We'll compute local bone rotations only from directions; root translation absolute.

  for (const fr of frames) {
    const cur = mp33ToJointPose(fr.landmarks, { scale });

    // root position = current hips
    const rp = cur[root];
    const rootPos = { x: rp.x - restRoot.x, y: rp.y - restRoot.y, z: rp.z - restRoot.z };

    // root rotation
    const rq = localRotation(rest, cur, root);
    const re = quatToEulerZXYDeg(rq);

    const values: number[] = [];
    values.push(rootPos.x, rootPos.y, rootPos.z, re.z, re.x, re.y);

    // DFS order must match hierarchy writing order: root children recursively
    const pushJoint = (j: JointName) => {
      const kids = childrenOf(j);
      for (const k of kids) {
        const q = localRotation(rest, cur, k);
        const e = quatToEulerZXYDeg(q);
        values.push(e.z, e.x, e.y);
        pushJoint(k);
      }
    };
    pushJoint(root);

    lines.push(values.map(fmt).join(" "));
  }

  return lines.join("\n");
}

export class BVHWriter {
  /**
   * MediaPipe Pose frames -> BVH text
   * Production v1: derived rig + direction-based rotations.
   */
  static fromMediapipePoseFrames(frames: PoseFrame[], opts?: BVHOptions) {
    if (frames.length === 0) throw new Error("No frames");

    const fps = opts?.fps ?? 30;
    const scale = opts?.scale ?? 100;

    const rest = mp33ToJointPose(frames[0].landmarks, { scale });
    const offsets = buildRestOffsets(rest);

    const hierarchy = writeHierarchy(offsets);
    const motion = writeMotion(frames, rest, fps, scale);

    return `${hierarchy}\n${motion}\n`;
  }
}
