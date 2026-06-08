import { env } from "../../app/config/env";

export type RelayRole = "host" | "guest";

export type RelayControlMessage =
  | {
      type: "relay_connected";
      ts: number;
      payload: {
        captureSessionId: string;
        deviceId: string;
        role: RelayRole;
      };
    }
  | {
      type: "relay_peer_joined";
      ts: number;
      payload: {
        deviceId: string;
        role: RelayRole;
      };
    }
  | {
      type: "relay_peer_left";
      ts: number;
      payload: {
        deviceId: string;
        role: RelayRole;
        reason?: string;
      };
    };

function trimSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function wsBaseUrl() {
  const explicit = env.websocketBaseUrl.trim();
  const base = explicit.length > 0 ? explicit : env.apiBaseUrl;
  return trimSlash(base)
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:");
}

export function captureSessionWebSocketUrl(input: {
  captureSessionId: string;
  role: RelayRole;
  deviceId: string;
}) {
  const query = [
    ["role", input.role],
    ["deviceId", input.deviceId],
    ["token", env.devToken],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  return `${wsBaseUrl()}/api/capture-sessions/${encodeURIComponent(
    input.captureSessionId,
  )}/ws?${query}`;
}

export function isRelayControlMessage(value: unknown): value is RelayControlMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "relay_connected" ||
    type === "relay_peer_joined" ||
    type === "relay_peer_left"
  );
}
