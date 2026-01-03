import { LANDMARK_STRIDE, type LandmarkBuffer } from "../../models/Landmark";
import { OneEuroFilter1D } from "./OneEuroFilter";

type Params = {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  confidenceGate: number;
};

export class PoseSmoother {
  private fx: OneEuroFilter1D[] = [];
  private fy: OneEuroFilter1D[] = [];
  private fz: OneEuroFilter1D[] = [];
  private params: Params;

  constructor(landmarkCount: number, params?: Partial<Params>) {
    this.params = {
      minCutoff: 1.0,
      beta: 0.007,
      dCutoff: 1.0,
      confidenceGate: 0.5,
      ...params,
    };

    for (let i = 0; i < landmarkCount; i++) {
      const base = { freq: 30, minCutoff: this.params.minCutoff, beta: this.params.beta, dCutoff: this.params.dCutoff };
      this.fx.push(new OneEuroFilter1D(base));
      this.fy.push(new OneEuroFilter1D(base));
      this.fz.push(new OneEuroFilter1D(base));
    }
  }

  filter(raw: LandmarkBuffer, ts: number) {
    const out = new Float32Array(raw);
    const n = Math.floor(raw.length / LANDMARK_STRIDE);

    for (let i = 0; i < n; i++) {
      const o = i * LANDMARK_STRIDE;
      const x = raw[o], y = raw[o + 1], z = raw[o + 2], c = raw[o + 3];

      if (c < this.params.confidenceGate) continue;

      out[o] = this.fx[i].filter(x, ts);
      out[o + 1] = this.fy[i].filter(y, ts);
      out[o + 2] = this.fz[i].filter(z, ts);
      out[o + 3] = c;
    }

    return out;
  }
}
