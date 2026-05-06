import * as FSAny from "expo-file-system/legacy";
import type { FaceBlendshape, PoseFrame } from "../../domain/mocap/models/PoseFrame";
import type { Take, TakeId } from "../../domain/mocap/models/Take";

// local shim (senin çözüm 1 ile aynı mantık)
type ExpoFS = typeof FSAny & {
  documentDirectory: string | null;
  EncodingType: { UTF8: string };
};
const FS = FSAny as unknown as ExpoFS;

const ROOT = `${FS.documentDirectory ?? "file://"}mocap/takes/`;

function takeDir(id: TakeId) {
  return `${ROOT}${id}/`;
}
function chunksDir(id: TakeId) {
  return `${takeDir(id)}chunks/`;
}
function metaPath(id: TakeId) {
  return `${takeDir(id)}meta.json`;
}
function legacyFramesPath(id: TakeId) {
  return `${takeDir(id)}frames.jsonl`;
}

type JsonlBlendshape = {
  i: number;
  n: string;
  s: number;
  d?: string;
};

type JsonlFrame = {
  ts: number;
  lm: number[];
  wlm?: number[];
  flm?: number[];
  lhm?: number[];
  lhwm?: number[];
  rhm?: number[];
  rhwm?: number[];
  fbs?: JsonlBlendshape[];
  psm?: 1;
  prof?: "pose" | "holistic";
  rprof?: "auto" | "pose" | "holistic";

  mv?: 1;
  fa?: JsonlFrame;
  fb?: JsonlFrame;
  t3d?: number[];
  re?: number[];
  are?: number;
  tc?: number;
  td?: number;
  da?: string;
  db?: string;
};

function toFaceBlendshapes(items: JsonlBlendshape[] | undefined): readonly FaceBlendshape[] | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.map((item) => ({
    index: item.i,
    name: item.n,
    score: item.s,
    displayName: item.d,
  }));
}

function parseJsonlFrameHelper(json: JsonlFrame): PoseFrame | null {
  if (!json || !Array.isArray(json.lm)) return null;
  return {
    ts: json.ts,
    landmarks: new Float32Array(json.lm),
    worldLandmarks: Array.isArray(json.wlm) ? new Float32Array(json.wlm) : undefined,
    faceLandmarks: Array.isArray(json.flm) ? new Float32Array(json.flm) : undefined,
    leftHandLandmarks: Array.isArray(json.lhm) ? new Float32Array(json.lhm) : undefined,
    leftHandWorldLandmarks: Array.isArray(json.lhwm) ? new Float32Array(json.lhwm) : undefined,
    rightHandLandmarks: Array.isArray(json.rhm) ? new Float32Array(json.rhm) : undefined,
    rightHandWorldLandmarks: Array.isArray(json.rhwm) ? new Float32Array(json.rhwm) : undefined,
    faceBlendshapes: toFaceBlendshapes(json.fbs),
    hasPoseSegmentationMask: json.psm === 1,
    trackingProfile: json.prof,
    requestedTrackingProfile: json.rprof,
  };
}

function parseJsonlFrames(raw: string): PoseFrame[] {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const frames: PoseFrame[] = [];

  for (const line of lines) {
    let json: JsonlFrame | null = null;
    try {
      json = JSON.parse(line) as JsonlFrame;
    } catch {
      continue;
    }
    if (!json) continue;

    if (json.mv === 1 && json.fa && json.t3d) {
      const fa = parseJsonlFrameHelper(json.fa);
      if (fa) {
        frames.push({
          ...fa,
          ts: json.ts, // Use the matched timestamp
          worldLandmarks: new Float32Array(json.t3d),
          triangulated: true,
          sourceDevice: json.da,
          // (We omit the rest of the multi-view fields to satisfy PoseFrame type,
          // but we injected worldLandmarks so the 3D player can use it)
        });
      }
      continue;
    }

    const frame = parseJsonlFrameHelper(json);
    if (frame) frames.push(frame);
  }

  return frames;
}

function sanitizeFrames(frames: readonly PoseFrame[]): PoseFrame[] {
  const sanitized: PoseFrame[] = [];
  let lastTs = -Infinity;
  let dropped = 0;

  for (const frame of frames) {
    if (!Number.isFinite(frame.ts) || frame.ts <= lastTs) {
      dropped += 1;
      continue;
    }
    sanitized.push(frame);
    lastTs = frame.ts;
  }

  if (dropped > 0) {
    console.warn(`[takeRepoFs.reader] Dropped ${dropped} duplicate/out-of-order frames`);
  }

  return sanitized;
}

export async function readTakeMeta(takeId: TakeId): Promise<Take> {
  const raw = await FS.readAsStringAsync(metaPath(takeId), { encoding: FS.EncodingType.UTF8 as any } as any);
  return JSON.parse(raw) as Take;
}

export async function readTakeFrames(takeId: TakeId): Promise<PoseFrame[]> {
  const chunkDirInfo = await FS.getInfoAsync(chunksDir(takeId));
  if (chunkDirInfo.exists) {
    const files = (await FS.readDirectoryAsync(chunksDir(takeId)))
      .filter((name) => name.endsWith(".jsonl"))
      .sort((a, b) => a.localeCompare(b));

    if (files.length > 0) {
      const frames: PoseFrame[] = [];
      for (const file of files) {
        const raw = await FS.readAsStringAsync(`${chunksDir(takeId)}${file}`, {
          encoding: FS.EncodingType.UTF8 as any,
        } as any);
        frames.push(...parseJsonlFrames(raw));
      }
      return sanitizeFrames(frames);
    }
  }

  const legacyPath = legacyFramesPath(takeId);
  const legacyInfo = await FS.getInfoAsync(legacyPath);
  if (!legacyInfo.exists) return [];

  const raw = await FS.readAsStringAsync(legacyPath, {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
  return sanitizeFrames(parseJsonlFrames(raw));
}
