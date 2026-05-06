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

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
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
    skipObjectHeadValidation: booleanEnv("SKIP_OBJECT_HEAD_VALIDATION", false),
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
    pythonPath: process.env.PYTHON_PATH ?? "python3",
    poseDetectorScript:
      process.env.POSE_DETECTOR_SCRIPT ?? "worker/pose_detector.py",
    detectorVersion: process.env.POSE_DETECTOR_VERSION ?? "mediapipe_pose_v1",
    allowSyntheticPose: booleanEnv("MOCAP_ALLOW_SYNTHETIC_POSE", false),
    blenderPath: process.env.BLENDER_PATH,
    requireBlenderSmokeTest: booleanEnv("REQUIRE_BLENDER_SMOKE_TEST", false),
  },
};
