import type { LandmarkBuffer } from "./Landmark";

export type PoseFrame = Readonly<{
  ts: number;                // ms
  landmarks: LandmarkBuffer;  // Float32Array (N*4)
  fps?: number;
  frameId?: number;
}>;
