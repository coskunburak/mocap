/**
 * WebSocketPeerGuest – Guest-side dual-camera peer over backend relay.
 */

import {
  type PeerMessage,
  type DeviceInfo,
  type CommandPayload,
  type CalibrationDataPayload,
  type StatusPayload,
  PROTOCOL_VERSION,
  DEFAULT_PORT,
  createMessage,
  float32ToBase64,
} from "./PeerProtocol";
import type { PoseFrame } from "../../domain/mocap/models/PoseFrame";
import { countTrackedLandmarks } from "../../domain/mocap/models/PoseFrame";
import { LANDMARK_STRIDE } from "../../domain/mocap/models/Landmark";
import { isRelayControlMessage } from "./WebSocketRelay";
import type { PeerGuestEvent, PeerGuestListener, PeerGuestState } from "./PeerGuest";

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 500;

export class WebSocketPeerGuest {
  private _socket: WebSocket | null = null;
  private _state: PeerGuestState = "idle";
  private _listeners: PeerGuestListener[] = [];
  private _deviceId: string;
  private _deviceInfo: DeviceInfo;
  private _hostDevice: DeviceInfo | null = null;
  private _sessionId = "";
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _manualDisconnect = false;
  private _frameSeq = 0;
  private _handshakeSent = false;

  constructor(deviceInfo: DeviceInfo, private readonly url: string) {
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

  async connect(): Promise<void> {
    if (this._state !== "idle" && this._state !== "error") {
      throw new Error(`[WebSocketPeerGuest] Cannot connect in state: ${this._state}`);
    }
    this._manualDisconnect = false;
    this._reconnectAttempts = 0;
    await this._doConnect();
  }

  async disconnect(): Promise<void> {
    this._manualDisconnect = true;
    this._cancelReconnect();
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }
    this._hostDevice = null;
    this._sessionId = "";
    this._handshakeSent = false;
    this._setState("idle");
  }

  sendFrame(frame: PoseFrame): void {
    if (this._state !== "ready") return;

    const trackedCount = countTrackedLandmarks(frame, 0.3);
    const totalLandmarks = Math.floor(frame.landmarks.length / LANDMARK_STRIDE);
    const avgConfidence = totalLandmarks > 0 ? this._averageConfidence(frame.landmarks) : 0;

    this._send(
      createMessage("frame_data", this._deviceId, {
        frameId: this._frameSeq++,
        tsLocal: frame.ts,
        landmarksB64: float32ToBase64(frame.landmarks),
        worldLandmarksB64: frame.worldLandmarks
          ? float32ToBase64(frame.worldLandmarks)
          : undefined,
        trackingProfile: frame.trackingProfile ?? "pose",
        trackedCount,
        confidence: avgConfidence,
      }),
    );
  }

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

  sendStatus(status: StatusPayload): void {
    this._send(createMessage("status", this._deviceId, status));
  }

  addListener(cb: PeerGuestListener): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((listener) => listener !== cb);
    };
  }

  private async _doConnect(): Promise<void> {
    this._setState("connecting");
    this._handshakeSent = false;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;

      socket.onopen = () => {
        this._socket = socket;
        settled = true;
        resolve();
      };

      socket.onmessage = (event) => {
        this._handleRawMessage(event.data);
      };

      socket.onerror = () => {
        const error = new Error("WebSocket connection failed");
        if (!settled) {
          settled = true;
          reject(error);
        }
        this._onDisconnected(error.message);
      };

      socket.onclose = (event) => {
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || `WebSocket closed (${event.code})`));
        }
        this._onDisconnected(event.reason || `closed (${event.code})`);
      };
    });
  }

  private _handleRawMessage(data: unknown): void {
    const text = typeof data === "string" ? data : String(data ?? "");
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      console.warn("[WebSocketPeerGuest] invalid JSON");
      return;
    }

    if (isRelayControlMessage(msg)) {
      if (msg.type === "relay_peer_joined" && msg.payload.role === "host") {
        this._sendHandshake();
      } else if (msg.type === "relay_peer_left" && msg.payload.role === "host") {
        this._onDisconnected(msg.payload.reason ?? "host disconnected");
      }
      return;
    }

    this._handleMessage(msg as PeerMessage);
  }

  private _sendHandshake() {
    if (this._handshakeSent) return;
    this._handshakeSent = true;
    this._setState("handshaking");
    this._send(
      createMessage("handshake", this._deviceId, {
        device: this._deviceInfo,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
  }

  private _handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case "handshake_ack": {
        const payload = msg.payload as PeerMessage<"handshake_ack">["payload"];
        if (!payload.accepted) {
          this._setState("error");
          this._emit({ type: "error", message: payload.reason ?? "Handshake rejected" });
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
        this._send(
          createMessage("time_sync_res", this._deviceId, {
            t1: payload.t1,
            t2,
            t3: Date.now(),
          }),
        );
        if (this._state === "syncing") {
          setTimeout(() => {
            if (this._state === "syncing") {
              this._setState("ready");
              this._emit({ type: "time_sync_ready", offset: 0 });
            }
          }, 2000);
        }
        break;
      }

      case "command":
        this._emit({ type: "command", payload: msg.payload as CommandPayload });
        break;

      case "calibration_data":
        this._emit({
          type: "calibration_received",
          payload: msg.payload as CalibrationDataPayload,
        });
        break;

      case "status":
        this._emit({ type: "status_received", payload: msg.payload as StatusPayload });
        break;

      case "ping":
        this._send(createMessage("pong", this._deviceId, {}));
        break;

      default:
        console.warn(`[WebSocketPeerGuest] unhandled message type: ${msg.type}`);
    }
  }

  private _onDisconnected(reason: string): void {
    const hadHost = this._hostDevice !== null;
    this._socket = null;
    this._hostDevice = null;
    this._handshakeSent = false;

    if (hadHost) this._emit({ type: "disconnected", reason });
    if (this._manualDisconnect) {
      this._setState("idle");
      return;
    }

    if (this._reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
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
    this._reconnectTimer = setTimeout(() => {
      this._doConnect().catch((err) => {
        console.error("[WebSocketPeerGuest] reconnect failed", err);
      });
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _send(msg: PeerMessage): void {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return;
    try {
      this._socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error("[WebSocketPeerGuest] send error", err);
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
        console.error("[WebSocketPeerGuest] listener error", err);
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
