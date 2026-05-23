import { badRequest, conflict } from "../domain/errors";
import type { ProcessingJob } from "../domain/types";
import {
  CaptureSessionRepository,
  JobRepository,
  TakeRepository,
  UploadRepository,
} from "../infra/db/repositories";
import { isMotionRetargetPresetId } from "../worker/export/retargetPresets";
import { RunPodDispatchService } from "./runpodDispatchService";
import { asRecord, optionalString } from "./validators";

const ACTIVE_STATES = new Set([
  "queued",
  "ingesting",
  "extracting_frames",
  "solving_motion",
  "cleaning",
  "exporting",
]);

export class ProcessingService {
  constructor(
    private readonly takes = new TakeRepository(),
    private readonly jobs = new JobRepository(),
    private readonly uploads = new UploadRepository(),
    private readonly captureSessions = new CaptureSessionRepository(),
    private readonly runpod = new RunPodDispatchService(),
  ) {}

  private async dispatchRunPodIfConfigured(job: ProcessingJob) {
    try {
      const dispatch = await this.runpod.dispatchJob(job.id);
      if (!dispatch.submitted) return job;
      return this.jobs.updateState({
        jobId: job.id,
        state: "queued",
        progress: 0,
        message: "RunPod request submitted; waiting for worker.",
        metrics: {
          runpodRequestId: dispatch.requestId,
          runpodStatus: dispatch.status,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "RunPod dispatch failed.";
      await this.jobs.updateState({
        jobId: job.id,
        state: "failed",
        progress: 0,
        message: "RunPod dispatch failed.",
        errorCode: "runpod_dispatch_failed",
        metrics: { reason: message },
      });
      throw conflict("RunPod dispatch failed", {
        jobId: job.id,
        reason: message,
      });
    }
  }

  async create(userId: string, takeId: string, body: unknown) {
    const take = await this.takes.get(userId, takeId);
    if (!["uploaded", "processed", "failed"].includes(take.status)) {
      throw conflict("Upload must be completed before processing can start", {
        takeStatus: take.status,
      });
    }
    const uploadedVideos = (await this.uploads.listVideosByTake(userId, take.id)).filter(
      (video) => video.status === "uploaded",
    );
    if (uploadedVideos.length < take.expectedVideoCount) {
      throw conflict("All expected capture videos must be uploaded before processing can start", {
        uploadedVideoCount: uploadedVideos.length,
        expectedVideoCount: take.expectedVideoCount,
      });
    }
    const obj = asRecord(body ?? {});
    const defaultPreset =
      take.captureMode === "pro_4_camera"
        ? "humanoid_bvh_pro_4_camera_v1"
        : take.captureMode === "dual"
          ? "humanoid_bvh_dual_v1"
          : "humanoid_bvh_v1";
    const preset = optionalString(obj.preset, defaultPreset);
    if (!isMotionRetargetPresetId(preset)) {
      throw badRequest("Processing preset is not supported", { preset });
    }
    const job = await this.jobs.create({
      userId,
      projectId: take.projectId,
      takeId: take.id,
      preset,
    });
    await this.takes.updateStatus(userId, take.id, "processing");
    await Promise.all(
      Array.from(
        new Set(
          uploadedVideos
            .map((video) => video.captureSessionId)
            .filter((id): id is string => Boolean(id)),
        ),
      ).map((captureSessionId) =>
        this.captureSessions.updateStatus(userId, captureSessionId, "processing"),
      ),
    );
    return this.dispatchRunPodIfConfigured(job);
  }

  async get(userId: string, jobId: string) {
    const job = await this.jobs.get(userId, jobId);
    const timeline = await this.jobs.timeline(job.id);
    return { ...job, timeline };
  }

  async retry(userId: string, jobId: string) {
    const job = await this.jobs.get(userId, jobId);
    if (job.state !== "failed" && job.state !== "canceled") {
      throw conflict("Only failed or canceled jobs can be retried", {
        jobState: job.state,
      });
    }

    const take = await this.takes.get(userId, job.takeId);
    if (take.status !== "uploaded" && take.status !== "processing" && take.status !== "failed") {
      throw conflict("Take is not retryable", { takeStatus: take.status });
    }

    const retry = await this.jobs.create({
      userId,
      projectId: job.projectId,
      takeId: job.takeId,
      preset: job.preset,
      retryOfJobId: job.id,
    });
    await this.takes.updateStatus(userId, job.takeId, "processing");
    return this.dispatchRunPodIfConfigured(retry);
  }

  async cancel(userId: string, jobId: string) {
    const job = await this.jobs.get(userId, jobId);
    if (!ACTIVE_STATES.has(job.state)) {
      throw badRequest("Job is not active", { jobState: job.state });
    }
    const canceled = await this.jobs.updateState({
      jobId: job.id,
      state: "canceled",
      progress: job.progress,
      message: "Processing was cancelled.",
      metrics: { cancelledBy: userId },
    });
    await this.takes.updateStatus(userId, job.takeId, "failed");
    return canceled;
  }
}
