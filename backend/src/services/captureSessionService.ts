import { randomBytes } from "crypto";
import { config } from "../config";
import { badRequest, conflict } from "../domain/errors";
import {
  CaptureSessionRepository,
  ProjectRepository,
  TakeRepository,
} from "../infra/db/repositories";
import {
  asRecord,
  optionalString,
  requireInt,
  requireString,
} from "./validators";

function joinToken() {
  return randomBytes(5).toString("base64url").toUpperCase();
}

function captureModeFrom(value: unknown) {
  const captureMode = optionalString(value, "dual");
  if (!["solo", "dual", "pro_4_camera"].includes(captureMode)) {
    throw badRequest("captureMode is invalid", { captureMode });
  }
  return captureMode;
}

function defaultExpectedCount(captureMode: string) {
  if (captureMode === "pro_4_camera") return 4;
  if (captureMode === "dual") return 2;
  return 1;
}

function deviceRoleFor(index: number, requested: string | undefined, captureMode: string) {
  if (requested && requested.trim().length > 0) return requested.trim();
  if (captureMode === "pro_4_camera") {
    return ["front", "right", "back", "left"][index] ?? `camera_${index}`;
  }
  return index === 0 ? "host" : "guest";
}

function optionalInt(value: unknown, min: number, max: number) {
  if (value == null) return null;
  return requireInt(value, "deviceIndex", min, max);
}

export class CaptureSessionService {
  constructor(
    private readonly projects = new ProjectRepository(),
    private readonly takes = new TakeRepository(),
    private readonly sessions = new CaptureSessionRepository(),
  ) {}

  async create(userId: string, projectId: string, body: unknown) {
    await this.projects.get(userId, projectId);
    const obj = asRecord(body);
    const captureMode = captureModeFrom(obj.captureMode);
    const expectedDeviceCount = requireInt(
      obj.expectedDeviceCount ?? obj.expectedVideoCount ?? defaultExpectedCount(captureMode),
      "expectedDeviceCount",
      1,
      config.limits.maxExpectedVideos,
    );
    if (captureMode === "dual" && expectedDeviceCount < 2) {
      throw badRequest("dual capture requires at least two expected devices");
    }
    if (captureMode === "pro_4_camera" && expectedDeviceCount !== 4) {
      throw badRequest("pro_4_camera capture requires exactly four expected devices", {
        expectedDeviceCount,
      });
    }
    const name = optionalString(obj.name, `Dual Capture ${new Date().toISOString()}`);
    const take = await this.takes.create({
      userId,
      projectId,
      name,
      captureMode,
      expectedVideoCount: expectedDeviceCount,
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await this.sessions.create({
      userId,
      projectId,
      takeId: take.id,
      captureMode,
      expectedDeviceCount,
      joinToken: joinToken(),
      expiresAt,
      syncMetadata: obj.syncMetadata ?? null,
    });

    const hostDevice = obj.hostDevice;
    const registeredHost =
      hostDevice && typeof hostDevice === "object" && !Array.isArray(hostDevice)
        ? await this.register(userId, session.id, {
            ...(hostDevice as Record<string, unknown>),
            deviceRole: optionalString(
              (hostDevice as Record<string, unknown>).deviceRole,
              captureMode === "pro_4_camera" ? "front" : "host",
            ),
            deviceIndex: 0,
          })
        : null;

    return {
      captureSession: registeredHost?.captureSession ?? session,
      take,
      devices: registeredHost?.devices ?? [],
    };
  }

  async get(userId: string, captureSessionId: string) {
    const captureSession = await this.sessions.get(userId, captureSessionId);
    const devices = await this.sessions.listDevices(userId, captureSession.id);
    return { captureSession, devices };
  }

  async join(userId: string, body: unknown) {
    const obj = asRecord(body);
    const token = requireString(obj.joinToken, "joinToken").toUpperCase();
    const captureSession = await this.sessions.getByJoinToken(userId, token);
    if (new Date(captureSession.expiresAt).getTime() < Date.now()) {
      throw conflict("Capture session join token expired", {
        captureSessionId: captureSession.id,
      });
    }
    return this.register(userId, captureSession.id, obj);
  }

  async register(userId: string, captureSessionId: string, body: unknown) {
    const captureSession = await this.sessions.get(userId, captureSessionId);
    if (new Date(captureSession.expiresAt).getTime() < Date.now()) {
      throw conflict("Capture session expired", { captureSessionId });
    }
    const obj = asRecord(body);
    const requestedDeviceIndex = optionalInt(
      obj.deviceIndex,
      0,
      captureSession.expectedDeviceCount - 1,
    );
    if (captureSession.captureMode === "pro_4_camera" && requestedDeviceIndex == null) {
      throw badRequest("pro_4_camera device registration requires deviceIndex", {
        captureSessionId,
      });
    }
    const deviceId = requireString(obj.deviceId, "deviceId");
    const device = await this.sessions.registerDevice({
      userId,
      captureSessionId,
      deviceId,
      deviceRole: deviceRoleFor(
        requestedDeviceIndex ?? 1,
        optionalString(obj.deviceRole, ""),
        captureSession.captureMode,
      ),
      requestedDeviceIndex,
      platform: optionalString(obj.platform, ""),
      appVersion: optionalString(obj.appVersion, ""),
      metadata: obj.metadata ?? null,
    });
    const updatedSession = await this.sessions.get(userId, captureSessionId);
    const devices = await this.sessions.listDevices(userId, captureSessionId);
    return { captureSession: updatedSession, device, devices };
  }
}
