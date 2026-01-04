// src/infra/persistence/TakeRepo.fs.ts
import * as FSAny from "expo-file-system";
import type { PoseFrame } from "../../domain/mocap/models/PoseFrame";
import type { Take, TakeId } from "../../domain/mocap/models/Take";
import { newTake } from "../../domain/mocap/models/Take";

// ---- Local minimal typing shim (fixes broken TS typings) ----
type ExpoFS = typeof FSAny & {
  documentDirectory: string | null;
  EncodingType: { UTF8: string };
};
const FS = FSAny as unknown as ExpoFS;
// ------------------------------------------------------------

const DOC_DIR = FS.documentDirectory ?? null;
if (!DOC_DIR) {
  console.warn("[takeRepoFs] documentDirectory is null");
}
const ROOT = `${DOC_DIR ?? "file://"}mocap/takes/`;

function takeDir(id: TakeId) {
  return `${ROOT}${id}/`;
}
function metaPath(id: TakeId) {
  return `${takeDir(id)}meta.json`;
}
function framesPath(id: TakeId) {
  return `${takeDir(id)}frames.jsonl`;
}

async function ensureDir(dir: string) {
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function writeJson(path: string, obj: unknown) {
  await FS.writeAsStringAsync(path, JSON.stringify(obj), {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const info = await FS.getInfoAsync(path);
  if (!info.exists) return undefined;
  const raw = await FS.readAsStringAsync(path, {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
  return JSON.parse(raw) as T;
}

type JsonlFrame = { ts: number; lm: number[] };

async function appendTextFile(path: string, text: string) {
  const info = await FS.getInfoAsync(path);
  if (!info.exists) {
    await FS.writeAsStringAsync(path, text, {
      encoding: FS.EncodingType.UTF8 as any,
    } as any);
    return;
  }
  const prev = await FS.readAsStringAsync(path, {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
  await FS.writeAsStringAsync(path, prev + text, {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
}

export const takeRepoFs = {
  async createTake(name?: string, projectId?: string): Promise<Take> {
    await ensureDir(ROOT);

    const take = newTake(name ?? "Take", projectId);
    const dir = takeDir(take.id);
    await ensureDir(dir);

    await writeJson(metaPath(take.id), take);
    await FS.writeAsStringAsync(framesPath(take.id), "", {
      encoding: FS.EncodingType.UTF8 as any,
    } as any);

    return take;
  },

  async getTake(id: TakeId): Promise<Take | undefined> {
    return await readJson<Take>(metaPath(id));
  },

  async listTakes(): Promise<Take[]> {
    await ensureDir(ROOT);
    const entries = await FS.readDirectoryAsync(ROOT);

    const metas: Take[] = [];
    for (const id of entries) {
      const t = await this.getTake(id);
      if (t) metas.push(t);
    }
    metas.sort((a, b) => b.createdAt - a.createdAt);
    return metas;
  },

  async appendFrames(
    takeId: TakeId,
    chunkNumber: number,
    frames: PoseFrame[]
  ): Promise<{ startTs: number; endTs: number; frameCount: number }> {
    const take = await this.getTake(takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);
    if (frames.length === 0) return { startTs: 0, endTs: 0, frameCount: 0 };

    const stored: JsonlFrame[] = frames.map((f) => ({
      ts: f.ts,
      lm: Array.from(f.landmarks),
    }));

    const startTs = stored[0].ts;
    const endTs = stored[stored.length - 1].ts;

    const lines = stored.map((x) => JSON.stringify(x)).join("\n") + "\n";
    await appendTextFile(framesPath(takeId), lines);

    const next: Take = {
      ...take,
      updatedAt: Date.now(),
      frameCount: take.frameCount + stored.length,
      chunkCount: Math.max(take.chunkCount, chunkNumber + 1),
    };
    await writeJson(metaPath(takeId), next);

    return { startTs, endTs, frameCount: stored.length };
  },

  async finalizeTake(takeId: TakeId, firstTs: number, lastTs: number): Promise<Take> {
    const take = await this.getTake(takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);

    const durationMs = Math.max(0, lastTs - firstTs);
    const avgFps = durationMs > 0 ? take.frameCount / (durationMs / 1000) : 0;

    const next: Take = { ...take, updatedAt: Date.now(), durationMs, avgFps };
    await writeJson(metaPath(takeId), next);
    return next;
  },

  async deleteTake(takeId: TakeId) {
    const dir = takeDir(takeId);
    const info = await FS.getInfoAsync(dir);
    if (!info.exists) return;
    await FS.deleteAsync(dir, { idempotent: true });
  },
};
