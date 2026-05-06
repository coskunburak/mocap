import { config } from "../config";
import { badRequest, conflict } from "../domain/errors";
import { TakeRepository, UploadRepository } from "../infra/db/repositories";
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

export class UploadService {
  constructor(
    private readonly takes = new TakeRepository(),
    private readonly uploads = new UploadRepository(),
    private readonly storage = new ObjectStorage(),
  ) {}

  async init(userId: string, takeId: string, body: unknown) {
    const take = await this.takes.get(userId, takeId);
    const obj = asRecord(body);
    const video = asRecord(obj.video, "video");
    const metadata = asRecord(obj.metadata, "metadata");
    const deviceIndex = requireInt(obj.deviceIndex ?? 0, "deviceIndex", 0, 3);
    const deviceRole = optionalString(obj.deviceRole, "primary");
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
      deviceIndex,
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
    });
    const take = await this.takes.markUploadedIfComplete(userId, takeId);
    return { ...completed, take };
  }
}
