import * as FSAny from "expo-file-system/legacy";
import { env } from "../../../app/config/env";
import type { MocapSessionService } from "../../../domain/mocap/services/MocapSessionService";
import type { MocapApiClient, ApiUploadTarget } from "../../../infra/api/MocapApiClient";
import { takeRepoFs } from "../../../infra/persistence/TakeRepo.fs";
import type { CaptureMetadata } from "../../../domain/mocap/models/CaptureMetadata";
import type { Take } from "../../../domain/mocap/models/Take";
import {
  UploadManagerError,
  type UploadManager,
  type UploadManagerInput,
  type UploadProgressSnapshot,
  type UploadResult,
  type UploadStage,
} from "../domain/UploadManager";

type ExpoFS = typeof FSAny & {
  FileSystemUploadType?: { BINARY_CONTENT?: string };
  getInfoAsync: (
    uri: string,
  ) => Promise<{ exists: boolean; size?: number; uri?: string }>;
  createUploadTask?: (
    url: string,
    fileUri: string,
    options: Record<string, unknown>,
    callback?: (progress: {
      totalBytesSent: number;
      totalBytesExpectedToSend: number;
    }) => void,
  ) => { uploadAsync: () => Promise<{ status: number; body?: string } | null> };
};

const FS = FSAny as unknown as ExpoFS;

type Dependencies = Readonly<{
  api: MocapApiClient;
  sessions: MocapSessionService;
}>;

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function fileNameFromUri(uri: string, fallback: string) {
  const clean = uri.split("?")[0] ?? uri;
  const name = clean.split("/").filter(Boolean).pop();
  return name && name.includes(".") ? name : fallback;
}

function contentTypeForVideo(take: Take): "video/quicktime" | "video/mp4" {
  return take.video?.container === "mov" ? "video/quicktime" : "video/mp4";
}

function apiCaptureMode(take: Take): "solo" | "dual" | "pro_4_camera" {
  if (take.captureMode === "dual-camera") return "dual";
  return take.captureMode ?? "solo";
}

function sanitizeMetadata(metadata: CaptureMetadata): CaptureMetadata {
  const { localUri: _localUri, ...video } = metadata.video;
  return { ...metadata, video };
}

function humanStage(stage: UploadStage) {
  switch (stage) {
    case "preparing":
      return "Preparing backend upload";
    case "uploading_metadata":
      return "Uploading capture metadata";
    case "uploading_video":
      return "Uploading original video";
    case "completing":
      return "Verifying uploaded files";
    case "starting_processing":
      return "Starting motion processing";
    case "completed":
      return "Processing job created";
    case "failed":
      return "Upload failed";
    case "cancelled":
      return "Upload cancelled";
    case "idle":
    default:
      return "Waiting";
  }
}

export class SignedUrlUploadManager implements UploadManager {
  private cancelled = false;

  constructor(private readonly deps: Dependencies) {}

  cancel() {
    this.cancelled = true;
  }

  async uploadTake(input: UploadManagerInput): Promise<UploadResult> {
    this.cancelled = false;
    const attempts = Math.max(1, env.uploadRetryCount + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.uploadAttempt(input, attempt);
      } catch (error) {
        lastError = error;
        if (this.cancelled) {
          throw new UploadManagerError("Upload cancelled", "upload_cancelled", false);
        }

        const retryable =
          error instanceof UploadManagerError ? error.retryable : true;
        if (!retryable || attempt >= attempts) {
          throw error;
        }

        input.onProgress?.({
          stage: "failed",
          progress: 0,
          attempt,
          message: "Retrying upload with a fresh signed URL",
        });
      }
    }

    throw lastError;
  }

  private async uploadAttempt(
    input: UploadManagerInput,
    attempt: number,
  ): Promise<UploadResult> {
    const { take } = input;
    if (!take.video?.localUri) {
      throw new UploadManagerError("Take has no recorded video.", "missing_video", false);
    }
    if (!take.captureMetadata) {
      throw new UploadManagerError(
        "Take has no capture metadata.",
        "missing_capture_metadata",
        false,
      );
    }

    const videoInfo = await FS.getInfoAsync(take.video.localUri);
    if (!videoInfo.exists) {
      throw new UploadManagerError("Recorded video file was not found.", "missing_file", false);
    }

    const metadata = sanitizeMetadata(take.captureMetadata);
    const metadataText = JSON.stringify(metadata);
    const metadataSizeBytes = utf8ByteLength(metadataText);
    const videoSizeBytes = videoInfo.size ?? take.video.fileSizeBytes;
    const contentType = contentTypeForVideo(take);

    const emit = (snapshot: Omit<UploadProgressSnapshot, "attempt">) => {
      input.onProgress?.({ ...snapshot, attempt });
    };

    const failLocal = async (error: unknown) => {
      await takeRepoFs.updateTakeMeta(take.id, {
        remote: {
          ...(take.remote ?? {
            projectId: "",
            takeId: "",
            progress: 0,
            status: "failed" as const,
            updatedAt: Date.now(),
          }),
          status: "failed",
          progress: 0,
          errorMessage: error instanceof Error ? error.message : "Upload failed",
          updatedAt: Date.now(),
        },
      }).catch(() => undefined);
    };

    try {
      this.throwIfCancelled();
      emit({ stage: "preparing", progress: 0.04, message: humanStage("preparing") });

      const projectId =
        env.defaultProjectId ??
        take.remote?.projectId ??
        (await this.deps.api.createProject(input.projectName ?? "Mobile Captures")).id;
      const remoteTake = await this.deps.sessions.createTake(projectId, {
        name: take.name,
        captureMode: apiCaptureMode(take),
        expectedVideoCount: take.viewCount ?? 1,
      });

      await takeRepoFs.updateTakeMeta(take.id, {
        remote: {
          projectId,
          takeId: remoteTake.id,
          status: "pending_upload",
          progress: 0.05,
          updatedAt: Date.now(),
        },
      });

      const upload = await this.deps.sessions.initUpload(remoteTake.id, {
        deviceIndex: metadata.deviceIndex,
        deviceRole: metadata.deviceRole,
        video: {
          contentType,
          fileName: fileNameFromUri(
            take.video.localUri,
            `device_${metadata.deviceIndex}.${take.video.container}`,
          ),
          fileSizeBytes: videoSizeBytes,
        },
        metadata: {
          contentType: "application/json",
          fileName: `device_${metadata.deviceIndex}.json`,
          fileSizeBytes: metadataSizeBytes,
        },
      });

      await takeRepoFs.updateTakeMeta(take.id, {
        remote: {
          projectId,
          takeId: remoteTake.id,
          uploadSessionId: upload.uploadSession.id,
          status: "uploading",
          progress: 0.08,
          updatedAt: Date.now(),
        },
      });

      this.throwIfCancelled();
      emit({
        stage: "uploading_metadata",
        progress: 0.1,
        message: humanStage("uploading_metadata"),
        remoteTakeId: remoteTake.id,
        uploadSessionId: upload.uploadSession.id,
      });
      await this.uploadJson(upload.metadata, metadataText);

      this.throwIfCancelled();
      await this.uploadVideo(upload.video, take.video.localUri, (videoProgress) => {
        emit({
          stage: "uploading_video",
          progress: 0.18 + videoProgress * 0.68,
          message: humanStage("uploading_video"),
          remoteTakeId: remoteTake.id,
          uploadSessionId: upload.uploadSession.id,
        });
      });

      this.throwIfCancelled();
      emit({
        stage: "completing",
        progress: 0.9,
        message: humanStage("completing"),
        remoteTakeId: remoteTake.id,
        uploadSessionId: upload.uploadSession.id,
      });

      await this.deps.sessions.completeUpload(remoteTake.id, {
        uploadSessionId: upload.uploadSession.id,
        videoUploaded: true,
        metadataUploaded: true,
        videoSizeBytes,
        metadataSizeBytes,
        captureMetadata: metadata,
      });

      emit({
        stage: "starting_processing",
        progress: 0.95,
        message: humanStage("starting_processing"),
        remoteTakeId: remoteTake.id,
        uploadSessionId: upload.uploadSession.id,
      });

      const job = await this.deps.sessions.createProcessingJob(
        remoteTake.id,
        input.preset ?? "humanoid_bvh_v1",
      );
      const localTake = await takeRepoFs.updateTakeMeta(take.id, {
        remote: {
          projectId,
          takeId: remoteTake.id,
          uploadSessionId: upload.uploadSession.id,
          jobId: job.id,
          status: "processing",
          progress: 1,
          updatedAt: Date.now(),
        },
      });

      emit({
        stage: "completed",
        progress: 1,
        message: humanStage("completed"),
        remoteTakeId: remoteTake.id,
        uploadSessionId: upload.uploadSession.id,
        jobId: job.id,
      });

      return {
        localTake,
        remoteTakeId: remoteTake.id,
        uploadSessionId: upload.uploadSession.id,
        job,
      };
    } catch (error) {
      await failLocal(error);
      throw error;
    }
  }

  private async uploadJson(target: ApiUploadTarget, text: string) {
    const response = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: target.headers,
      body: text,
    });
    if (!response.ok) {
      throw new UploadManagerError(
        `Metadata upload failed: ${response.status}`,
        "metadata_upload_failed",
        response.status === 403 || response.status >= 500,
      );
    }
  }

  private async uploadVideo(
    target: ApiUploadTarget,
    localUri: string,
    onProgress: (progress: number) => void,
  ) {
    const uploadType =
      FS.FileSystemUploadType?.BINARY_CONTENT ?? "BINARY_CONTENT";
    if (!FS.createUploadTask) {
      throw new UploadManagerError(
        "Native upload task is not available in this runtime.",
        "upload_task_unavailable",
        false,
      );
    }

    const task = FS.createUploadTask(
      target.uploadUrl,
      localUri,
      {
        httpMethod: "PUT",
        uploadType,
        headers: target.headers,
      },
      (progress) => {
        const expected = progress.totalBytesExpectedToSend;
        if (expected > 0) {
          onProgress(Math.max(0, Math.min(1, progress.totalBytesSent / expected)));
        }
      },
    );

    const result = await task.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      throw new UploadManagerError(
        `Video upload failed: ${result?.status ?? "unknown"}`,
        "video_upload_failed",
        result == null || result.status === 403 || result.status >= 500,
      );
    }
  }

  private throwIfCancelled() {
    if (this.cancelled) {
      throw new UploadManagerError("Upload cancelled", "upload_cancelled", false);
    }
  }
}
