import type { PoseFrame } from "../../domain/mocap/models/PoseFrame";
import type { Take, TakeId } from "../../domain/mocap/models/Take";
import { newTake } from "../../domain/mocap/models/Take";
import { getJson, setJson } from "./storage";
import { storage, remove } from "./storage";

/**
 * Storage keys
 */
const K = {
  index: "takes:index", // TakeId[]
  meta: (id: TakeId) => `take:${id}:meta`,
  chunk: (id: TakeId, n: number) => `take:${id}:chunk:${n}`, // stringified chunk
};

type StoredFrame = {
  ts: number;
  // flattened landmarks, but stored as number[] for JSON
  landmarks: number[];
};

type StoredChunk = {
  n: number;
  startTs: number;
  endTs: number;
  frames: StoredFrame[];
};

function getIndex(): TakeId[] {
  return getJson<TakeId[]>(K.index) ?? [];
}

function setIndex(ids: TakeId[]) {
  setJson(K.index, ids);
}

function upsertIndex(id: TakeId) {
  const ids = getIndex();
  if (!ids.includes(id)) {
    ids.unshift(id); // newest first
    setIndex(ids);
  }
}

export const takeRepo = {
  /**
   * Create a new take and persist meta + index.
   */
  createTake(name?: string, projectId?: string): Take {
    const take = newTake(name ?? "Take", projectId);
    upsertIndex(take.id);
    setJson(K.meta(take.id), take);
    return take;
  },

  /**
   * Load take meta.
   */
  getTake(id: TakeId): Take | undefined {
    return getJson<Take>(K.meta(id));
  },

  /**
   * List take metas (fast path).
   */
  listTakes(): Take[] {
    const ids = getIndex();
    const metas: Take[] = [];
    for (const id of ids) {
      const t = getJson<Take>(K.meta(id));
      if (t) metas.push(t);
    }
    return metas;
  },

  /**
   * Append a chunk of frames (chunked persistence).
   * IMPORTANT: Keep chunks small (e.g., 15-60 frames).
   */
  appendFrames(takeId: TakeId, chunkNumber: number, frames: PoseFrame[]): { startTs: number; endTs: number; frameCount: number } {
    const take = this.getTake(takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);

    if (frames.length === 0) {
      return { startTs: 0, endTs: 0, frameCount: 0 };
    }

    const storedFrames: StoredFrame[] = frames.map((f) => ({
      ts: f.ts,
      landmarks: Array.from(f.landmarks), // Float32Array -> number[]
    }));

    const startTs = storedFrames[0].ts;
    const endTs = storedFrames[storedFrames.length - 1].ts;

    const chunk: StoredChunk = {
      n: chunkNumber,
      startTs,
      endTs,
      frames: storedFrames,
    };

    // Persist chunk
    setJson(K.chunk(takeId, chunkNumber), chunk);

    // Update meta (frame count + chunk count + updatedAt)
    const next: Take = {
      ...take,
      updatedAt: Date.now(),
      frameCount: take.frameCount + storedFrames.length,
      chunkCount: Math.max(take.chunkCount, chunkNumber + 1),
      // duration/avgFps computed on finalize
    };
    setJson(K.meta(takeId), next);

    return { startTs, endTs, frameCount: storedFrames.length };
  },

  /**
   * Finalize take stats after recording stops.
   * Provide first/last timestamps and avg fps.
   */
  finalizeTake(takeId: TakeId, firstTs: number, lastTs: number): Take {
    const take = this.getTake(takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);

    const durationMs = Math.max(0, lastTs - firstTs);
    const avgFps = durationMs > 0 ? (take.frameCount / (durationMs / 1000)) : 0;

    const next: Take = {
      ...take,
      updatedAt: Date.now(),
      durationMs,
      avgFps,
    };
    setJson(K.meta(takeId), next);
    return next;
  },

  /**
   * Read back chunks (for export/replay).
   */
  getChunk(takeId: TakeId, n: number): StoredChunk | undefined {
    return getJson<StoredChunk>(K.chunk(takeId, n));
  },

  /**
   * Delete a take (meta + chunks + index).
   */
  deleteTake(takeId: TakeId) {
    const take = this.getTake(takeId);
    if (!take) return;

    // delete chunks
    for (let i = 0; i < take.chunkCount; i++) {
      remove(K.chunk(takeId, i));
    }
    // delete meta
    remove(K.meta(takeId));

    // update index
    const ids = getIndex().filter((x) => x !== takeId);
    setIndex(ids);
  },

  /**
   * Debug / maintenance: wipe all takes.
   */
  wipeAll() {
    const ids = getIndex();
    for (const id of ids) {
      this.deleteTake(id);
    }
    setIndex([]);
    // optional: storage.clearAll(); // be careful: wipes everything
  },
};
