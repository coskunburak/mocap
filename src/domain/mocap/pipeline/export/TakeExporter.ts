// src/domain/mocap/pipeline/export/TakeExporter.ts
import * as FSAny from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { PoseFrame } from "../../models/PoseFrame";
import type { TakeId, Take } from "../../models/Take";
import { lmAt } from "../../models/Landmark";
import { MP33, RIG, type JointName } from "../../models/MediapipePose33";

import { readTakeFrames, readTakeMeta } from "../../../../infra/persistence/takeRepoFs.reader";

// ---- Local minimal typing shim (your "solution 1" approach) ----
type ExpoFS = typeof FSAny & {
  documentDirectory: string | null;
  cacheDirectory: string | null;
  EncodingType: { UTF8: string };
};
const FS = FSAny as unknown as ExpoFS;
// ----------------------------------------------------------------

export type ExportFormat = "json" | "bvh" | "both";

export type ExportResult = {
  exportDir: string;
  jsonPath?: string;
  bvhPath?: string;
};

type ExportOptions = {
  format?: ExportFormat;
  filenamePrefix?: string;   // default: take_<id>
  includeFramesInJson?: boolean; // default true
  // BVH options
  bvhFps?: number; // default: estimated or 30
};

/** Safe filename for iOS/Android file systems */
function safeName(s: string) {
  return s.replace(/[^\w\-\.]+/g, "_");
}

function ensureExportDir(): string {
  const base = FS.cacheDirectory ?? FS.documentDirectory;
  if (!base) return "file://"; // defensive
  return `${base}mocap/exports/`;
}

async function mkdirp(dir: string) {
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) await FS.makeDirectoryAsync(dir, { intermediates: true });
}

async function writeUtf8(path: string, content: string) {
  await FS.writeAsStringAsync(
    path,
    content,
    { encoding: FS.EncodingType.UTF8 as any } as any
  );
}

function estimateFps(frames: PoseFrame[]): number | null {
  if (frames.length < 2) return null;
  const dt = frames[frames.length - 1].ts - frames[0].ts;
  if (dt <= 0) return null;
  return (frames.length - 1) / (dt / 1000);
}

/* ----------------- BVH BUILD (your current approach) ----------------- */
type Vec3 = { x: number; y: number; z: number };
type Quat = { w: number; x: number; y: number; z: number };

function vAdd(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function vSub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function vMul(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function vLen(a: Vec3): number { return Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
function vNorm(a: Vec3): Vec3 {
  const l = vLen(a);
  if (l < 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
function vDot(a: Vec3, b: Vec3): number { return a.x*b.x + a.y*b.y + a.z*b.z; }
function vCross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y*b.z - a.z*b.y, y: a.z*b.x - a.x*b.z, z: a.x*b.y - a.y*b.x };
}

function qNorm(q: Quat): Quat {
  const l = Math.sqrt(q.w*q.w + q.x*q.x + q.y*q.y + q.z*q.z);
  if (l < 1e-8) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: q.w/l, x: q.x/l, y: q.y/l, z: q.z/l };
}

function qFromTo(from: Vec3, to: Vec3): Quat {
  const f = vNorm(from);
  const t = vNorm(to);
  const d = vDot(f, t);

  if (d > 0.999999) return { w: 1, x: 0, y: 0, z: 0 };
  if (d < -0.999999) {
    const axis = vNorm(
      Math.abs(f.x) < 0.9 ? vCross(f, { x: 1, y: 0, z: 0 }) : vCross(f, { x: 0, y: 1, z: 0 })
    );
    return qNorm({ w: 0, x: axis.x, y: axis.y, z: axis.z });
  }

  const axis = vCross(f, t);
  return qNorm({ w: 1 + d, x: axis.x, y: axis.y, z: axis.z });
}

// BVH channels: Zrotation Xrotation Yrotation
function quatToEulerZXY(qIn: Quat): { x: number; y: number; z: number } {
  const q = qNorm(qIn);
  const w = q.w, x = q.x, y = q.y, z = q.z;

  const m00 = 1 - 2*(y*y + z*z);
  const m01 = 2*(x*y - z*w);
  const m11 = 1 - 2*(x*x + z*z);
  const m20 = 2*(x*z - y*w);
  const m21 = 2*(y*z + x*w);
  const m22 = 1 - 2*(x*x + y*y);

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const ex = Math.asin(clamp(m21));
  const cx = Math.cos(ex);

  let ez = 0;
  let ey = 0;

  if (Math.abs(cx) > 1e-6) {
    ez = Math.atan2(-m01, m11);
    ey = Math.atan2(-m20, m22);
  } else {
    ez = Math.atan2(0, m00);
    ey = 0;
  }

  const rad2deg = 180 / Math.PI;
  return { x: ex * rad2deg, y: ey * rad2deg, z: ez * rad2deg };
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 };
}

/**
 * Normalized landmark space -> centered/scaled rig space.
 * Production v1: centered at hips, scaled by shoulder width, Y flipped.
 */
function buildRigPose(frame: PoseFrame): Record<JointName, Vec3> {
  const LHIP = lmAt(frame.landmarks, MP33.LEFT_HIP);
  const RHIP = lmAt(frame.landmarks, MP33.RIGHT_HIP);
  const LSHO = lmAt(frame.landmarks, MP33.LEFT_SHOULDER);
  const RSHO = lmAt(frame.landmarks, MP33.RIGHT_SHOULDER);
  const NOSE = lmAt(frame.landmarks, MP33.NOSE);

  const lhip: Vec3 = { x: LHIP.x, y: LHIP.y, z: LHIP.z };
  const rhip: Vec3 = { x: RHIP.x, y: RHIP.y, z: RHIP.z };
  const lsho: Vec3 = { x: LSHO.x, y: LSHO.y, z: LSHO.z };
  const rsho: Vec3 = { x: RSHO.x, y: RSHO.y, z: RSHO.z };
  const nose: Vec3 = { x: NOSE.x, y: NOSE.y, z: NOSE.z };

  const hips = midpoint(lhip, rhip);
  const neck = midpoint(lsho, rsho);

  const shoulderWidth = Math.max(1e-4, vLen(vSub(lsho, rsho)));
  const scale = 1 / shoulderWidth;

  const toSpace = (p: Vec3): Vec3 => {
    const c = vSub(p, hips);
    return { x: c.x * scale, y: -c.y * scale, z: c.z * scale };
  };

  const pos: Record<JointName, Vec3> = {} as any;

  pos.Hips = { x: 0, y: 0, z: 0 };
  pos.Neck = toSpace(neck);
  pos.Spine = vMul(pos.Neck, 0.6);
  pos.Head = toSpace(nose);

  const get = (idx: number): Vec3 => {
    const lm = lmAt(frame.landmarks, idx);
    return toSpace({ x: lm.x, y: lm.y, z: lm.z });
  };

  pos.LeftShoulder = get(MP33.LEFT_SHOULDER);
  pos.LeftElbow = get(MP33.LEFT_ELBOW);
  pos.LeftWrist = get(MP33.LEFT_WRIST);

  pos.RightShoulder = get(MP33.RIGHT_SHOULDER);
  pos.RightElbow = get(MP33.RIGHT_ELBOW);
  pos.RightWrist = get(MP33.RIGHT_WRIST);

  pos.LeftHip = toSpace(lhip);
  pos.LeftKnee = get(MP33.LEFT_KNEE);
  pos.LeftAnkle = get(MP33.LEFT_ANKLE);

  pos.RightHip = toSpace(rhip);
  pos.RightKnee = get(MP33.RIGHT_KNEE);
  pos.RightAnkle = get(MP33.RIGHT_ANKLE);

  return pos;
}

function buildChildren(): Record<JointName, JointName[]> {
  const map = {} as Record<JointName, JointName[]>;
  for (const j of RIG) map[j.name] = [];
  for (const j of RIG) {
    if (j.parent) map[j.parent].push(j.name);
  }
  return map;
}

function parentOf(j: JointName): JointName | null {
  const found = RIG.find((x) => x.name === j);
  return found?.parent ?? null;
}

function bvhOrder(): JointName[] {
  const children = buildChildren();
  const out: JointName[] = [];
  const dfs = (j: JointName) => {
    for (const c of children[j] ?? []) {
      out.push(c);
      dfs(c);
    }
  };
  dfs("Hips");
  return out;
}

function emitHierarchy(
  rest: Record<JointName, Vec3>,
  children: Record<JointName, JointName[]>
): string[] {
  const lines: string[] = [];
  lines.push("HIERARCHY");
  lines.push("ROOT Hips");
  lines.push("{");
  lines.push(`  OFFSET 0 0 0`);
  lines.push(`  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`);
  emitJoint(lines, "Hips", 1, children, rest);
  lines.push("}");
  return lines;
}

function emitJoint(
  lines: string[],
  joint: JointName,
  indent: number,
  children: Record<JointName, JointName[]>,
  rest: Record<JointName, Vec3>
) {
  const pad = "  ".repeat(indent);

  for (const c of children[joint] ?? []) {
    lines.push(`${pad}JOINT ${c}`);
    lines.push(`${pad}{`);

    const parentPos = rest[joint] ?? { x: 0, y: 0, z: 0 };
    const childPos  = rest[c] ?? { x: 0, y: 0, z: 0 };
    const off = vSub(childPos, parentPos);

    const safe = (v: number) => (Number.isFinite(v) ? v : 0);
    lines.push(`${pad}  OFFSET ${safe(off.x).toFixed(6)} ${safe(off.y).toFixed(6)} ${safe(off.z).toFixed(6)}`);
    lines.push(`${pad}  CHANNELS 3 Zrotation Xrotation Yrotation`);

    emitJoint(lines, c, indent + 1, children, rest);

    if ((children[c] ?? []).length === 0) {
      lines.push(`${pad}  End Site`);
      lines.push(`${pad}  {`);
      lines.push(`${pad}    OFFSET 0.000000 0.000000 0.000000`);
      lines.push(`${pad}  }`);
    }

    lines.push(`${pad}}`);
  }
}

function buildBVH(frames: PoseFrame[], fps: number): string {
  const poses = frames.map(buildRigPose);

  const rest = poses[0] ?? ({} as Record<JointName, Vec3>);
  const children = buildChildren();

  const lines: string[] = [];
  lines.push(...emitHierarchy(rest, children));

  lines.push("MOTION");
  lines.push(`Frames: ${poses.length}`);
  lines.push(`Frame Time: ${(1 / fps).toFixed(6)}`);

  const order = bvhOrder();

  for (const pose of poses) {
    const row: number[] = [];

    // Root translation (centered capture)
    row.push(0, 0, 0);

    // Root rotation (v1: 0 for stability)
    row.push(0, 0, 0);

    for (const j of order) {
      const parent = parentOf(j);
      if (!parent) continue;

      const restVec = vSub(rest[j] ?? { x: 0, y: 0, z: 0 }, rest[parent] ?? { x: 0, y: 0, z: 0 });
      const curVec  = vSub(pose[j] ?? { x: 0, y: 0, z: 0 }, pose[parent] ?? { x: 0, y: 0, z: 0 });

      const q = qFromTo(restVec, curVec);
      const e = quatToEulerZXY(q);
      row.push(e.z, e.x, e.y);
    }

    lines.push(row.map((n) => (Number.isFinite(n) ? n.toFixed(6) : "0.000000")).join(" "));
  }

  return lines.join("\n");
}
/* -------------------------------------------------------------------- */

export const TakeExporter = {
  /**
   * Export a take to JSON/BVH and returns paths.
   */
  async exportTake(takeId: TakeId, opts?: ExportOptions): Promise<ExportResult> {
    const format: ExportFormat = opts?.format ?? "both";
    const includeFramesInJson = opts?.includeFramesInJson ?? true;

    const [meta, frames] = await Promise.all([readTakeMeta(takeId), readTakeFrames(takeId)]);

    const exportDir = ensureExportDir();
    await mkdirp(exportDir);

    const baseName = safeName(opts?.filenamePrefix ?? `take_${takeId}`);
    const out: ExportResult = { exportDir };

    if (format === "json" || format === "both") {
      const payload = includeFramesInJson
        ? {
            schema: "mocap.take.v1",
            take: meta,
            frames: frames.map((f) => ({ ts: f.ts, lm: Array.from(f.landmarks) })),
          }
        : {
            schema: "mocap.take.v1",
            take: meta,
            frames: [], // frames omitted
          };

      const jsonPath = `${exportDir}${baseName}.json`;
      await writeUtf8(jsonPath, JSON.stringify(payload));
      out.jsonPath = jsonPath;
    }

    if (format === "bvh" || format === "both") {
      const fps = opts?.bvhFps ?? estimateFps(frames) ?? 30;
      const bvh = buildBVH(frames, fps);

      const bvhPath = `${exportDir}${baseName}.bvh`;
      await writeUtf8(bvhPath, bvh);
      out.bvhPath = bvhPath;
    }

    return out;
  },

  async shareFile(path: string) {
    const available = await Sharing.isAvailableAsync();
    if (!available) return { shared: false as const };
    await Sharing.shareAsync(path);
    return { shared: true as const };
  },

  async getTakeMeta(takeId: TakeId): Promise<Take> {
    return await readTakeMeta(takeId);
  },
};
