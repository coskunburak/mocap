/**
 * WebSocketPeerHost – Host-side dual-camera peer over backend relay.
 */

import {
  type PeerMessage,
  type DeviceInfo,
  type FrameDataPayload,
  type CalibrationDataPayload,
  type StatusPayload,
  PROTOCOL_VERSION,
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_TIMEOUT_MS,
  createMessage,
  MessageFramer,
} from "./PeerProtocol";
import { TimeSync } from "./TimeSync";
import { isRelayControlMessage } from "./WebSocketRelay";
import type { PeerHostEvent, PeerHostListener, PeerHostState } from "./PeerHost";

export class WebSocketPeerHost {
  private _socket: WebSocket | null = null;
  private _framer = new MessageFramer();
  private _timeSync = new TimeSync();
  private _state: PeerHostState = "idle";
  private _listeners: PeerHostListener[] = [];
  private _deviceId: string;
  private _deviceInfo: DeviceInfo;
  private _guestInfo: DeviceInfo | null = null;
  private _sessionId: string;
  private _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _lastPongTs = 0;
  private _syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deviceInfo: DeviceInfo, private readonly url: string, sessionId: string) {
    this._deviceId = deviceInfo.deviceId;
    this._deviceInfo = deviceInfo;
    this._sessionId = sessionId;
  }

  get state(): PeerHostState {
    return this._state;
  }

  get guestInfo(): DeviceInfo | null {
    return this._guestInfo;
  }

  get timeSync(): TimeSync {
    return this._timeSync;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  async start(): Promise<void> {
    if (this._state !== "idle") {
      throw new Error(`[WebSocketPeerHost] Cannot start in state: ${this._state}`);
    }
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;

      socket.onopen = () => {
        this._socket = socket;
        this._setState("listening");
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
        this._emit({ type: "error", message: error.message });
      };

      socket.onclose = (event) => {
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || `WebSocket closed (${event.code})`));
        }
        this._onSocketClosed(event.reason || `closed (${event.code})`);
      };
    });
  }

  async stop(): Promise<void> {
    this._stopKeepalive();
    this._stopSyncTimer();
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }
    this._framer.reset();
    this._timeSync.reset();
    this._guestInfo = null;
    this._setState("idle");
  }

  sendCommand(
    action:
      | "start_capture"
      | "stop_capture"
      | "start_recording"
      | "stop_recording"
      | "start_calibration"
      | "abort_calibration",
    params?: Record<string, unknown>,
  ): void {
    this._send(createMessage("command", this._deviceId, { action, params }));
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

  addListener(cb: PeerHostListener): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((listener) => listener !== cb);
    };
  }

  private _handleRawMessage(data: unknown): void {
    const text = typeof data === "string" ? data : String(data ?? "");
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      console.warn("[WebSocketPeerHost] invalid JSON");
      return;
    }

    if (isRelayControlMessage(msg)) {
      if (msg.type === "relay_peer_left" && msg.payload.role === "guest") {
        this._onGuestDisconnected(msg.payload.reason ?? "guest disconnected");
      }
      return;
    }

    this._handleMessage(msg as PeerMessage);
  }

  private _onSocketClosed(reason: string): void {
    this._stopKeepalive();
    this._stopSyncTimer();
    this._socket = null;
    this._framer.reset();
    const hadGuest = this._guestInfo !== null;
    this._guestInfo = null;
    if (hadGuest) this._emit({ type: "guest_disconnected", reason });
    if (this._state !== "idle") this._setState("error");
  }

  private _onGuestDisconnected(reason: string): void {
    this._stopKeepalive();
    this._stopSyncTimer();
    this._framer.reset();
    const hadGuest = this._guestInfo !== null;
    this._guestInfo = null;
    this._timeSync.reset();
    if (hadGuest) this._emit({ type: "guest_disconnected", reason });
    if (this._socket) this._setState("listening");
  }

  private _handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case "handshake": {
        const payload = msg.payload as PeerMessage<"handshake">["payload"];
        if (payload.protocolVersion !== PROTOCOL_VERSION) {
          this._send(
            createMessage("handshake_ack", this._deviceId, {
              device: this._deviceInfo,
              protocolVersion: PROTOCOL_VERSION,
              sessionId: this._sessionId,
              accepted: false,
              reason: `Protocol mismatch: expected ${PROTOCOL_VERSION}, got ${payload.protocolVersion}`,
            }),
          );
          return;
        }

        this._guestInfo = payload.device;
        this._send(
          createMessage("handshake_ack", this._deviceId, {
            device: this._deviceInfo,
            protocolVersion: PROTOCOL_VERSION,
            sessionId: this._sessionId,
            accepted: true,
          }),
        );
        this._emit({ type: "guest_connected", device: payload.device });
        this._setState("syncing");
        this._startTimeSync();
        this._startKeepalive();
        break;
      }

      case "time_sync_res": {
        const payload = msg.payload as PeerMessage<"time_sync_res">["payload"];
        const sample = this._timeSync.addSample(payload.t1, payload.t2, payload.t3, Date.now());
        if (this._timeSync.ready && this._state === "syncing") {
          this._setState("ready");
          this._emit({
            type: "time_sync_ready",
            offset: this._timeSync.offset,
            rtt: sample.rtt,
          });
        }
        break;
      }

      case "frame_data":
        this._emit({ type: "frame_received", payload: msg.payload as FrameDataPayload });
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

      case "pong":
        this._lastPongTs = Date.now();
        break;

      default:
        console.warn(`[WebSocketPeerHost] unhandled message type: ${msg.type}`);
    }
  }

  private _startTimeSync(): void {
    this._timeSync.reset();
    let syncCount = 0;
    const maxSyncRounds = 10;
    const doSync = () => {
      if (syncCount >= maxSyncRounds || (this._timeSync.ready && syncCount >= 5)) {
        this._stopSyncTimer();
        return;
      }
      this._send(createMessage("time_sync_req", this._deviceId, { t1: Date.now() }));
      syncCount++;
    };

    doSync();
    this._syncTimer = setInterval(doSync, 300);
  }

  private _stopSyncTimer(): void {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }

  private _startKeepalive(): void {
    this._lastPongTs = Date.now();
    this._keepaliveTimer = setInterval(() => {
      if (Date.now() - this._lastPongTs > KEEPALIVE_TIMEOUT_MS) {
        this._onGuestDisconnected("keepalive timeout");
        return;
      }
      this._send(createMessage("ping", this._deviceId, {}));
    }, KEEPALIVE_INTERVAL_MS);
  }

  private _stopKeepalive(): void {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
  }

  private _send(msg: PeerMessage): void {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return;
    try {
      this._socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error("[WebSocketPeerHost] send error", err);
    }
  }

  private _setState(state: PeerHostState): void {
    if (this._state === state) return;
    this._state = state;
    this._emit({ type: "state_change", state });
  }

  private _emit(event: PeerHostEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[WebSocketPeerHost] listener error", err);
      }
    }
  }
}
