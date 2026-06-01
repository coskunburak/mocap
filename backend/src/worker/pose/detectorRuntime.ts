import { access } from "fs/promises";

export type PoseDetectorRuntimeStatus =
  | "ready"
  | "missing_runtime"
  | "missing_model"
  | "unsupported_platform"
  | "failed";

export type RtmposeMmposeDetectorName = "disabled" | "rtmpose_mmpose";

export type RtmposeMmposeRuntimeConfig = {
  detector: RtmposeMmposeDetectorName;
  cliPath?: string;
  modelPath?: string;
  configPath?: string;
  timeoutMs: number;
};

export type PoseDetectorRuntimeCheck = {
  status: PoseDetectorRuntimeStatus;
  reason?: string;
  warnings: string[];
};

export function rtmposeMmposeRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RtmposeMmposeRuntimeConfig {
  return {
    detector:
      env.MOCAPEXPO_POSE_DETECTOR === "rtmpose_mmpose"
        ? "rtmpose_mmpose"
        : "disabled",
    cliPath: optionalEnv(env, "MOCAPEXPO_RTMPOSE_CLI_PATH"),
    modelPath: optionalEnv(env, "MOCAPEXPO_RTMPOSE_MODEL_PATH"),
    configPath: optionalEnv(env, "MOCAPEXPO_RTMPOSE_CONFIG_PATH"),
    timeoutMs: numberEnv(env, "MOCAPEXPO_RTMPOSE_TIMEOUT_MS", 120_000),
  };
}

export async function checkRtmposeMmposeRuntime(
  runtime: RtmposeMmposeRuntimeConfig,
): Promise<PoseDetectorRuntimeCheck> {
  if (runtime.detector !== "rtmpose_mmpose") {
    return {
      status: "missing_runtime",
      reason: "RTMPose/MMPose detector is disabled.",
      warnings: ["MOCAPEXPO_POSE_DETECTOR is not set to rtmpose_mmpose."],
    };
  }

  if (process.platform === "win32") {
    return {
      status: "unsupported_platform",
      reason: "RTMPose/MMPose CLI execution is not configured for Windows workers.",
      warnings: ["RTMPose/MMPose backend adapter is currently validated on Unix-like workers."],
    };
  }

  if (!runtime.cliPath) {
    return {
      status: "missing_runtime",
      reason: "RTMPose/MMPose runtime is not configured.",
      warnings: ["MOCAPEXPO_RTMPOSE_CLI_PATH is missing."],
    };
  }

  if (!(await pathExists(runtime.cliPath))) {
    return {
      status: "missing_runtime",
      reason: "RTMPose/MMPose CLI path does not exist.",
      warnings: [`MOCAPEXPO_RTMPOSE_CLI_PATH was not found: ${runtime.cliPath}`],
    };
  }

  if (!runtime.modelPath) {
    return {
      status: "missing_model",
      reason: "RTMPose/MMPose model path is not configured.",
      warnings: ["MOCAPEXPO_RTMPOSE_MODEL_PATH is missing."],
    };
  }

  if (!(await pathExists(runtime.modelPath))) {
    return {
      status: "missing_model",
      reason: "RTMPose/MMPose model path does not exist.",
      warnings: [`MOCAPEXPO_RTMPOSE_MODEL_PATH was not found: ${runtime.modelPath}`],
    };
  }

  if (runtime.configPath && !(await pathExists(runtime.configPath))) {
    return {
      status: "missing_model",
      reason: "RTMPose/MMPose config path does not exist.",
      warnings: [`MOCAPEXPO_RTMPOSE_CONFIG_PATH was not found: ${runtime.configPath}`],
    };
  }

  return {
    status: "ready",
    warnings: [],
  };
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}
