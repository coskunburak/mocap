/**
 * PeerProtocol – Dual-camera P2P messaging protocol.
 *
 * All messages are length-prefixed JSON over TCP.
 * Wire format: [4-byte big-endian length][JSON payload]
 *
 * Both Host and Guest speak the same protocol; the `direction` field
 * on each message type documents who typically sends it.
 */

// ─── Device identity ──────────────────────────────────────────────

export type DeviceRole = "host" | "guest";

export type DeviceInfo = Readonly<{
  deviceId: string;
  role: DeviceRole;
  name: string; // user-friendly label ("Burak's iPhone")
  platform: "ios" | "android";
  appVersion: string;
}>;

// ─── Message envelope ──────────────────────────────────────────────

export type PeerMessageType =
  | "handshake"
  | "handshake_ack"
  | "time_sync_req"
  | "time_sync_res"
  | "frame_data"
  | "command"
  | "calibration_data"
  | "status"
  | "error"
  | "ping"
  | "pong";

export type PeerMessage<T extends PeerMessageType = PeerMessageType> = Readonly<{
  type: T;
  ts: number; // sender-local Date.now()
  deviceId: string;
  seq: number; // monotonic per sender
  payload: PeerPayloadMap[T];
}>;

// ─── Payload types ─────────────────────────────────────────────────

/** Guest → Host: initial handshake */
export type HandshakePayload = Readonly<{
  device: DeviceInfo;
  protocolVersion: number;
}>;

/** Host → Guest: handshake accepted */
export type HandshakeAckPayload = Readonly<{
  device: DeviceInfo;
  protocolVersion: number;
  sessionId: string;
  accepted: boolean;
  reason?: string;
}>;

/** Either → Either: time-sync request */
export type TimeSyncReqPayload = Readonly<{
  t1: number; // sender local time
}>;

/** Either → Either: time-sync response */
export type TimeSyncResPayload = Readonly<{
  t1: number; // echoed from request
  t2: number; // responder receive time
  t3: number; // responder send time
}>;

/**
 * Guest → Host: 2D landmark frame.
 * Landmarks are sent as a compact base64-encoded Float32Array to reduce JSON overhead.
 */
export type FrameDataPayload = Readonly<{
  frameId: number;
  tsLocal: number; // frame timestamp in sender's clock
  landmarksB64: string; // base64-encoded Float32Array (33 * 4 floats)
  worldLandmarksB64?: string;
  trackingProfile: "pose" | "holistic";
  /** Bitmask or count of tracked joints so Host can decide if frame is usable */
  trackedCount: number;
  confidence: number; // average confidence 0..1
}>;

/** Host → Guest: commands */
export type CommandPayload = Readonly<{
  action:
    | "start_capture"
    | "stop_capture"
    | "start_recording"
    | "stop_recording"
    | "start_calibration"
    | "abort_calibration";
  params?: Record<string, unknown>;
}>;

/** Either → Either: calibration frame pair data */
export type CalibrationDataPayload = Readonly<{
  step: number; // calibration step index
  landmarksB64: string;
  worldLandmarksB64?: string;
  tsLocal: number;
}>;

/** Either → Either: status heartbeat */
export type StatusPayload = Readonly<{
  engineState: "idle" | "starting" | "running" | "stopping" | "error";
  trackingState: "waiting" | "searching" | "stabilizing" | "ready" | "lost";
  fps: number;
  batteryLevel?: number;
}>;

/** Either → Either: error */
export type ErrorPayload = Readonly<{
  code: string;
  message: string;
}>;

/** Ping/Pong keep-alive (empty payload) */
export type PingPayload = Record<string, never>;
export type PongPayload = Record<string, never>;

// ─── Payload map ────────────────────────────────────────────────────

export type PeerPayloadMap = {
  handshake: HandshakePayload;
  handshake_ack: HandshakeAckPayload;
  time_sync_req: TimeSyncReqPayload;
  time_sync_res: TimeSyncResPayload;
  frame_data: FrameDataPayload;
  command: CommandPayload;
  calibration_data: CalibrationDataPayload;
  status: StatusPayload;
  error: ErrorPayload;
  ping: PingPayload;
  pong: PongPayload;
};

// ─── Protocol constants ────────────────────────────────────────────

export const PROTOCOL_VERSION = 1;
export const HEADER_SIZE = 4; // 4-byte length prefix
export const MAX_MESSAGE_SIZE = 1024 * 256; // 256 KB hard limit
export const DEFAULT_PORT = 19840;
export const KEEPALIVE_INTERVAL_MS = 3_000;
export const KEEPALIVE_TIMEOUT_MS = 10_000;

// ─── Wire helpers ──────────────────────────────────────────────────

let _seq = 0;

export function createMessage<T extends PeerMessageType>(
  type: T,
  deviceId: string,
  payload: PeerPayloadMap[T],
): PeerMessage<T> {
  return {
    type,
    ts: Date.now(),
    deviceId,
    seq: ++_seq,
    payload,
  };
}

/** Encode a PeerMessage to a length-prefixed buffer ready for TCP send. */
export function encodeMessage(msg: PeerMessage): Buffer {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Accumulates TCP chunks and yields complete messages.
 * Keeps leftover bytes across calls (stateful).
 */
export class MessageFramer {
  private buf = Buffer.alloc(0);

  /** Feed raw TCP data. Returns zero or more parsed messages. */
  feed(chunk: Buffer): PeerMessage[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: PeerMessage[] = [];

    while (this.buf.length >= HEADER_SIZE) {
      const len = this.buf.readUInt32BE(0);

      if (len > MAX_MESSAGE_SIZE) {
        // Corrupt stream — reset
        console.warn("[MessageFramer] oversized message, resetting buffer");
        this.buf = Buffer.alloc(0);
        break;
      }

      if (this.buf.length < HEADER_SIZE + len) break; // need more data

      const json = this.buf.subarray(HEADER_SIZE, HEADER_SIZE + len).toString("utf-8");
      this.buf = this.buf.subarray(HEADER_SIZE + len);

      try {
        out.push(JSON.parse(json) as PeerMessage);
      } catch {
        console.warn("[MessageFramer] invalid JSON, skipping frame");
      }
    }

    return out;
  }

  reset() {
    this.buf = Buffer.alloc(0);
  }
}

// ─── Landmark encoding helpers ─────────────────────────────────────

/**
 * Encode a Float32Array as a base64 string for compact transmission.
 * React Native's btoa works on latin-1 strings, so we do byte-level encoding.
 */
export function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

/**
 * Decode a base64 string back to Float32Array.
 */
export function base64ToFloat32(b64: string): Float32Array {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}
