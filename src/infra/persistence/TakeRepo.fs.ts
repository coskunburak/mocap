import * as FSAny from "expo-file-system/legacy";
import type { FaceBlendshape, PoseFrame } from "../../domain/mocap/models/PoseFrame";
import type { NewTakeMeta, Take, TakeId } from "../../domain/mocap/models/Take";
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
function chunksDir(id: TakeId) {
  return `${takeDir(id)}chunks/`;
}
function metaPath(id: TakeId) {
  return `${takeDir(id)}meta.json`;
}
function legacyFramesPath(id: TakeId) {
  return `${takeDir(id)}frames.jsonl`;
}
function chunkPath(id: TakeId, chunkNumber: number) {
  return `${chunksDir(id)}${String(chunkNumber).padStart(6, "0")}.jsonl`;
}
function tempChunkPath(id: TakeId, chunkNumber: number) {
  return `${takeDir(id)}.${String(chunkNumber).padStart(6, "0")}.jsonl.tmp`;
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

async function writeChunkAtomically(path: string, tempPath: string, contents: string) {
  const tempInfo = await FS.getInfoAsync(tempPath);
  if (tempInfo.exists) {
    await FS.deleteAsync(tempPath, { idempotent: true });
  }

  const finalInfo = await FS.getInfoAsync(path);
  if (finalInfo.exists) {
    throw new Error(`Chunk already exists: ${path}`);
  }

  await FS.writeAsStringAsync(tempPath, contents, {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
  await FS.moveAsync({ from: tempPath, to: path } as any);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const info = await FS.getInfoAsync(path);
  if (!info.exists) return undefined;
  const raw = await FS.readAsStringAsync(path, {
    encoding: FS.EncodingType.UTF8 as any,
  } as any);
  return JSON.parse(raw) as T;
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
  
  // Multi-view extensions
  mv?: 1; // Flag indicating this is a MultiViewPoseFrame
  fa?: JsonlFrame; // frameA
  fb?: JsonlFrame; // frameB
  t3d?: number[];  // triangulated3D
  re?: number[];   // reprojErrors
  are?: number;    // avgReprojError
  tc?: number;     // triangulatedCount
  td?: number;     // timeDelta
  da?: string;     // deviceA
  db?: string;     // deviceB
};

function toStoredBlendshapes(
  items: readonly FaceBlendshape[] | undefined,
): JsonlBlendshape[] | undefined {
  if (!items?.length) return undefined;
  return items.map((item) => ({
    i: item.index,
    n: item.name,
    s: item.score,
    d: item.displayName,
  }));
}

export const takeRepoFs = {
  async createTake(name?: string, projectId?: string, meta?: NewTakeMeta): Promise<Take> {
    await ensureDir(ROOT);

    const take = newTake(name ?? "Take", projectId, meta);
    const dir = takeDir(take.id);
    await ensureDir(dir);
    await ensureDir(chunksDir(take.id));

    await writeJson(metaPath(take.id), take);

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
    frames: (PoseFrame | import("../../domain/mocap/models/MultiViewPoseFrame").MultiViewPoseFrame)[]
  ): Promise<{ startTs: number; endTs: number; frameCount: number }> {
    const take = await this.getTake(takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);
    if (frames.length === 0) return { startTs: 0, endTs: 0, frameCount: 0 };

    const serializeFrame = (f: PoseFrame): JsonlFrame => ({
      ts: f.ts,
      lm: Array.from(f.landmarks),
      wlm: f.worldLandmarks ? Array.from(f.worldLandmarks) : undefined,
      flm: f.faceLandmarks ? Array.from(f.faceLandmarks) : undefined,
      lhm: f.leftHandLandmarks ? Array.from(f.leftHandLandmarks) : undefined,
      lhwm: f.leftHandWorldLandmarks ? Array.from(f.leftHandWorldLandmarks) : undefined,
      rhm: f.rightHandLandmarks ? Array.from(f.rightHandLandmarks) : undefined,
      rhwm: f.rightHandWorldLandmarks ? Array.from(f.rightHandWorldLandmarks) : undefined,
      fbs: toStoredBlendshapes(f.faceBlendshapes),
      psm: f.hasPoseSegmentationMask ? 1 : undefined,
      prof: f.trackingProfile,
      rprof: f.requestedTrackingProfile,
    });

    const stored: JsonlFrame[] = frames.map((f: any) => {
      if (f.frameA && f.frameB && f.triangulated3D) {
        // MultiViewPoseFrame
        return {
          ts: f.ts,
          lm: [], // Main landmarks left empty to save space, data is in fa/fb
          mv: 1,
          fa: serializeFrame(f.frameA),
          fb: serializeFrame(f.frameB),
          t3d: Array.from(f.triangulated3D),
          re: Array.from(f.reprojErrors),
          are: f.avgReprojError,
          tc: f.triangulatedCount,
          td: f.timeDelta,
          da: f.deviceA,
          db: f.deviceB,
        };
      }
      // Standard PoseFrame
      return serializeFrame(f);
    });

    const startTs = stored[0].ts;
    const endTs = stored[stored.length - 1].ts;

    const lines = stored.map((x) => JSON.stringify(x)).join("\n") + "\n";
    await ensureDir(chunksDir(takeId));
    await writeChunkAtomically(
      chunkPath(takeId, chunkNumber),
      tempChunkPath(takeId, chunkNumber),
      lines,
    );

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

  async updateTakeMeta(takeId: TakeId, patch: Partial<Take>): Promise<Take> {
    const take = await this.getTake(takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);

    const next: Take = {
      ...take,
      ...patch,
      id: take.id,
      createdAt: take.createdAt,
      updatedAt: Date.now(),
    };
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
