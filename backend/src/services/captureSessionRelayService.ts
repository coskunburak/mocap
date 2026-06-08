import type { FastifyRequest } from "fastify";
import type { RawData, WebSocket } from "ws";
import { CaptureSessionRepository } from "../infra/db/repositories";
import { userIdFromRequest } from "../http/auth";

type RelayRole = "host" | "guest";

type RelayPeer = {
  socket: WebSocket;
  captureSessionId: string;
  userId: string;
  deviceId: string;
  role: RelayRole;
  connectedAt: number;
  bytesThisWindow: number;
  windowStartedAt: number;
};

type WsQuery = {
  role?: string;
  deviceId?: string;
  token?: string;
};

const MAX_MESSAGE_BYTES = 512 * 1024;
const MAX_BYTES_PER_SECOND = 3 * 1024 * 1024;

function closeQuietly(socket: WebSocket, code: number, reason: string) {
  try {
    socket.close(code, reason.slice(0, 120));
  } catch {
    // Ignore close failures on already-closing sockets.
  }
}

function socketOpen(socket: WebSocket) {
  return socket.readyState === socket.OPEN;
}

function sendJson(socket: WebSocket, payload: unknown) {
  if (!socketOpen(socket)) return;
  socket.send(JSON.stringify(payload));
}

function textFromRaw(data: RawData) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function messageSize(data: RawData) {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  return data.byteLength;
}

function roleFrom(value: string | undefined): RelayRole | null {
  return value === "host" || value === "guest" ? value : null;
}

function userIdFromWsRequest(request: FastifyRequest) {
  const token = (request.query as WsQuery | undefined)?.token;
  if (token && token.trim().length > 0) return token.trim();
  return userIdFromRequest(request);
}

export class CaptureSessionRelayService {
  private readonly peersBySession = new Map<string, Map<string, RelayPeer>>();

  constructor(private readonly sessions = new CaptureSessionRepository()) {}

  handleSocket(
    socket: WebSocket,
    request: FastifyRequest<{
      Params: { captureSessionId: string };
      Querystring: WsQuery;
    }>,
  ) {
    const pending: RawData[] = [];
    let peer: RelayPeer | null = null;

    socket.on("message", (data) => {
      if (!peer) {
        pending.push(data);
        return;
      }
      this.forward(peer, data);
    });

    socket.on("close", () => {
      if (peer) this.detach(peer, "socket_closed");
      peer = null;
    });

    socket.on("error", () => {
      if (peer) this.detach(peer, "socket_error");
      peer = null;
    });

    void this.authorize(request, socket)
      .then((authorizedPeer) => {
        if (!socketOpen(socket)) return;
        peer = authorizedPeer;
        this.attach(authorizedPeer);
        for (const data of pending.splice(0)) {
          this.forward(authorizedPeer, data);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "WebSocket rejected";
        closeQuietly(socket, 1008, message);
      });
  }

  private async authorize(
    request: FastifyRequest<{
      Params: { captureSessionId: string };
      Querystring: WsQuery;
    }>,
    socket: WebSocket,
  ): Promise<RelayPeer> {
    const captureSessionId = request.params.captureSessionId;
    const query = request.query;
    const role = roleFrom(query.role);
    const deviceId = query.deviceId?.trim();
    if (!role) throw new Error("role must be host or guest");
    if (!deviceId) throw new Error("deviceId is required");

    const userId = userIdFromWsRequest(request);
    const session = await this.sessions.get(userId, captureSessionId);
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw new Error("capture session expired");
    }
    if (session.captureMode !== "dual") {
      throw new Error("WebSocket relay is only enabled for dual capture sessions");
    }

    const devices = await this.sessions.listDevices(userId, captureSessionId);
    const device = devices.find((item) => item.deviceId === deviceId);
    if (!device) throw new Error("device is not registered in this capture session");
    if (role === "host" && !["host", "primary"].includes(device.deviceRole)) {
      throw new Error("registered device is not a host");
    }
    if (role === "guest" && !["guest", "secondary"].includes(device.deviceRole)) {
      throw new Error("registered device is not a guest");
    }

    return {
      socket,
      captureSessionId,
      userId,
      deviceId,
      role,
      connectedAt: Date.now(),
      bytesThisWindow: 0,
      windowStartedAt: Date.now(),
    };
  }

  private attach(peer: RelayPeer) {
    const sessionPeers = this.peersBySession.get(peer.captureSessionId) ?? new Map();
    this.peersBySession.set(peer.captureSessionId, sessionPeers);

    for (const existing of sessionPeers.values()) {
      if (existing.deviceId === peer.deviceId || existing.role === peer.role) {
        closeQuietly(existing.socket, 4000, "connection_replaced");
        sessionPeers.delete(existing.deviceId);
      }
    }

    sessionPeers.set(peer.deviceId, peer);
    sendJson(peer.socket, {
      type: "relay_connected",
      ts: Date.now(),
      payload: {
        captureSessionId: peer.captureSessionId,
        deviceId: peer.deviceId,
        role: peer.role,
      },
    });

    for (const other of sessionPeers.values()) {
      if (other.deviceId === peer.deviceId) continue;
      sendJson(peer.socket, {
        type: "relay_peer_joined",
        ts: Date.now(),
        payload: { deviceId: other.deviceId, role: other.role },
      });
      sendJson(other.socket, {
        type: "relay_peer_joined",
        ts: Date.now(),
        payload: { deviceId: peer.deviceId, role: peer.role },
      });
    }
  }

  private detach(peer: RelayPeer, reason: string) {
    const sessionPeers = this.peersBySession.get(peer.captureSessionId);
    if (!sessionPeers) return;
    if (sessionPeers.get(peer.deviceId)?.socket !== peer.socket) return;

    sessionPeers.delete(peer.deviceId);
    for (const other of sessionPeers.values()) {
      sendJson(other.socket, {
        type: "relay_peer_left",
        ts: Date.now(),
        payload: { deviceId: peer.deviceId, role: peer.role, reason },
      });
    }
    if (sessionPeers.size === 0) {
      this.peersBySession.delete(peer.captureSessionId);
    }
  }

  private forward(sender: RelayPeer, data: RawData) {
    const size = messageSize(data);
    if (size > MAX_MESSAGE_BYTES) {
      closeQuietly(sender.socket, 1009, "message_too_large");
      return;
    }

    const now = Date.now();
    if (now - sender.windowStartedAt >= 1000) {
      sender.windowStartedAt = now;
      sender.bytesThisWindow = 0;
    }
    sender.bytesThisWindow += size;
    if (sender.bytesThisWindow > MAX_BYTES_PER_SECOND) {
      closeQuietly(sender.socket, 1008, "rate_limit_exceeded");
      return;
    }

    const text = textFromRaw(data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      closeQuietly(sender.socket, 1003, "invalid_json");
      return;
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
      closeQuietly(sender.socket, 1003, "invalid_message");
      return;
    }

    const sessionPeers = this.peersBySession.get(sender.captureSessionId);
    if (!sessionPeers) return;
    for (const peer of sessionPeers.values()) {
      if (peer.deviceId === sender.deviceId) continue;
      if (sender.role === "host" && peer.role !== "guest") continue;
      if (sender.role === "guest" && peer.role !== "host") continue;
      if (socketOpen(peer.socket)) peer.socket.send(text);
    }
  }
}
