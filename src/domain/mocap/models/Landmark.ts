export type LandmarkBuffer = Float32Array;

/** flat layout: [x,y,z,c, x,y,z,c, ...] */
export const LANDMARK_STRIDE = 4;

export function landmarkCount(buf: LandmarkBuffer) {
  return Math.floor(buf.length / LANDMARK_STRIDE);
}

export function lmAt(buf: LandmarkBuffer, index: number) {
  const o = index * LANDMARK_STRIDE;
  return { x: buf[o], y: buf[o + 1], z: buf[o + 2], c: buf[o + 3] };
}
