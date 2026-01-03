export type TakeId = string;

export type Take = Readonly<{
  id: TakeId;

  projectId?: string;

  name: string;

  createdAt: number; // ms
  updatedAt: number; // ms

  // stats (filled progressively, finalized on stop)
  frameCount: number;
  durationMs: number;
  avgFps: number;

  // persistence
  chunkCount: number;
  schemaVersion: number; // bump if you change storage format
}>;

export const TAKE_SCHEMA_VERSION = 1;

export function newTake(name = "Take", projectId?: string): Take {
  const now = Date.now();
  return {
    id: `${now}-${Math.random().toString(16).slice(2)}`,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    frameCount: 0,
    durationMs: 0,
    avgFps: 0,
    chunkCount: 0,
    schemaVersion: TAKE_SCHEMA_VERSION,
  };
}
