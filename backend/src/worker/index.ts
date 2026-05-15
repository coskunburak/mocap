import { assertWorkerRuntimeConfig, config } from "../config";
import { closeDb } from "../infra/db/postgres";
import { JobRepository } from "../infra/db/repositories";
import { WorkerJobProcessor } from "./processJob";

let shutdown = false;

function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
  const payload = {
    level,
    message,
    service: "mocap-worker",
    at: new Date().toISOString(),
    ...(data && typeof data === "object" ? { data } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  assertWorkerRuntimeConfig();
  const jobs = new JobRepository();
  const processor = new WorkerJobProcessor({ jobs });
  let lastIdleLog = 0;

  process.on("SIGINT", () => {
    shutdown = true;
  });
  process.on("SIGTERM", () => {
    shutdown = true;
  });

  log("info", "Worker started", {
    pollIntervalMs: config.worker.pollIntervalMs,
    targetFps: config.limits.workerTargetFps,
    maxWidth: config.limits.workerMaxWidth,
  });

  while (!shutdown) {
    const job = await jobs.claimNextQueued();
    if (!job) {
      const now = Date.now();
      if (now - lastIdleLog > config.worker.idleLogIntervalMs) {
        log("info", "No queued jobs.");
        lastIdleLog = now;
      }
      await sleep(config.worker.pollIntervalMs);
      continue;
    }

    log("info", "Processing job claimed", {
      jobId: job.id,
      takeId: job.takeId,
      preset: job.preset,
    });
    try {
      await processor.process(job);
      log("info", "Processing job completed", { jobId: job.id });
    } catch (error) {
      log("error", "Processing job failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await closeDb();
  log("info", "Worker stopped.");
}

void main().catch(async (error) => {
  log("error", "Worker crashed", {
    error: error instanceof Error ? error.message : String(error),
  });
  await closeDb().catch(() => undefined);
  process.exit(1);
});
