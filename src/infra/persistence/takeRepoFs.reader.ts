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
function metaPath(id: TakeId) {
  return `${takeDir(id)}meta.json`;
}
function framesPath(id: TakeId) {
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

export async function readTakeMeta(takeId: TakeId): Promise<Take> {
  const raw = await FS.readAsStringAsync(metaPath(takeId), { encoding: FS.EncodingType.UTF8 as any } as any);
  return JSON.parse(raw) as Take;
}

export async function readTakeFrames(takeId: TakeId): Promise<PoseFrame[]> {
  const p = framesPath(takeId);
  const info = await FS.getInfoAsync(p);
  if (!info.exists) return [];

  const raw = await FS.readAsStringAsync(p, { encoding: FS.EncodingType.UTF8 as any } as any);
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  const frames: PoseFrame[] = [];
  for (const line of lines) {
    let j: JsonlFrame | null = null;
    try {
      j = JSON.parse(line) as JsonlFrame;
    } catch {
      continue; // tolerate partial write
    }
    if (!j || !Array.isArray(j.lm)) continue;

    frames.push({
      ts: j.ts,
      landmarks: new Float32Array(j.lm),
      worldLandmarks: Array.isArray(j.wlm) ? new Float32Array(j.wlm) : undefined,
      faceLandmarks: Array.isArray(j.flm) ? new Float32Array(j.flm) : undefined,
      leftHandLandmarks: Array.isArray(j.lhm) ? new Float32Array(j.lhm) : undefined,
      leftHandWorldLandmarks: Array.isArray(j.lhwm)
        ? new Float32Array(j.lhwm)
        : undefined,
      rightHandLandmarks: Array.isArray(j.rhm) ? new Float32Array(j.rhm) : undefined,
      rightHandWorldLandmarks: Array.isArray(j.rhwm)
        ? new Float32Array(j.rhwm)
        : undefined,
      faceBlendshapes: toFaceBlendshapes(j.fbs),
      hasPoseSegmentationMask: j.psm === 1,
      trackingProfile: j.prof,
      requestedTrackingProfile: j.rprof,
    });
  }
  return frames;
}
