/**
 * FrameMatcher – Match frames from two cameras by timestamp.
 *
 * Takes into account clock offset from TimeSync and pairs frames
 * that fall within a configurable tolerance window.
 */

import type { PoseFrame } from "../../models/PoseFrame";

// ─── Types ──────────────────────────────────────────────────────────

export type MatchedFramePair = Readonly<{
  /** Frame from Camera A (host/local) */
  frameA: PoseFrame;
  /** Frame from Camera B (guest/remote), timestamp already adjusted to host clock */
  frameB: PoseFrame;
  /** Absolute time difference between matched frames (ms, after clock offset) */
  timeDelta: number;
  /** Host-clock timestamp of the match (midpoint) */
  matchTs: number;
}>;

export type FrameMatcherOptions = Readonly<{
  /** Maximum allowed time difference for a match (ms). Default: 20ms (~1 frame at 60fps) */
  toleranceMs?: number;
  /** Maximum frames to buffer before dropping old ones. Default: 30 */
  maxBufferSize?: number;
}>;

// ─── Implementation ────────────────────────────────────────────────

const DEFAULT_TOLERANCE_MS = 20;
const DEFAULT_MAX_BUFFER = 30;

export class FrameMatcher {
  private _toleranceMs: number;
  private _maxBuffer: number;
  private _clockOffset: number = 0;

  /** Buffered remote (Camera B) frames, sorted by adjusted timestamp */
  private _remoteBuffer: PoseFrame[] = [];

  /** Stats */
  private _matchCount = 0;
  private _dropCount = 0;

  constructor(options?: FrameMatcherOptions) {
    this._toleranceMs = options?.toleranceMs ?? DEFAULT_TOLERANCE_MS;
    this._maxBuffer = options?.maxBufferSize ?? DEFAULT_MAX_BUFFER;
  }

  get stats() {
    return {
      matchCount: this._matchCount,
      dropCount: this._dropCount,
      bufferSize: this._remoteBuffer.length,
    };
  }

  /**
   * Update the clock offset (guest clock - host clock).
   * This value is subtracted from remote timestamps to align them with host time.
   */
  setClockOffset(offset: number): void {
    this._clockOffset = offset;
  }

  /**
   * Push a remote (Camera B / guest) frame into the buffer.
   * The frame's timestamp will be adjusted by the clock offset.
   */
  pushRemoteFrame(frame: PoseFrame): void {
    // Adjust timestamp to host clock
    const adjustedTs = frame.ts - this._clockOffset;
    const adjusted: PoseFrame = { ...frame, ts: adjustedTs };

    // Insert in sorted order
    let insertIdx = this._remoteBuffer.length;
    for (let i = this._remoteBuffer.length - 1; i >= 0; i--) {
      if (this._remoteBuffer[i].ts <= adjustedTs) {
        insertIdx = i + 1;
        break;
      }
      if (i === 0) insertIdx = 0;
    }
    this._remoteBuffer.splice(insertIdx, 0, adjusted);

    // Trim buffer
    while (this._remoteBuffer.length > this._maxBuffer) {
      this._remoteBuffer.shift();
      this._dropCount++;
    }
  }

  /**
   * Try to match a local (Camera A / host) frame with the closest remote frame.
   * Returns null if no match is found within tolerance.
   *
   * Matched remote frames are consumed (removed from buffer).
   */
  matchLocalFrame(localFrame: PoseFrame): MatchedFramePair | null {
    if (this._remoteBuffer.length === 0) return null;

    const localTs = localFrame.ts;

    // Find the closest remote frame by timestamp
    let bestIdx = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < this._remoteBuffer.length; i++) {
      const delta = Math.abs(this._remoteBuffer[i].ts - localTs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestDelta > this._toleranceMs) {
      return null;
    }

    // Consume the matched frame
    const matchedRemote = this._remoteBuffer[bestIdx];
    this._remoteBuffer.splice(bestIdx, 1);

    // Also clean up any remote frames older than the matched one
    // (they'll never be matched since local frames are monotonically increasing)
    const cutoff = matchedRemote.ts - this._toleranceMs;
    while (this._remoteBuffer.length > 0 && this._remoteBuffer[0].ts < cutoff) {
      this._remoteBuffer.shift();
      this._dropCount++;
    }

    this._matchCount++;

    return {
      frameA: localFrame,
      frameB: matchedRemote,
      timeDelta: bestDelta,
      matchTs: (localTs + matchedRemote.ts) / 2,
    };
  }

  /**
   * Get the latest remote frame without consuming it (for preview purposes).
   */
  peekLatestRemote(): PoseFrame | null {
    return this._remoteBuffer.length > 0
      ? this._remoteBuffer[this._remoteBuffer.length - 1]
      : null;
  }

  /** Clear all buffered frames and reset stats. */
  reset(): void {
    this._remoteBuffer = [];
    this._matchCount = 0;
    this._dropCount = 0;
  }
}
