import { badRequest, conflict } from "../domain/errors";
import { JobRepository, TakeRepository } from "../infra/db/repositories";
import { asRecord, optionalString } from "./validators";

const ACTIVE_STATES = new Set([
  "queued",
  "ingesting",
  "extracting_frames",
  "detecting_pose",
  "solving_motion",
  "cleaning",
  "exporting",
]);

export class ProcessingService {
  constructor(
    private readonly takes = new TakeRepository(),
    private readonly jobs = new JobRepository(),
  ) {}

  async create(userId: string, takeId: string, body: unknown) {
    const take = await this.takes.get(userId, takeId);
    if (take.status !== "uploaded") {
      throw conflict("Upload must be completed before processing can start", {
        takeStatus: take.status,
      });
    }
    const obj = asRecord(body ?? {});
    const preset = optionalString(obj.preset, "humanoid_bvh_v1");
    const job = await this.jobs.create({
      userId,
      projectId: take.projectId,
      takeId: take.id,
      preset,
    });
    await this.takes.updateStatus(userId, take.id, "processing");
    return job;
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
    return retry;
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
