import { config } from "../config";
import { badRequest, conflict } from "../domain/errors";
import {
  CaptureSessionRepository,
  TakeRepository,
  UploadRepository,
} from "../infra/db/repositories";
import {
  metadataStorageKey,
  ObjectStorage,
  videoStorageKey,
} from "../infra/storage/objectStorage";
import {
  asRecord,
  optionalString,
  requireBoolean,
  requireInt,
  requireNumber,
  requireString,
  validateCaptureMetadata,
} from "./validators";

function extensionFor(contentType: string, fileName?: string) {
  const lowerName = fileName?.toLowerCase() ?? "";
  if (lowerName.endsWith(".mov") || contentType === "video/quicktime") return "mov";
  if (lowerName.endsWith(".mp4") || contentType === "video/mp4") return "mp4";
  throw badRequest("video.contentType must be video/quicktime or video/mp4");
}

const ROLE_BY_CAPTURE_MODE: Record<string, Set<string>> = {
  solo: new Set(["primary"]),
  dual: new Set(["host", "guest", "primary", "secondary"]),
  pro_4_camera: new Set(["front", "right", "back", "left", "calibration"]),
};

function assertRoleForCaptureMode(captureMode: string, deviceRole: string) {
  const allowed = ROLE_BY_CAPTURE_MODE[captureMode] ?? ROLE_BY_CAPTURE_MODE.solo;
  if (!allowed.has(deviceRole)) {
    throw badRequest("deviceRole is not valid for captureMode", {
      captureMode,
      deviceRole,
      allowed: Array.from(allowed),
    });
  }
}

export class UploadService {
  constructor(
    private readonly takes = new TakeRepository(),
    private readonly uploads = new UploadRepository(),
    private readonly captureSessions = new CaptureSessionRepository(),
    private readonly storage = new ObjectStorage(),
  ) {}

  async init(userId: string, takeId: string, body: unknown) {
    const take = await this.takes.get(userId, takeId);
    const obj = asRecord(body);
    const video = asRecord(obj.video, "video");
    const metadata = asRecord(obj.metadata, "metadata");
    const captureSessionId =
      typeof obj.captureSessionId === "string" && obj.captureSessionId.trim().length > 0
        ? obj.captureSessionId.trim()
        : null;
    const deviceId =
      typeof obj.deviceId === "string" && obj.deviceId.trim().length > 0
        ? obj.deviceId.trim()
        : null;
    const deviceIndex = requireInt(obj.deviceIndex ?? 0, "deviceIndex", 0, 3);
    const deviceRole = optionalString(obj.deviceRole, "primary");
    assertRoleForCaptureMode(take.captureMode, deviceRole);
    const videoContentType = requireString(video.contentType, "video.contentType");
    const metadataContentType = requireString(metadata.contentType, "metadata.contentType");
    const videoSizeBytes = requireNumber(
      video.fileSizeBytes,
      "video.fileSizeBytes",
      1,
      config.limits.maxVideoBytes,
    );
    requireNumber(
      metadata.fileSizeBytes,
      "metadata.fileSizeBytes",
      1,
      config.limits.maxMetadataBytes,
    );

    if (metadataContentType !== "application/json") {
      throw badRequest("metadata.contentType must be application/json");
    }
    if (deviceIndex >= take.expectedVideoCount) {
      throw badRequest("deviceIndex exceeds expectedVideoCount", {
        deviceIndex,
        expectedVideoCount: take.expectedVideoCount,
      });
    }
    if (captureSessionId) {
      const captureSession = await this.captureSessions.get(userId, captureSessionId);
      if (captureSession.takeId !== take.id) {
        throw conflict("Capture session does not belong to this take", {
          captureSessionId,
          takeId: take.id,
        });
      }
      if (captureSession.expectedDeviceCount !== take.expectedVideoCount) {
        throw conflict("Capture session video count does not match take", {
          expectedDeviceCount: captureSession.expectedDeviceCount,
          takeExpectedVideoCount: take.expectedVideoCount,
        });
      }
      if (captureSession.captureMode !== take.captureMode) {
        throw conflict("Capture session mode does not match take", {
          captureSessionMode: captureSession.captureMode,
          takeCaptureMode: take.captureMode,
        });
      }
      const devices = await this.captureSessions.listDevices(userId, captureSession.id);
      const registeredDevice = devices.find((device) => device.deviceId === deviceId);
      if (!registeredDevice) {
        throw conflict("Device must be registered before uploading to a capture session", {
          captureSessionId,
          deviceId,
        });
      }
      if (registeredDevice.deviceIndex !== deviceIndex) {
        throw conflict("Registered device index does not match upload deviceIndex", {
          registeredDeviceIndex: registeredDevice.deviceIndex,
          uploadDeviceIndex: deviceIndex,
        });
      }
      if (registeredDevice.deviceRole !== deviceRole) {
        throw conflict("Registered device role does not match upload deviceRole", {
          registeredDeviceRole: registeredDevice.deviceRole,
          uploadDeviceRole: deviceRole,
        });
      }
    }

    const videoKey = videoStorageKey(
      take.id,
      deviceIndex,
      extensionFor(videoContentType, optionalString(video.fileName, "")),
    );
    const metadataKey = metadataStorageKey(take.id, deviceIndex);
    const expiresAt = new Date(Date.now() + config.storage.uploadUrlTtlSeconds * 1000);

    await this.uploads.failPendingForDevice({
      userId,
      takeId: take.id,
      deviceIndex,
    });

    const created = await this.uploads.create({
      userId,
      projectId: take.projectId,
      takeId: take.id,
      captureSessionId,
      deviceIndex,
      deviceId,
      deviceRole,
      videoStorageKey: videoKey,
      metadataStorageKey: metadataKey,
      expiresAt,
    });
    await this.takes.markUploading(userId, take.id);

    const [signedVideo, signedMetadata] = await Promise.all([
      this.storage.signedPutUrl(videoKey, videoContentType),
      this.storage.signedPutUrl(metadataKey, metadataContentType),
    ]);

    return {
      uploadSession: created.uploadSession,
      video: {
        ...signedVideo,
        maxSizeBytes: config.limits.maxVideoBytes,
        expectedSizeBytes: videoSizeBytes,
      },
      metadata: {
        ...signedMetadata,
        maxSizeBytes: config.limits.maxMetadataBytes,
      },
    };
  }

  async complete(userId: string, takeId: string, body: unknown) {
    await this.takes.get(userId, takeId);
    const obj = asRecord(body);
    const uploadSessionId = requireString(obj.uploadSessionId, "uploadSessionId");
    const videoUploaded = requireBoolean(obj.videoUploaded, "videoUploaded");
    const metadataUploaded = requireBoolean(obj.metadataUploaded, "metadataUploaded");
    if (!videoUploaded || !metadataUploaded) {
      throw badRequest("videoUploaded and metadataUploaded must both be true");
    }
    const videoSizeBytes = requireNumber(
      obj.videoSizeBytes,
      "videoSizeBytes",
      1,
      config.limits.maxVideoBytes,
    );
    const metadataSizeBytes = requireNumber(
      obj.metadataSizeBytes,
      "metadataSizeBytes",
      1,
      config.limits.maxMetadataBytes,
    );
    const captureMetadata = validateCaptureMetadata(obj.captureMetadata);

    const session = await this.uploads.getSession(userId, uploadSessionId);
    if (session.takeId !== takeId) {
      throw conflict("Upload session does not belong to this take");
    }
    if (captureMetadata.takeId !== takeId) {
      throw badRequest("captureMetadata.takeId must match route takeId", {
        routeTakeId: takeId,
        metadataTakeId: captureMetadata.takeId,
      });
    }
    if (captureMetadata.deviceIndex !== session.deviceIndex) {
      throw badRequest("captureMetadata.deviceIndex must match upload session deviceIndex", {
        sessionDeviceIndex: session.deviceIndex,
        metadataDeviceIndex: captureMetadata.deviceIndex,
      });
    }
    const take = await this.takes.get(userId, takeId);
    if (captureMetadata.captureMode !== take.captureMode) {
      throw badRequest("captureMetadata.captureMode must match take captureMode", {
        takeCaptureMode: take.captureMode,
        metadataCaptureMode: captureMetadata.captureMode,
      });
    }
    if (
      session.captureSessionId &&
      captureMetadata.captureSessionId !== session.captureSessionId
    ) {
      throw badRequest("captureMetadata.captureSessionId must match upload session", {
        sessionCaptureSessionId: session.captureSessionId,
        metadataCaptureSessionId: captureMetadata.captureSessionId,
      });
    }
    if (session.deviceId && captureMetadata.deviceId !== session.deviceId) {
      throw badRequest("captureMetadata.deviceId must match upload session", {
        sessionDeviceId: session.deviceId,
        metadataDeviceId: captureMetadata.deviceId,
      });
    }
    assertRoleForCaptureMode(take.captureMode, captureMetadata.deviceRole);
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw conflict("Upload session expired");
    }

    await Promise.all([
      this.storage.assertObject(session.videoStorageKey, videoSizeBytes),
      this.storage.assertObject(session.metadataStorageKey, metadataSizeBytes),
    ]);

    const completed = await this.uploads.complete({
      userId,
      uploadSessionId,
      videoSizeBytes,
      metadataSizeBytes,
      captureMetadata,
      syncMetadata: captureMetadata.sync,
    });
    const updatedTake = await this.takes.markUploadedIfComplete(userId, takeId);
    if (session.captureSessionId) {
      await this.captureSessions.markUploadProgress(userId, session.captureSessionId);
    }
    return { ...completed, take: updatedTake };
  }
}
