export class FPSMeter {
  private windowMs: number;
  private stamps: number[] = [];

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  tick(ts = Date.now()) {
    this.stamps.push(ts);
    const cutoff = ts - this.windowMs;
    while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
  }

  get fps() {
    if (this.stamps.length < 2) return 0;
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    if (span <= 0) return 0;
    return (this.stamps.length - 1) / (span / 1000);
  }
}
