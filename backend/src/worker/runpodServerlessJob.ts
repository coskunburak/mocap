import { assertWorkerRuntimeConfig } from "../config";
import { closeDb } from "../infra/db/postgres";
import { JobRepository } from "../infra/db/repositories";
import { WorkerJobProcessor } from "./processJob";

function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
  const payload = {
    level,
    message,
    service: "mocap-runpod-serverless-job",
    at: new Date().toISOString(),
    ...(data && typeof data === "object" ? { data } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  assertWorkerRuntimeConfig();
  const jobId = valueAfter("--job-id");
  const claimNext = process.argv.includes("--claim-next");
  const jobs = new JobRepository();
  const processor = new WorkerJobProcessor({ jobs });
  const job = jobId ? await jobs.claimQueuedById(jobId) : await jobs.claimNextQueued();

  if (!job) {
    log("warn", "No queued job was claimed.", {
      jobId,
      claimNext,
    });
    return;
  }

  log("info", "Processing RunPod serverless job.", {
    jobId: job.id,
    takeId: job.takeId,
    preset: job.preset,
  });
  await processor.process(job);
  log("info", "RunPod serverless job completed.", { jobId: job.id });
}

void main()
  .catch((error) => {
    log("error", "RunPod serverless job failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
