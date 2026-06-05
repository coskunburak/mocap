/**
 * PeerHost – TCP server that runs on the Host phone.
 *
 * Accepts one guest connection, handles the protocol handshake,
 * time-sync, and relays commands / receives landmark frames.
 */

import { Buffer } from "buffer";
import { Platform } from "react-native";
import { NetworkInfo } from "react-native-network-info";
import TcpSocket from "react-native-tcp-socket";
import type TcpSocketType from "react-native-tcp-socket/lib/types/Socket";
import type TcpServerType from "react-native-tcp-socket/lib/types/Server";
import {
  type PeerMessage,
  type DeviceInfo,
  type FrameDataPayload,
  type CalibrationDataPayload,
  type StatusPayload,
  PROTOCOL_VERSION,
  DEFAULT_PORT,
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_TIMEOUT_MS,
  createMessage,
  encodeMessage,
  MessageFramer,
} from "./PeerProtocol";
import { TimeSync } from "./TimeSync";

// ─── Types ──────────────────────────────────────────────────────────

export type PeerHostState =
  | "idle"
  | "listening"
  | "connected"
  | "syncing"
  | "ready"
  | "error";

export type PeerHostEvent =
  | { type: "state_change"; state: PeerHostState; error?: string }
  | { type: "guest_connected"; device: DeviceInfo }
  | { type: "guest_disconnected"; reason: string }
  | { type: "frame_received"; payload: FrameDataPayload }
  | { type: "calibration_received"; payload: CalibrationDataPayload }
  | { type: "status_received"; payload: StatusPayload }
  | { type: "time_sync_ready"; offset: number; rtt: number }
  | { type: "error"; message: string };

export type PeerHostListener = (event: PeerHostEvent) => void;

// ─── Implementation ────────────────────────────────────────────────

export class PeerHost {
  private _server: TcpServerType | null = null;
  private _client: TcpSocketType | null = null;
  private _framer = new MessageFramer();
  private _timeSync = new TimeSync();
  private _state: PeerHostState = "idle";
  private _listeners: PeerHostListener[] = [];
  private _deviceId: string;
  private _deviceInfo: DeviceInfo;
  private _guestInfo: DeviceInfo | null = null;
  private _sessionId: string = "";
  private _keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private _lastPongTs = 0;
  private _syncTimer: ReturnType<typeof setInterval> | null = null;
  private _pendingSyncT1: number | null = null;

  constructor(deviceInfo: DeviceInfo) {
    this._deviceId = deviceInfo.deviceId;
    this._deviceInfo = deviceInfo;
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

  // ─── Lifecycle ──────────────────────────────────────────────────

  /** Start listening for a guest connection. */
  async start(port = DEFAULT_PORT): Promise<{ ip: string; port: number }> {
    if (this._state !== "idle") {
      throw new Error(`[PeerHost] Cannot start in state: ${this._state}`);
    }

    this._sessionId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      try {
        const server = TcpSocket.createServer((socket) => {
          this._onClientConnected(socket as TcpSocketType);
        });

        server.on("error", (err: Error) => {
          console.error("[PeerHost] server error", err);
          this._setState("error");
          this._emit({ type: "error", message: err.message });
          reject(err);
        });

        server.listen({ port, host: "0.0.0.0" }, async () => {
          const address = server.address();
          let localIp = "0.0.0.0";
          try {
            const ip = await NetworkInfo.getIPV4Address();
            if (ip) localIp = ip;
          } catch (e) {
            console.warn("[PeerHost] Failed to get local IP", e);
          }
          const listenPort = (address as any)?.port ?? port;

          console.log(`[PeerHost] listening on ${localIp}:${listenPort}`);
          this._server = server;
          this._setState("listening");
          resolve({ ip: localIp, port: listenPort });
        });
      } catch (err: any) {
        this._setState("error");
        reject(err);
      }
    });
  }

  /** Stop the server and disconnect any guest. */
  async stop(): Promise<void> {
    this._stopKeepalive();
    this._stopSyncTimer();

    if (this._client) {
      try {
        this._client.destroy();
      } catch { /* ignore */ }
      this._client = null;
    }

    if (this._server) {
      try {
        this._server.close();
      } catch { /* ignore */ }
      this._server = null;
    }

    this._framer.reset();
    this._timeSync.reset();
    this._guestInfo = null;
    this._setState("idle");
  }

  // ─── Messaging ──────────────────────────────────────────────────

  /** Send a command to the guest. */
  sendCommand(
    action: "start_capture" | "stop_capture" | "start_recording" | "stop_recording" | "start_calibration" | "abort_calibration",
    params?: Record<string, unknown>,
  ): void {
    this._send(createMessage("command", this._deviceId, { action, params }));
  }

  /** Send calibration data to guest. */
  sendCalibrationData(step: number, landmarksB64: string, tsLocal: number, worldLandmarksB64?: string): void {
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

  addListener(cb: PeerHostListener): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  // ─── Internals ──────────────────────────────────────────────────

  private _onClientConnected(socket: TcpSocketType): void {
    // Only allow one guest at a time
    if (this._client) {
      console.warn("[PeerHost] rejecting second client");
      try { socket.destroy(); } catch { /* ignore */ }
      return;
    }

    console.log("[PeerHost] client connected");
    this._client = socket;
    this._framer.reset();
    this._setState("connected");

    socket.on("data", (data: Buffer | string) => {
      const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
      const messages = this._framer.feed(buf as Buffer);
      for (const msg of messages) {
        this._handleMessage(msg);
      }
    });

    socket.on("close", () => {
      console.log("[PeerHost] client disconnected");
      this._onGuestDisconnected("connection closed");
    });

    socket.on("error", (err: Error) => {
      console.error("[PeerHost] client error", err);
      this._onGuestDisconnected(err.message);
    });
  }

  private _onGuestDisconnected(reason: string): void {
    this._stopKeepalive();
    this._stopSyncTimer();
    if (this._client) {
      try {
        this._client.destroy();
      } catch { /* ignore */ }
    }
    this._client = null;
    this._framer.reset();
    const prevGuest = this._guestInfo;
    this._guestInfo = null;

    if (prevGuest) {
      this._emit({ type: "guest_disconnected", reason });
    }

    // Go back to listening if server is still alive
    if (this._server) {
      this._setState("listening");
    } else {
      this._setState("idle");
    }
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

        // Start time sync
        this._startTimeSync();
        // Start keepalive
        this._startKeepalive();
        break;
      }

      case "time_sync_res": {
        const payload = msg.payload as PeerMessage<"time_sync_res">["payload"];
        const t4 = Date.now();
        const sample = this._timeSync.addSample(
          payload.t1,
          payload.t2,
          payload.t3,
          t4,
        );
        console.log(
          `[PeerHost] sync sample: offset=${sample.offset.toFixed(1)}ms, rtt=${sample.rtt.toFixed(1)}ms`,
        );

        if (this._timeSync.ready && this._state === "syncing") {
          this._setState("ready");
          this._emit({
            type: "time_sync_ready",
            offset: this._timeSync.offset,
            rtt: this._timeSync.state.rtt,
          });
        }
        break;
      }

      case "frame_data": {
        const payload = msg.payload as PeerMessage<"frame_data">["payload"];
        this._emit({ type: "frame_received", payload });
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

      case "pong": {
        this._lastPongTs = Date.now();
        break;
      }

      default:
        console.warn(`[PeerHost] unhandled message type: ${msg.type}`);
    }
  }

  private _startTimeSync(): void {
    this._timeSync.reset();
    let syncCount = 0;
    const MAX_SYNC_ROUNDS = 10;

    const doSync = () => {
      if (syncCount >= MAX_SYNC_ROUNDS || (this._timeSync.ready && syncCount >= 5)) {
        this._stopSyncTimer();
        return;
      }

      const t1 = Date.now();
      this._pendingSyncT1 = t1;
      this._send(createMessage("time_sync_req", this._deviceId, { t1 }));
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
      // Check timeout
      if (Date.now() - this._lastPongTs > KEEPALIVE_TIMEOUT_MS) {
        console.warn("[PeerHost] keepalive timeout");
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
    if (!this._client) return;
    try {
      const buf = encodeMessage(msg);
      this._client.write(buf as any);
    } catch (err) {
      console.error("[PeerHost] send error", err);
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
        console.error("[PeerHost] listener error", err);
      }
    }
  }


}
