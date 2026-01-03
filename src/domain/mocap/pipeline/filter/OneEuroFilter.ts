// src/domain/mocap/pipeline/filter/OneEuroFilter.ts
type OneEuroParams = {
  freq: number;       // Hz (fps)
  minCutoff: number;  // Hz
  beta: number;       // speed coefficient
  dCutoff: number;    // Hz
};

function alpha(cutoff: number, freq: number) {
  const te = 1.0 / freq;
  const tau = 1.0 / (2 * Math.PI * cutoff);
  return 1.0 / (1.0 + tau / te);
}

class LowPass {
  private _y: number | null = null;
  private _s: number | null = null;

  filter(x: number, a: number) {
    if (this._y === null) {
      this._y = x;
      this._s = x;
      return x;
    }
    this._s = a * x + (1 - a) * (this._s as number);
    this._y = x;
    return this._s;
  }

  last() {
    return this._s;
  }
}

export class OneEuroFilter1D {
  private x = new LowPass();
  private dx = new LowPass();
  private lastTs: number | null = null;

  constructor(private params: OneEuroParams) {}

  setParams(p: Partial<OneEuroParams>) {
    this.params = { ...this.params, ...p };
  }

  filter(value: number, tsMs: number) {
    if (this.lastTs != null) {
      const dt = (tsMs - this.lastTs) / 1000;
      if (dt > 0.0001) this.params.freq = 1 / dt;
    }
    this.lastTs = tsMs;

    const prev = this.x.last();
    const dValue = prev == null ? 0 : (value - prev) * this.params.freq;

    const aD = alpha(this.params.dCutoff, this.params.freq);
    const edValue = this.dx.filter(dValue, aD);

    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(edValue);
    const a = alpha(cutoff, this.params.freq);
    return this.x.filter(value, a);
  }
}

export class OneEuroFilter3D {
  private fx: OneEuroFilter1D;
  private fy: OneEuroFilter1D;
  private fz: OneEuroFilter1D;

  constructor(params: OneEuroParams) {
    this.fx = new OneEuroFilter1D(params);
    this.fy = new OneEuroFilter1D(params);
    this.fz = new OneEuroFilter1D(params);
  }

  filter(x: number, y: number, z: number, tsMs: number) {
    return {
      x: this.fx.filter(x, tsMs),
      y: this.fy.filter(y, tsMs),
      z: this.fz.filter(z, tsMs),
    };
  }
}
