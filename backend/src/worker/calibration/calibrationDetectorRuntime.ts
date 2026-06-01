import { access } from "fs/promises";
import type {
  CalibrationDetectorRuntimeCheck,
  CalibrationDetectorRuntimeConfig,
  CalibrationDetectorName,
} from "./calibrationDetectorTypes";
import type { CalibrationTargetType } from "../types";

const DEFAULT_TIMEOUT_MS = 120_000;

export function calibrationDetectorRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CalibrationDetectorRuntimeConfig {
  return {
    detector: detectorName(env.MOCAPEXPO_CALIBRATION_DETECTOR),
    targetType: targetType(env.MOCAPEXPO_CALIBRATION_TARGET_TYPE),
    cliPath: optionalEnv(env, "MOCAPEXPO_CALIBRATION_CLI_PATH"),
    timeoutMs: numberEnv(
      env,
      "MOCAPEXPO_CALIBRATION_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
    ),
  };
}

export async function checkCalibrationDetectorRuntime(
  runtime: CalibrationDetectorRuntimeConfig,
): Promise<CalibrationDetectorRuntimeCheck> {
  if (runtime.detector === "disabled") {
    return {
      status: "disabled",
      reason: "Calibration detector is disabled.",
      warnings: ["MOCAPEXPO_CALIBRATION_DETECTOR is disabled."],
    };
  }

  if (runtime.detector === "fixture") {
    return {
      status: "ready",
      warnings: [],
    };
  }

  if (!detectorSupportsTarget(runtime.detector, runtime.targetType)) {
    return {
      status: "unsupported_target",
      reason: `${runtime.detector} does not support ${runtime.targetType}.`,
      warnings: [`Unsupported calibration target type: ${runtime.targetType}.`],
    };
  }

  if (process.platform === "win32") {
    return {
      status: "missing_runtime",
      reason: "Calibration detector CLI execution is not configured for Windows workers.",
      warnings: ["Calibration detector CLI is currently validated on Unix-like workers."],
    };
  }

  if (!runtime.cliPath) {
    return {
      status: "missing_calibration_observations",
      reason: "Calibration detector runtime is not configured.",
      warnings: ["MOCAPEXPO_CALIBRATION_CLI_PATH is missing."],
    };
  }

  if (!(await pathExists(runtime.cliPath))) {
    return {
      status: "missing_runtime",
      reason: "Calibration detector CLI path does not exist.",
      warnings: [`MOCAPEXPO_CALIBRATION_CLI_PATH was not found: ${runtime.cliPath}`],
    };
  }

  return {
    status: "ready",
    warnings: [],
  };
}

function detectorName(value: string | undefined): CalibrationDetectorName {
  switch (value?.trim()) {
    case "fixture":
      return "fixture";
    case "opencv_apriltag":
      return "opencv_apriltag";
    case "opencv_checkerboard":
      return "opencv_checkerboard";
    case "opencv_charuco":
      return "opencv_charuco";
    case "disabled":
    default:
      return "disabled";
  }
}

function targetType(value: string | undefined): CalibrationTargetType {
  switch (value?.trim()) {
    case "checkerboard":
      return "checkerboard";
    case "charuco":
      return "charuco";
    case "human_pose_calibration":
      return "human_pose_calibration";
    case "apriltag":
    default:
      return "apriltag";
  }
}

function detectorSupportsTarget(
  detector: CalibrationDetectorName,
  target: CalibrationTargetType,
) {
  return (
    detector === "fixture" ||
    (detector === "opencv_apriltag" && target === "apriltag") ||
    (detector === "opencv_checkerboard" && target === "checkerboard") ||
    (detector === "opencv_charuco" && target === "charuco")
  );
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
