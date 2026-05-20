import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

type Args = {
  apiBaseUrl: string;
  token: string;
  videoPath: string;
  outputDir: string;
  preset: string;
  timeoutMs: number;
  pollMs: number;
};

type ApiProject = { id: string };
type ApiTake = { id: string; status: string };
type ApiUploadSession = { id: string };
type ApiUploadTarget = {
  uploadUrl: string;
  headers: Record<string, string>;
};
type ApiJob = {
  id: string;
  takeId: string;
  state: string;
  progress: number;
  message?: string | null;
};
type ApiExportFile = {
  id: string;
  format: string;
  storageKey: string;
  fileSizeBytes: number | null;
  createdAt: string;
};
type Check = {
  name: string;
  ok: boolean;
  details?: string;
};

const REQUIRED_EXPORT_FORMATS = [
  "smpl_parameters_json",
  "raw_solved_motion_json",
  "solved_motion_json",
  "cleanup_report_json",
  "bvh",
  "quality_report_json",
  "preview_summary_json",
  "motion_pipeline_report_json",
] as const;

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${item}`);
    }
    values.set(item.slice(2), next);
    index += 1;
  }

  const videoPath = values.get("video");
  if (!videoPath) throw new Error("--video is required");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    apiBaseUrl:
      values.get("api-base-url") ??
      process.env.MOCAP_API_BASE_URL ??
      "http://127.0.0.1:4010",
    token: values.get("token") ?? process.env.MOCAP_API_TOKEN ?? "dev-user-id",
    videoPath: path.resolve(videoPath),
    outputDir: path.resolve(
      values.get("output-dir") ??
        path.join(process.cwd(), "..", ".local-artifacts", "wham-live-api-job", runId),
    ),
    preset: values.get("preset") ?? "humanoid_bvh_quality_v1_5",
    timeoutMs: Number(values.get("timeout-ms") ?? 600_000),
    pollMs: Number(values.get("poll-ms") ?? 2_000),
  };
}

function joinUrl(baseUrl: string, route: string) {
  return `${baseUrl.replace(/\/$/, "")}${route}`;
}

async function apiRequest<T>(
  args: Args,
  route: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(joinUrl(args.apiBaseUrl, route), {
    ...options,
    headers: {
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${route} failed: ${response.status} ${text}`);
  }
  return text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
}

async function putSigned(target: ApiUploadTarget, body: string | Buffer) {
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: target.headers,
    body: body as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`Signed upload failed: ${response.status} ${await response.text()}`);
  }
}

async function readSignedJson<T>(downloadUrl: string): Promise<T> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Signed download failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function addCheck(checks: Check[], name: string, ok: boolean, details?: string) {
  checks.push({ name, ok, details });
}

function findExport(exports: ApiExportFile[], format: string) {
  return exports.find((file) => file.format === format);
}

async function downloadExportJson<T>(
  args: Args,
  exports: ApiExportFile[],
  format: string,
): Promise<T> {
  const file = findExport(exports, format);
  if (!file) throw new Error(`Missing export ${format}`);
  const signed = await apiRequest<{ downloadUrl: string; expiresAt: string }>(
    args,
    `/api/exports/${encodeURIComponent(file.id)}/download-url`,
  );
  return readSignedJson<T>(signed.downloadUrl);
}

async function pollJob(args: Args, jobId: string) {
  const startedAt = Date.now();
  let lastState = "";
  while (Date.now() - startedAt < args.timeoutMs) {
    const { job } = await apiRequest<{ job: ApiJob }>(
      args,
      `/api/jobs/${encodeURIComponent(jobId)}`,
    );
    const stateKey = `${job.state}:${job.progress}:${job.message ?? ""}`;
    if (stateKey !== lastState) {
      console.log(
        JSON.stringify({
          state: job.state,
          progress: job.progress,
          message: job.message,
        }),
      );
      lastState = stateKey;
    }
    if (job.state === "succeeded") return job;
    if (job.state === "failed" || job.state === "canceled") {
      throw new Error(`Job ${job.id} ended with state ${job.state}: ${job.message ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, args.pollMs));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });

  const videoInfo = await stat(args.videoPath);
  const { project } = await apiRequest<{ project: ApiProject }>(args, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: `WHAM Live API QA ${new Date().toISOString()}` }),
  });
  const { take } = await apiRequest<{ take: ApiTake }>(
    args,
    `/api/projects/${encodeURIComponent(project.id)}/takes`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "WHAM live API validation",
        captureMode: "solo",
        expectedVideoCount: 1,
      }),
    },
  );

  const now = new Date();
  const captureMetadata = {
    schema: "mocap.capture.v1",
    takeId: take.id,
    captureSessionId: take.id,
    deviceId: "qa_live_api_device",
    deviceRole: "primary",
    deviceIndex: 0,
    captureMode: "solo",
    recordingStartedAt: now.toISOString(),
    recordingEndedAt: new Date(now.getTime() + 22_000).toISOString(),
    durationMs: 22_000,
    video: {
      fileName: path.basename(args.videoPath),
      fileSizeBytes: videoInfo.size,
      contentType: "video/mp4",
    },
    quality: {
      source: "wham_live_api_fixture",
    },
    sync: {
      syncMethod: "single_device_clock",
      offsetMs: 0,
    },
    app: {
      platform: "qa",
      version: "wham_live_api_job",
    },
  };
  const metadataText = JSON.stringify(captureMetadata);
  const metadataSizeBytes = Buffer.byteLength(metadataText, "utf8");

  const upload = await apiRequest<{
    uploadSession: ApiUploadSession;
    video: ApiUploadTarget;
    metadata: ApiUploadTarget;
  }>(args, `/api/takes/${encodeURIComponent(take.id)}/uploads/init`, {
    method: "POST",
    body: JSON.stringify({
      deviceId: captureMetadata.deviceId,
      deviceIndex: captureMetadata.deviceIndex,
      deviceRole: captureMetadata.deviceRole,
      video: {
        contentType: "video/mp4",
        fileName: path.basename(args.videoPath),
        fileSizeBytes: videoInfo.size,
      },
      metadata: {
        contentType: "application/json",
        fileName: "device_0.json",
        fileSizeBytes: metadataSizeBytes,
      },
    }),
  });

  await putSigned(upload.metadata, metadataText);
  await putSigned(upload.video, await readFile(args.videoPath));

  const completedUpload = await apiRequest<{
    captureVideo?: { fileSizeBytes?: unknown; metadataSizeBytes?: unknown };
  }>(args, `/api/takes/${encodeURIComponent(take.id)}/uploads/complete`, {
    method: "POST",
    body: JSON.stringify({
      uploadSessionId: upload.uploadSession.id,
      videoUploaded: true,
      metadataUploaded: true,
      videoSizeBytes: videoInfo.size,
      metadataSizeBytes,
      captureMetadata,
    }),
  });

  const { job } = await apiRequest<{ job: ApiJob }>(
    args,
    `/api/takes/${encodeURIComponent(take.id)}/process`,
    {
      method: "POST",
      body: JSON.stringify({ preset: args.preset }),
    },
  );
  const completedJob = await pollJob(args, job.id);
  const { exports } = await apiRequest<{ exports: ApiExportFile[] }>(
    args,
    `/api/takes/${encodeURIComponent(take.id)}/exports`,
  );

  const solved = await downloadExportJson<{
    solver?: { name?: string; premium?: boolean; metrics?: Record<string, unknown> };
    validation?: { ok?: boolean; errors?: unknown[] };
    frameCount?: number;
    fps?: number;
    durationMs?: number;
  }>(args, exports, "solved_motion_json");
  const pipeline = await downloadExportJson<{
    engines?: { backendMotion?: string };
    fallback?: { motionFallbackUsed?: boolean; reasons?: unknown[] };
  }>(args, exports, "motion_pipeline_report_json");
  const quality = await downloadExportJson<{
    score?: number;
    grade?: string;
    errors?: unknown[];
  }>(args, exports, "quality_report_json");

  const checks: Check[] = [];
  addCheck(checks, "job_succeeded", completedJob.state === "succeeded", completedJob.state);
  addCheck(
    checks,
    "capture_video_sizes_are_numeric",
    typeof completedUpload.captureVideo?.fileSizeBytes === "number" &&
      typeof completedUpload.captureVideo?.metadataSizeBytes === "number",
    `video=${String(completedUpload.captureVideo?.fileSizeBytes)}:${
      typeof completedUpload.captureVideo?.fileSizeBytes
    }, metadata=${String(completedUpload.captureVideo?.metadataSizeBytes)}:${
      typeof completedUpload.captureVideo?.metadataSizeBytes
    }`,
  );
  for (const format of REQUIRED_EXPORT_FORMATS) {
    const file = findExport(exports, format);
    const sizeBytes = file?.fileSizeBytes ?? 0;
    addCheck(
      checks,
      `export_${format}`,
      Boolean(file && typeof file.fileSizeBytes === "number" && sizeBytes > 0),
      file
        ? `size=${String(file.fileSizeBytes)}, type=${typeof file.fileSizeBytes}`
        : "missing",
    );
  }
  addCheck(
    checks,
    "mobile_card_solver_is_wham",
    solved.solver?.name === "wham" && solved.solver?.premium === true,
    `solver=${solved.solver?.name}, premium=${String(solved.solver?.premium)}`,
  );
  addCheck(
    checks,
    "mobile_card_validation_ok",
    solved.validation?.ok === true && (solved.validation.errors?.length ?? 0) === 0,
    `errors=${solved.validation?.errors?.length ?? 0}`,
  );
  addCheck(
    checks,
    "mobile_card_wham_metrics_present",
    Number(solved.solver?.metrics?.whamFrameCount) > 0 &&
      Number(solved.solver?.metrics?.sourceVideoFrameCount) > 0,
    `whamFrameCount=${String(
      solved.solver?.metrics?.whamFrameCount,
    )}, sourceVideoFrameCount=${String(solved.solver?.metrics?.sourceVideoFrameCount)}`,
  );
  addCheck(
    checks,
    "pipeline_reports_wham",
    typeof pipeline.engines?.backendMotion === "string" &&
      pipeline.engines.backendMotion.startsWith("wham@"),
    `backendMotion=${pipeline.engines?.backendMotion ?? "missing"}`,
  );
  addCheck(
    checks,
    "no_motion_fallback",
    pipeline.fallback?.motionFallbackUsed === false,
    `motionFallbackUsed=${String(pipeline.fallback?.motionFallbackUsed)}`,
  );
  addCheck(
    checks,
    "quality_report_passed",
    Number(quality.score) >= 60 && (quality.errors?.length ?? 0) === 0,
    `score=${String(quality.score)}, grade=${quality.grade ?? "missing"}`,
  );

  const report = {
    schema: "mocap.wham_live_api_job_report.v1",
    generatedAt: new Date().toISOString(),
    ok: checks.every((check) => check.ok),
    apiBaseUrl: args.apiBaseUrl,
    projectId: project.id,
    takeId: take.id,
    jobId: completedJob.id,
    mobileRouteParams: {
      remoteTakeId: take.id,
      jobId: completedJob.id,
    },
    checks,
    exports,
    mobileSolvedMotionCard: {
      title: solved.solver?.name === "wham" ? "WHAM Premium Solve" : "Motion Solve",
      solver: solved.solver,
      validation: solved.validation,
      frameCount: solved.frameCount,
      fps: solved.fps,
      durationMs: solved.durationMs,
    },
    pipeline,
    quality,
  };

  const reportPath = path.join(args.outputDir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
