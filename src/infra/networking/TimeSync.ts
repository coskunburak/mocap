/**
 * TimeSync – NTP-like clock offset estimation between two devices.
 *
 * Algorithm:
 *   1. Host sends time_sync_req with t1 (local send time)
 *   2. Guest receives at t2 (guest local time), responds with t1, t2, t3 (guest send time)
 *   3. Host receives at t4 (local receive time)
 *   4. offset = ((t2 - t1) + (t3 - t4)) / 2
 *   5. RTT = (t4 - t1) - (t3 - t2)
 *
 * We collect N samples, discard outliers, and take the median offset.
 * Guest timestamps can then be converted: guestTs + offset ≈ hostTs
 */

export type TimeSyncSample = Readonly<{
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  offset: number; // (t2-t1 + t3-t4) / 2
  rtt: number; // (t4-t1) - (t3-t2)
}>;

export type TimeSyncState = Readonly<{
  /** Current best offset estimate (add to guest ts to get host ts) */
  offset: number;
  /** Round-trip time of best sample */
  rtt: number;
  /** Number of samples collected */
  sampleCount: number;
  /** Whether sync is considered ready (enough good samples) */
  ready: boolean;
  /** All raw samples for debugging */
  samples: readonly TimeSyncSample[];
}>;

const MIN_SAMPLES = 5;
const MAX_SAMPLES = 20;
const RTT_OUTLIER_FACTOR = 2.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export class TimeSync {
  private _samples: TimeSyncSample[] = [];
  private _offset = 0;
  private _rtt = Infinity;
  private _ready = false;

  get state(): TimeSyncState {
    return {
      offset: this._offset,
      rtt: this._rtt,
      sampleCount: this._samples.length,
      ready: this._ready,
      samples: this._samples,
    };
  }

  get offset(): number {
    return this._offset;
  }

  get ready(): boolean {
    return this._ready;
  }

  /**
   * Add a completed round-trip sample.
   * @param t1 Host send time (host clock)
   * @param t2 Guest receive time (guest clock)
   * @param t3 Guest send time (guest clock)
   * @param t4 Host receive time (host clock)
   */
  addSample(t1: number, t2: number, t3: number, t4: number): TimeSyncSample {
    const offset = ((t2 - t1) + (t3 - t4)) / 2;
    const rtt = (t4 - t1) - (t3 - t2);
    const sample: TimeSyncSample = { t1, t2, t3, t4, offset, rtt };

    this._samples.push(sample);

    // Keep only the most recent MAX_SAMPLES
    if (this._samples.length > MAX_SAMPLES) {
      this._samples = this._samples.slice(-MAX_SAMPLES);
    }

    this._recalculate();
    return sample;
  }

  /** Convert a guest-clock timestamp to host-clock. */
  guestToHost(guestTs: number): number {
    // offset = ((t2 - t1) + (t3 - t4)) / 2
    // meaning: guestClock ≈ hostClock + offset
    // so: hostTs ≈ guestTs - offset
    return guestTs - this._offset;
  }

  /** Convert a host-clock timestamp to guest-clock. */
  hostToGuest(hostTs: number): number {
    return hostTs + this._offset;
  }

  reset(): void {
    this._samples = [];
    this._offset = 0;
    this._rtt = Infinity;
    this._ready = false;
  }

  private _recalculate(): void {
    if (this._samples.length < MIN_SAMPLES) {
      this._ready = false;
      // Even with few samples, use median of what we have
      if (this._samples.length > 0) {
        this._offset = median(this._samples.map((s) => s.offset));
        this._rtt = median(this._samples.map((s) => s.rtt));
      }
      return;
    }

    // Remove RTT outliers: discard samples whose RTT > median * factor
    const rtts = this._samples.map((s) => s.rtt);
    const medianRtt = median(rtts);
    const rttThreshold = Math.max(medianRtt * RTT_OUTLIER_FACTOR, 5); // at least 5ms

    const good = this._samples.filter((s) => s.rtt <= rttThreshold && s.rtt >= 0);

    if (good.length < 3) {
      // Not enough good samples, use all
      this._offset = median(this._samples.map((s) => s.offset));
      this._rtt = medianRtt;
      this._ready = this._samples.length >= MIN_SAMPLES;
      return;
    }

    this._offset = median(good.map((s) => s.offset));
    this._rtt = median(good.map((s) => s.rtt));
    this._ready = true;
  }
}
