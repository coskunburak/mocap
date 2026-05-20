import { copyFile, mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import type {
  CaptureSession,
  CaptureVideo,
  ExportFile,
  ProcessingJob,
  Take,
} from "../domain/types";

type Args = {
  videoPath: string;
  whamOutputPkl: string;
  outputDir: string;
  pythonPath?: string;
};

type StoredArtifact = {
  storageKey: string;
  filePath: string;
  format?: string;
  sizeBytes: number;
};

type FixtureCheck = {
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
  const whamOutputPkl = values.get("wham-output-pkl");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir =
    values.get("output-dir") ??
    path.resolve(process.cwd(), "..", ".local-artifacts", "wham-fixture-job", runId);
  if (!videoPath) throw new Error("--video is required");
  if (!whamOutputPkl) throw new Error("--wham-output-pkl is required");
  return {
    videoPath: path.resolve(videoPath),
    whamOutputPkl: path.resolve(whamOutputPkl),
    outputDir: path.resolve(outputDir),
    pythonPath: values.get("python-path")
      ? path.resolve(values.get("python-path") as string)
      : undefined,
  };
}

function setDefaultEnv(args: Args) {
  process.env.DATABASE_URL ??= "postgres://fixture";
  process.env.S3_BUCKET ??= "fixture";
  process.env.S3_ACCESS_KEY_ID ??= "fixture";
  process.env.S3_SECRET_ACCESS_KEY ??= "fixture";
  process.env.WORKER_TEMP_DIR ??= path.join(args.outputDir, "tmp");
  process.env.FFMPEG_PATH ??= "ffmpeg";
  process.env.FFPROBE_PATH ??= "ffprobe";
  process.env.PYTHON_PATH = args.pythonPath ?? process.env.PYTHON_PATH ?? "python3";
  process.env.WHAM_SOLVER_SCRIPT ??= "worker/model_adapters/wham_solver.py";
  process.env.WHAM_PRECOMPUTED_OUTPUT_PKL = args.whamOutputPkl;
  process.env.PREMIUM_MOTION_TIMEOUT_MS ??= "1800000";
  process.env.WORKER_TARGET_FPS ??= "30";
  process.env.WORKER_MAX_WIDTH ??= "1280";
}

function artifactPath(outputDir: string, storageKey: string) {
  return path.join(outputDir, "artifacts", storageKey);
}

class FixtureJobs {
  private job: ProcessingJob;
  readonly timeline: unknown[] = [];

  constructor(job: ProcessingJob) {
    this.job = job;
  }

  async updateState(input: {
    jobId: string;
    state: ProcessingJob["state"];
    progress: number;
    message?: string | null;
    errorCode?: string | null;
    metrics?: unknown;
  }) {
    this.job = {
      ...this.job,
      state: input.state,
      progress: input.progress,
      message: input.message ?? null,
      errorCode: input.errorCode ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.timeline.push({ ...input, at: this.job.updatedAt });
    console.log(
      JSON.stringify({
        state: input.state,
        progress: input.progress,
        message: input.message,
      }),
    );
    return this.job;
  }

  snapshot() {
    return this.job;
  }
}

class FixtureTakes {
  private take: Take;

  constructor(take: Take) {
    this.take = take;
  }

  async get(_userId: string, _takeId: string) {
    return this.take;
  }

  async updateStatus(_userId: string, _takeId: string, status: Take["status"]) {
    this.take = {
      ...this.take,
      status,
      updatedAt: new Date().toISOString(),
    };
    return this.take;
  }

  snapshot() {
    return this.take;
  }
}

class FixtureUploads {
  constructor(private readonly video: CaptureVideo) {}

  async listVideosByTake() {
    return [this.video];
  }
}

class FixtureCaptureSessions {
  private status: CaptureSession["status"] = "uploaded";

  async updateStatus(
    _userId: string,
    captureSessionId: string,
    status: CaptureSession["status"],
  ) {
    this.status = status;
    return {
      id: captureSessionId,
      userId: "fixture_user",
      projectId: "fixture_project",
      takeId: "fixture_take",
      captureMode: "solo",
      expectedDeviceCount: 1,
      joinToken: "FIXTURE1",
      status,
      syncMetadata: null,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies CaptureSession;
  }

  snapshot() {
    return this.status;
  }
}

class FixtureExports {
  readonly files: ExportFile[] = [];

  async create(input: {
    userId: string;
    projectId: string;
    takeId: string;
    jobId: string;
    preset: string;
    format: string;
    storageKey: string;
    fileSizeBytes: number;
  }) {
    const file = {
      id: `exp_${String(this.files.length + 1).padStart(3, "0")}`,
      userId: input.userId,
      projectId: input.projectId,
      takeId: input.takeId,
      jobId: input.jobId,
      preset: input.preset,
      format: input.format,
      storageKey: input.storageKey,
      fileSizeBytes: input.fileSizeBytes,
      createdAt: new Date().toISOString(),
    } satisfies ExportFile;
    this.files.push(file);
    return file;
  }
}

class FixtureStorage {
  readonly artifacts: StoredArtifact[] = [];

  constructor(
    private readonly outputDir: string,
    private readonly sourceVideoPath: string,
  ) {}

  async downloadToFile(_storageKey: string, destinationPath: string) {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(this.sourceVideoPath, destinationPath);
    const info = await stat(destinationPath);
    return { path: destinationPath, sizeBytes: info.size };
  }

  async putFile(input: {
    storageKey: string;
    filePath: string;
    contentType: string;
  }) {
    const destination = artifactPath(this.outputDir, input.storageKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(input.filePath, destination);
    const info = await stat(destination);
    this.artifacts.push({
      storageKey: input.storageKey,
      filePath: destination,
      sizeBytes: info.size,
    });
    return { storageKey: input.storageKey, sizeBytes: info.size };
  }

  async putJson(storageKey: string, payload: unknown) {
    const destination = artifactPath(this.outputDir, storageKey);
    await mkdir(path.dirname(destination), { recursive: true });
    const body = JSON.stringify(payload);
    await writeFile(destination, body, "utf8");
    const sizeBytes = Buffer.byteLength(body, "utf8");
    this.artifacts.push({ storageKey, filePath: destination, sizeBytes });
    return { storageKey, sizeBytes };
  }

  async putText(storageKey: string, text: string) {
    const destination = artifactPath(this.outputDir, storageKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, text, "utf8");
    const sizeBytes = Buffer.byteLength(text, "utf8");
    this.artifacts.push({ storageKey, filePath: destination, sizeBytes });
    return { storageKey, sizeBytes };
  }
}

function findExport(exports: ExportFile[], format: string) {
  return exports.find((file) => file.format === format);
}

async function readStoredJson<T>(
  outputDir: string,
  exports: ExportFile[],
  format: string,
): Promise<T> {
  const file = findExport(exports, format);
  if (!file) {
    throw new Error(`Missing export format ${format}`);
  }
  const artifact = artifactPath(outputDir, file.storageKey);
  return JSON.parse(await readFile(artifact, "utf8")) as T;
}

function addCheck(
  checks: FixtureCheck[],
  name: string,
  ok: boolean,
  details?: string,
) {
  checks.push({ name, ok, details });
}

async function validateFixtureResult(input: {
  outputDir: string;
  job: ProcessingJob;
  exports: ExportFile[];
}) {
  const checks: FixtureCheck[] = [];

  addCheck(
    checks,
    "job_succeeded",
    input.job.state === "succeeded",
    `state=${input.job.state}`,
  );

  for (const format of REQUIRED_EXPORT_FORMATS) {
    const file = findExport(input.exports, format);
    const sizeBytes = file?.fileSizeBytes ?? 0;
    addCheck(
      checks,
      `export_${format}`,
      Boolean(file && sizeBytes > 0),
      file ? `${sizeBytes} bytes` : "missing",
    );
  }

  const rawSolved = await readStoredJson<{
    solver?: {
      name?: string;
      premium?: boolean;
      metrics?: Record<string, unknown>;
    };
    validation?: { ok?: boolean; errors?: unknown[] };
    frames?: unknown[];
  }>(input.outputDir, input.exports, "raw_solved_motion_json");
  const solved = await readStoredJson<{
    solver?: {
      name?: string;
      premium?: boolean;
      metrics?: Record<string, unknown>;
    };
    validation?: { ok?: boolean; errors?: unknown[] };
    frames?: unknown[];
    frameCount?: number;
  }>(input.outputDir, input.exports, "solved_motion_json");
  const pipeline = await readStoredJson<{
    engines?: { backendMotion?: string };
    fallback?: { motionFallbackUsed?: boolean; poseFallbackUsed?: boolean; reasons?: unknown[] };
  }>(input.outputDir, input.exports, "motion_pipeline_report_json");
  const quality = await readStoredJson<{
    score?: number;
    grade?: string;
    errors?: unknown[];
  }>(input.outputDir, input.exports, "quality_report_json");

  addCheck(
    checks,
    "raw_solver_is_wham",
    rawSolved.solver?.name === "wham" && rawSolved.solver?.premium === true,
    `solver=${rawSolved.solver?.name}, premium=${String(rawSolved.solver?.premium)}`,
  );
  addCheck(
    checks,
    "raw_wham_frames_present",
    Number(rawSolved.solver?.metrics?.whamFrameCount) > 0,
    `whamFrameCount=${String(rawSolved.solver?.metrics?.whamFrameCount)}`,
  );
  addCheck(
    checks,
    "raw_validation_ok",
    rawSolved.validation?.ok === true && (rawSolved.validation.errors?.length ?? 0) === 0,
    `errors=${rawSolved.validation?.errors?.length ?? 0}`,
  );
  addCheck(
    checks,
    "clean_solver_remains_wham",
    solved.solver?.name === "wham" && solved.solver?.premium === true,
    `solver=${solved.solver?.name}, premium=${String(solved.solver?.premium)}`,
  );
  addCheck(
    checks,
    "clean_frames_present",
    Number(solved.frameCount) > 0 && (solved.frames?.length ?? 0) > 0,
    `frameCount=${String(solved.frameCount)}, frames=${solved.frames?.length ?? 0}`,
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
    `score=${String(quality.score)}, grade=${quality.grade ?? "missing"}, errors=${
      quality.errors?.length ?? 0
    }`,
  );

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });
  setDefaultEnv(args);

  const { WorkerJobProcessor } = await import("../worker/processJob");

  const now = new Date().toISOString();
  const take: Take = {
    id: "take_wham_fixture",
    userId: "fixture_user",
    projectId: "fixture_project",
    name: "WHAM fixture validation",
    status: "uploaded",
    captureMode: "solo",
    expectedVideoCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  const job: ProcessingJob = {
    id: "job_wham_fixture",
    userId: take.userId,
    projectId: take.projectId,
    takeId: take.id,
    state: "queued",
    preset: "humanoid_bvh_quality_v1_5",
    progress: 0,
    message: null,
    errorCode: null,
    retryOfJobId: null,
    createdAt: now,
    updatedAt: now,
  };
  const video: CaptureVideo = {
    id: "vid_wham_fixture",
    userId: take.userId,
    projectId: take.projectId,
    takeId: take.id,
    captureSessionId: "cs_wham_fixture",
    uploadSessionId: "upl_wham_fixture",
    deviceIndex: 0,
    deviceId: "fixture_device",
    deviceRole: "primary",
    videoStorageKey: "fixture/source.mp4",
    metadataStorageKey: "fixture/source.json",
    status: "uploaded",
    fileSizeBytes: (await stat(args.videoPath)).size,
    metadataSizeBytes: 2,
    captureMetadata: { captureMode: "solo", deviceRole: "primary", deviceIndex: 0 },
    syncMetadata: null,
    createdAt: now,
    updatedAt: now,
  };

  const jobs = new FixtureJobs(job);
  const takes = new FixtureTakes(take);
  const uploads = new FixtureUploads(video);
  const captureSessions = new FixtureCaptureSessions();
  const exportsRepo = new FixtureExports();
  const storage = new FixtureStorage(args.outputDir, args.videoPath);
  const processor = new WorkerJobProcessor({
    jobs: jobs as never,
    takes: takes as never,
    uploads: uploads as never,
    captureSessions: captureSessions as never,
    exports: exportsRepo as never,
    storage: storage as never,
  });

  await processor.process(job);

  const validation = await validateFixtureResult({
    outputDir: args.outputDir,
    job: jobs.snapshot(),
    exports: exportsRepo.files,
  });

  const report = {
    schema: "mocap.wham_fixture_job_report.v1",
    generatedAt: new Date().toISOString(),
    outputDir: args.outputDir,
    ok: validation.ok,
    checks: validation.checks,
    job: jobs.snapshot(),
    take: takes.snapshot(),
    captureSessionStatus: captureSessions.snapshot(),
    exports: exportsRepo.files,
    timeline: jobs.timeline,
    artifacts: storage.artifacts,
  };
  const reportPath = path.join(args.outputDir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (!validation.ok) {
    process.exitCode = 1;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
