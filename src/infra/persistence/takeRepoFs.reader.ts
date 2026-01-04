import * as FSAny from "expo-file-system";
import type { PoseFrame } from "../../domain/mocap/models/PoseFrame";
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

type JsonlFrame = { ts: number; lm: number[] };

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
    });
  }
  return frames;
}
