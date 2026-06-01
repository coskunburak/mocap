import { spawn } from "child_process";
import { mkdir, readFile } from "fs/promises";
import path from "path";
import {
  calibrationDetectorRuntimeConfigFromEnv,
  checkCalibrationDetectorRuntime,
} from "./calibrationDetectorRuntime";
import type {
  CalibrationDetectionInput,
  CalibrationDetectorRuntimeCheck,
  CalibrationDetectorRuntimeConfig,
  CalibrationTargetDetectorAdapter,
} from "./calibrationDetectorTypes";
import {
  buildMissingCalibrationObservationsArtifact,
  normalizeDetectionCameras,
  parseCalibrationObservationsFixture,
} from "./calibrationTargetDetector";

export type CalibrationDetectorCliRunnerInput = {
  input: CalibrationDetectionInput;
  runtime: CalibrationDetectorRuntimeConfig;
  outputJsonPath: string;
};

export type CalibrationDetectorCliRunner = (
  input: CalibrationDetectorCliRunnerInput,
) => Promise<unknown>;

export type CalibrationTargetDetectorAdapterOptions = {
  runtime?: CalibrationDetectorRuntimeConfig;
  runtimeChecker?: (
    runtime: CalibrationDetectorRuntimeConfig,
  ) => Promise<CalibrationDetectorRuntimeCheck>;
  cliRunner?: CalibrationDetectorCliRunner;
};

export function createConfiguredCalibrationTargetDetectorAdapter(
  env: NodeJS.ProcessEnv = process.env,
): CalibrationTargetDetectorAdapter | undefined {
  const runtime = calibrationDetectorRuntimeConfigFromEnv(env);
  if (runtime.detector === "disabled") {
    return undefined;
  }
  return createCalibrationTargetDetectorAdapter({ runtime });
}

export function createCalibrationTargetDetectorAdapter(
  options: CalibrationTargetDetectorAdapterOptions = {},
): CalibrationTargetDetectorAdapter {
  const defaultRuntime =
    options.runtime ?? calibrationDetectorRuntimeConfigFromEnv();
  const runtimeChecker =
    options.runtimeChecker ?? checkCalibrationDetectorRuntime;
  const cliRunner = options.cliRunner ?? runCalibrationDetectorCli;

  return {
    name: "calibration_target_detector_adapter",
    version: "calibration_target_detector_v1",
    async detectCalibrationObservations(input) {
      const runtime: CalibrationDetectorRuntimeConfig = {
        ...defaultRuntime,
        targetType: input.targetType,
        cliPath:
          typeof input.detectorConfig?.cliPath === "string"
            ? input.detectorConfig.cliPath
            : defaultRuntime.cliPath,
        timeoutMs:
          typeof input.detectorConfig?.timeoutMs === "number" &&
          Number.isFinite(input.detectorConfig.timeoutMs)
            ? input.detectorConfig.timeoutMs
            : defaultRuntime.timeoutMs,
      };
      const runtimeCheck = await runtimeChecker(runtime);
      if (runtimeCheck.status !== "ready") {
        return buildMissingCalibrationObservationsArtifact({
          takeId: input.takeId,
          jobId: input.jobId,
          sessionId: input.sessionId,
          targetType: input.targetType,
          detectorSource: runtime.detector,
          status:
            runtimeCheck.status === "disabled"
              ? "disabled"
              : runtimeCheck.status === "unsupported_target"
                ? "unsupported_target"
                : "missing_calibration_observations",
          reason:
            runtimeCheck.reason ??
            "Calibration detector runtime is not configured.",
          warnings: runtimeCheck.warnings,
        });
      }

      try {
        const rawOutput =
          runtime.detector === "fixture"
            ? await readFixtureOutput(input)
            : await cliRunner({
                input,
                runtime,
                outputJsonPath: outputJsonPath(input),
              });
        return parseCalibrationObservationsFixture(rawOutput, {
          ...input,
          detectorSource: runtime.detector,
        });
      } catch (error) {
        return buildMissingCalibrationObservationsArtifact({
          takeId: input.takeId,
          jobId: input.jobId,
          sessionId: input.sessionId,
          targetType: input.targetType,
          detectorSource: runtime.detector,
          status: "failed",
          reason:
            error instanceof Error
              ? error.message
              : "Calibration detector failed.",
        });
      }
    },
  };
}

export async function detectCalibrationObservations(
  input: CalibrationDetectionInput,
  adapter: CalibrationTargetDetectorAdapter = createCalibrationTargetDetectorAdapter(),
) {
  return adapter.detectCalibrationObservations(input);
}

export async function runCalibrationDetectorCli(
  input: CalibrationDetectorCliRunnerInput,
): Promise<unknown> {
  if (!input.runtime.cliPath) {
    throw new Error("Calibration detector CLI path is not configured.");
  }
  const cameras = normalizeDetectionCameras(input.input);
  if (cameras.length === 0) {
    throw new Error("Calibration detector requires at least one camera source.");
  }
  await mkdir(path.dirname(input.outputJsonPath), { recursive: true });
  const args = [
    "--target-type",
    input.input.targetType,
    "--output",
    input.outputJsonPath,
    ...cameras.flatMap((camera) => {
      const videoPath = camera.calibrationVideoPath ?? camera.normalizedVideoPath;
      return videoPath ? ["--camera", `${camera.cameraId}=${videoPath}`] : [];
    }),
  ];
  const result = await execFileWithTimeout({
    file: input.runtime.cliPath,
    args,
    timeoutMs: input.runtime.timeoutMs,
  });
  const outputFile = await readJsonFileIfPresent(input.outputJsonPath);
  if (outputFile !== undefined) {
    return outputFile;
  }
  if (result.stdout.trim().length > 0) {
    return JSON.parse(result.stdout);
  }
  throw new Error(
    result.stderr.trim().length > 0
      ? `Calibration detector CLI produced no JSON output: ${result.stderr.trim()}`
      : "Calibration detector CLI produced no JSON output.",
  );
}

async function readFixtureOutput(input: CalibrationDetectionInput) {
  if (input.detectorConfig?.fixture !== undefined) {
    return input.detectorConfig.fixture;
  }
  const fixturePath =
    typeof input.detectorConfig?.fixturePath === "string"
      ? input.detectorConfig.fixturePath
      : undefined;
  if (!fixturePath) {
    throw new Error("Fixture calibration detector requires detectorConfig.fixture or fixturePath.");
  }
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function outputJsonPath(input: CalibrationDetectionInput) {
  const artifactName = input.outputArtifactName ?? "calibration_observations.json";
  return path.join(process.cwd(), ".calibration-detector", input.jobId, artifactName);
}

async function readJsonFileIfPresent(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function execFileWithTimeout(input: {
  file: string;
  args: readonly string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.file, [...input.args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Calibration detector CLI timed out after ${input.timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Calibration detector CLI exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
