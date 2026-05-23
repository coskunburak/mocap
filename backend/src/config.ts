import "dotenv/config";

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be numeric`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

const nodeEnv = optionalEnv("NODE_ENV") ?? "development";
const explicitPythonPath = optionalEnv("PYTHON_PATH");
const whamSolverScript = optionalEnv("WHAM_SOLVER_SCRIPT");
const whamPrecomputedOutputPkl = optionalEnv("WHAM_PRECOMPUTED_OUTPUT_PKL");
const runpodEndpointId = optionalEnv("RUNPOD_ENDPOINT_ID");
const runpodApiKey = optionalEnv("RUNPOD_API_KEY");

export const config = {
  nodeEnv,
  port: numberEnv("PORT", 4010),
  databaseUrl: requiredEnv("DATABASE_URL"),
  storage: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: requiredEnv("S3_BUCKET"),
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: booleanEnv("S3_FORCE_PATH_STYLE", true),
    uploadUrlTtlSeconds: numberEnv("UPLOAD_URL_TTL_SECONDS", 900),
    downloadUrlTtlSeconds: numberEnv("DOWNLOAD_URL_TTL_SECONDS", 600),
    requestTimeoutMs: numberEnv("S3_REQUEST_TIMEOUT_MS", 30000),
    skipObjectHeadValidation: booleanEnv("SKIP_OBJECT_HEAD_VALIDATION", false),
  },
  runpod: {
    dispatchEnabled: booleanEnv(
      "RUNPOD_DISPATCH_ENABLED",
      Boolean(runpodEndpointId && runpodApiKey),
    ),
    endpointId: runpodEndpointId,
    apiKey: runpodApiKey,
    apiBaseUrl: optionalEnv("RUNPOD_API_BASE_URL") ?? "https://api.runpod.ai/v2",
    jobTimeoutSeconds: numberEnv("RUNPOD_JOB_TIMEOUT_SECONDS", 3600),
    requestTimeoutMs: numberEnv("RUNPOD_REQUEST_TIMEOUT_MS", 30000),
  },
  limits: {
    maxVideoBytes: numberEnv("MAX_VIDEO_BYTES", 786_432_000),
    maxMetadataBytes: numberEnv("MAX_METADATA_BYTES", 1_048_576),
    maxExpectedVideos: numberEnv("MAX_EXPECTED_VIDEOS", 4),
    maxVideoDurationSeconds: numberEnv("MAX_VIDEO_DURATION_SECONDS", 180),
    workerTargetFps: numberEnv("WORKER_TARGET_FPS", 30),
    workerMaxWidth: numberEnv("WORKER_MAX_WIDTH", 1280),
  },
  worker: {
    pollIntervalMs: numberEnv("WORKER_POLL_INTERVAL_MS", 2000),
    idleLogIntervalMs: numberEnv("WORKER_IDLE_LOG_INTERVAL_MS", 30000),
    tempDir: process.env.WORKER_TEMP_DIR ?? "/tmp/mocapexpo-worker",
    ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
    pythonPath: explicitPythonPath ?? "python3",
    whamSolverScript,
    whamSolverVersion: process.env.WHAM_SOLVER_VERSION ?? "wham_adapter_v1",
    whamRepoDir: optionalEnv("WHAM_REPO_DIR"),
    whamConfigPath: optionalEnv("WHAM_CONFIG_PATH"),
    whamPrecomputedOutputPkl,
    whamCalibrationPath: optionalEnv("WHAM_CALIBRATION_PATH"),
    whamLibraryPath: optionalEnv("WHAM_LD_LIBRARY_PATH"),
    whamEstimateLocalOnly: booleanEnv("WHAM_ESTIMATE_LOCAL_ONLY", false),
    whamRenderOverlayPreview: booleanEnv("WHAM_RENDER_OVERLAY_PREVIEW", false),
    whamRootScale: numberEnv("WHAM_ROOT_SCALE", 100),
    whamRequireCuda: booleanEnv(
      "WHAM_REQUIRE_CUDA",
      nodeEnv === "production",
    ),
    whamSmplAssetDir: optionalEnv("WHAM_SMPL_ASSET_DIR"),
    whamPreflightRequiredModules: optionalEnv("WHAM_PREFLIGHT_REQUIRED_MODULES"),
    whamPreflightRequiredPaths: optionalEnv("WHAM_PREFLIGHT_REQUIRED_PATHS"),
    premiumMotionTimeoutMs: numberEnv("PREMIUM_MOTION_TIMEOUT_MS", 1_800_000),
    blenderPath: optionalEnv("BLENDER_PATH"),
    requireBlenderSmokeTest: booleanEnv("REQUIRE_BLENDER_SMOKE_TEST", false),
  },
};

export function assertWorkerRuntimeConfig() {
  if (config.nodeEnv === "production" && config.worker.whamPrecomputedOutputPkl) {
    throw new Error(
      "WHAM_PRECOMPUTED_OUTPUT_PKL is QA/demo-only and must not be set in production worker deployments.",
    );
  }

  if (config.nodeEnv === "production" && !config.worker.whamSolverScript) {
    throw new Error(
      "WHAM_SOLVER_SCRIPT is required in production WHAM worker deployments.",
    );
  }

  if (config.nodeEnv === "production" && !config.worker.whamRepoDir) {
    throw new Error(
      "WHAM_REPO_DIR is required in production WHAM worker deployments.",
    );
  }

  if (config.nodeEnv === "production" && !explicitPythonPath) {
    throw new Error(
      "PYTHON_PATH must explicitly point to the WHAM conda Python in production WHAM worker deployments.",
    );
  }
}
