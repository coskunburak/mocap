/**
 * PeerGuest – TCP client that connects to the Host phone.
 *
 * Sends 2D landmark frames, responds to time-sync and commands.
 */

import TcpSocket from "react-native-tcp-socket";
import type TcpSocketType from "react-native-tcp-socket/lib/types/Socket";
import {
  type PeerMessage,
  type DeviceInfo,
  type CommandPayload,
  type CalibrationDataPayload,
  type StatusPayload,
  PROTOCOL_VERSION,
  DEFAULT_PORT,
  KEEPALIVE_INTERVAL_MS,
  createMessage,
  encodeMessage,
  MessageFramer,
  float32ToBase64,
} from "./PeerProtocol";
import type { PoseFrame } from "../../domain/mocap/models/PoseFrame";
import { countTrackedLandmarks } from "../../domain/mocap/models/PoseFrame";
import { LANDMARK_STRIDE } from "../../domain/mocap/models/Landmark";

// ─── Types ──────────────────────────────────────────────────────────

export type PeerGuestState =
  | "idle"
  | "connecting"
  | "handshaking"
  | "syncing"
  | "ready"
  | "error";

export type PeerGuestEvent =
  | { type: "state_change"; state: PeerGuestState; error?: string }
  | { type: "connected"; hostDevice: DeviceInfo; sessionId: string }
  | { type: "disconnected"; reason: string }
  | { type: "command"; payload: CommandPayload }
  | { type: "calibration_received"; payload: CalibrationDataPayload }
  | { type: "status_received"; payload: StatusPayload }
  | { type: "time_sync_ready"; offset: number }
  | { type: "error"; message: string };

export type PeerGuestListener = (event: PeerGuestEvent) => void;

// ─── Implementation ────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 500;

export class PeerGuest {
  private _socket: TcpSocketType | null = null;
  private _framer = new MessageFramer();
  private _state: PeerGuestState = "idle";
  private _listeners: PeerGuestListener[] = [];
  private _deviceId: string;
  private _deviceInfo: DeviceInfo;
  private _hostDevice: DeviceInfo | null = null;
  private _sessionId: string = "";
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _hostIp: string = "";
  private _hostPort: number = DEFAULT_PORT;
  private _frameSeq = 0;
  private _manualDisconnect = false;

  /** Average confidence of last sent frame (for UI feedback) */
  private _lastSentConfidence = 0;

  constructor(deviceInfo: DeviceInfo) {
    this._deviceId = deviceInfo.deviceId;
    this._deviceInfo = deviceInfo;
  }

  get state(): PeerGuestState {
    return this._state;
  }

  get hostDevice(): DeviceInfo | null {
    return this._hostDevice;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /** Connect to a Host by IP and port. */
  async connect(ip: string, port = DEFAULT_PORT): Promise<void> {
    if (this._state !== "idle" && this._state !== "error") {
      throw new Error(`[PeerGuest] Cannot connect in state: ${this._state}`);
    }

    this._hostIp = ip;
    this._hostPort = port;
    this._reconnectAttempts = 0;
    this._manualDisconnect = false;
    await this._doConnect();
  }

  /** Disconnect from Host. */
  async disconnect(): Promise<void> {
    this._manualDisconnect = true;
    this._cancelReconnect();
    if (this._socket) {
      try {
        this._socket.destroy();
      } catch { /* ignore */ }
      this._socket = null;
    }

    this._framer.reset();
    this._hostDevice = null;
    this._hostIp = "";
    this._hostPort = DEFAULT_PORT;
    this._setState("idle");
  }

  // ─── Messaging ──────────────────────────────────────────────────

  /**
   * Send a pose frame to the Host.
   * Only sends the 2D landmarks (compact) — Host will triangulate.
   */
  sendFrame(frame: PoseFrame): void {
    if (this._state !== "ready") return;

    const trackedCount = countTrackedLandmarks(frame, 0.3);
    const totalLandmarks = Math.floor(frame.landmarks.length / LANDMARK_STRIDE);
    const avgConfidence = totalLandmarks > 0
      ? this._averageConfidence(frame.landmarks)
      : 0;

    this._lastSentConfidence = avgConfidence;

    const msg = createMessage("frame_data", this._deviceId, {
      frameId: this._frameSeq++,
      tsLocal: frame.ts,
      landmarksB64: float32ToBase64(frame.landmarks),
      worldLandmarksB64: frame.worldLandmarks
        ? float32ToBase64(frame.worldLandmarks)
        : undefined,
      trackingProfile: frame.trackingProfile ?? "pose",
      trackedCount,
      confidence: avgConfidence,
    });

    this._send(msg);
  }

  /** Send calibration data to Host. */
  sendCalibrationData(
    step: number,
    landmarksB64: string,
    tsLocal: number,
    worldLandmarksB64?: string,
  ): void {
    this._send(
      createMessage("calibration_data", this._deviceId, {
        step,
        landmarksB64,
        worldLandmarksB64,
        tsLocal,
      }),
    );
  }

  /** Send status heartbeat. */
  sendStatus(status: StatusPayload): void {
    this._send(createMessage("status", this._deviceId, status));
  }

  // ─── Listeners ──────────────────────────────────────────────────

  addListener(cb: PeerGuestListener): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  // ─── Internals ──────────────────────────────────────────────────

  private async _doConnect(): Promise<void> {
    this._setState("connecting");
    this._framer.reset();

    return new Promise<void>((resolve, reject) => {
      try {
        const socket = TcpSocket.createConnection(
          {
            host: this._hostIp,
            port: this._hostPort,
          },
          () => {
            console.log(`[PeerGuest] connected to ${this._hostIp}:${this._hostPort}`);
            this._socket = socket as TcpSocketType;
            this._reconnectAttempts = 0;

            // Send handshake
            this._setState("handshaking");
            this._send(
              createMessage("handshake", this._deviceId, {
                device: this._deviceInfo,
                protocolVersion: PROTOCOL_VERSION,
              }),
            );
            resolve();
          },
        );

        socket.on("data", (data: Buffer | string) => {
          const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
          const messages = this._framer.feed(buf as Buffer);
          for (const msg of messages) {
            this._handleMessage(msg);
          }
        });

        socket.on("close", () => {
          console.log("[PeerGuest] disconnected");
          this._onDisconnected("connection closed");
        });

        socket.on("error", (err: Error) => {
          console.error("[PeerGuest] socket error", err);
          if (this._state === "connecting") {
            reject(err);
          }
          this._onDisconnected(err.message);
        });
      } catch (err: any) {
        this._setState("error");
        reject(err);
      }
    });
  }

  private _onDisconnected(reason: string): void {
    this._socket = null;
    this._framer.reset();
    const hadHost = this._hostDevice !== null;
    this._hostDevice = null;

    if (hadHost) {
      this._emit({ type: "disconnected", reason });
    }

    if (this._manualDisconnect) {
      this._hostIp = "";
      this._hostPort = DEFAULT_PORT;
      this._setState("idle");
      return;
    }

    // Attempt reconnect
    if (this._reconnectAttempts < MAX_RECONNECT_ATTEMPTS && this._hostIp) {
      this._scheduleReconnect();
    } else {
      this._setState("error");
      this._emit({ type: "error", message: `Disconnected: ${reason}` });
    }
  }

  private _scheduleReconnect(): void {
    this._cancelReconnect();
    const delay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts);
    this._reconnectAttempts++;
    console.log(
      `[PeerGuest] reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`,
    );

    this._reconnectTimer = setTimeout(() => {
      this._doConnect().catch((err) => {
        console.error("[PeerGuest] reconnect failed", err);
      });
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case "handshake_ack": {
        const payload = msg.payload as PeerMessage<"handshake_ack">["payload"];
        if (!payload.accepted) {
          this._setState("error");
          this._emit({
            type: "error",
            message: payload.reason ?? "Handshake rejected",
          });
          return;
        }

        this._hostDevice = payload.device;
        this._sessionId = payload.sessionId;
        this._setState("syncing");
        this._emit({
          type: "connected",
          hostDevice: payload.device,
          sessionId: payload.sessionId,
        });
        break;
      }

      case "time_sync_req": {
        const payload = msg.payload as PeerMessage<"time_sync_req">["payload"];
        const t2 = Date.now();
        // respond immediately with t1 (echoed), t2, t3
        const t3 = Date.now();
        this._send(
          createMessage("time_sync_res", this._deviceId, {
            t1: payload.t1,
            t2,
            t3,
          }),
        );

        // After several sync exchanges, consider ourselves synced
        // (Host tracks the actual sync state)
        if (this._state === "syncing") {
          // We'll transition to ready when we get a command or after a delay
          setTimeout(() => {
            if (this._state === "syncing") {
              this._setState("ready");
              this._emit({ type: "time_sync_ready", offset: 0 });
            }
          }, 2000);
        }
        break;
      }

      case "command": {
        const payload = msg.payload as PeerMessage<"command">["payload"];
        this._emit({ type: "command", payload });
        break;
      }

      case "calibration_data": {
        const payload = msg.payload as PeerMessage<"calibration_data">["payload"];
        this._emit({ type: "calibration_received", payload });
        break;
      }

      case "status": {
        const payload = msg.payload as PeerMessage<"status">["payload"];
        this._emit({ type: "status_received", payload });
        break;
      }

      case "ping": {
        this._send(createMessage("pong", this._deviceId, {}));
        break;
      }

      default:
        console.warn(`[PeerGuest] unhandled message type: ${msg.type}`);
    }
  }

  private _send(msg: PeerMessage): void {
    if (!this._socket) return;
    try {
      const buf = encodeMessage(msg);
      this._socket.write(buf as any);
    } catch (err) {
      console.error("[PeerGuest] send error", err);
    }
  }

  private _setState(state: PeerGuestState): void {
    if (this._state === state) return;
    this._state = state;
    this._emit({ type: "state_change", state });
  }

  private _emit(event: PeerGuestEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[PeerGuest] listener error", err);
      }
    }
  }

  private _averageConfidence(buf: Float32Array): number {
    const count = Math.floor(buf.length / LANDMARK_STRIDE);
    if (count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += buf[i * LANDMARK_STRIDE + 3] ?? 0;
    }
    return sum / count;
  }
}
