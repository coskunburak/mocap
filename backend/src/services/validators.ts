import { badRequest } from "../domain/errors";

export function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`, { field });
  }
  return value.trim();
}

export function optionalString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function requireBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be boolean`, { field });
  }
  return value;
}

export function requireInt(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`, { field });
  }
  return value as number;
}

export function requireNumber(
  value: unknown,
  field: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw badRequest(`${field} must be a number between ${min} and ${max}`, { field });
  }
  return value;
}

export function asRecord(value: unknown, field = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${field} must be an object`, { field });
  }
  return value as Record<string, unknown>;
}

export function validateCaptureMetadata(value: unknown) {
  const obj = asRecord(value, "captureMetadata");
  if (obj.schema !== "mocap.capture.v1") {
    throw badRequest("captureMetadata.schema must be mocap.capture.v1", {
      field: "captureMetadata.schema",
    });
  }
  for (const field of [
    "takeId",
    "captureSessionId",
    "deviceId",
    "deviceRole",
    "recordingStartedAt",
    "recordingEndedAt",
  ]) {
    requireString(obj[field], `captureMetadata.${field}`);
  }
  requireInt(obj.deviceIndex, "captureMetadata.deviceIndex");
  requireNumber(obj.durationMs, "captureMetadata.durationMs");
  asRecord(obj.video, "captureMetadata.video");
  asRecord(obj.quality, "captureMetadata.quality");
  asRecord(obj.sync, "captureMetadata.sync");
  asRecord(obj.app, "captureMetadata.app");
  return obj;
}

