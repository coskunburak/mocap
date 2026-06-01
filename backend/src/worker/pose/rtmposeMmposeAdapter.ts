import { spawn } from "child_process";
import { mkdir, readFile } from "fs/promises";
import path from "path";
import type {
  MultiViewOrchestratorSource,
  MultiViewPoseAdapter,
} from "../reconstruction/multiViewOrchestrator";
import type { PerCameraPoseArtifact } from "../types";
import type {
  PoseDetectorFrame,
  PoseDetectorKeypoint2D,
  PoseDetectorResult,
} from "./poseExtraction";
import {
  buildMissingPoseFramesArtifact,
  buildPerCameraPoseArtifact,
} from "./poseExtraction";
import {
  type PoseDetectorRuntimeCheck,
  type RtmposeMmposeRuntimeConfig,
  checkRtmposeMmposeRuntime,
  rtmposeMmposeRuntimeConfigFromEnv,
} from "./detectorRuntime";

export const RTMPOSE_COCO_17_JOINTS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

export type RtmposeMmposeCliRunnerInput = {
  takeId: string;
  jobId: string;
  source: MultiViewOrchestratorSource;
  runtime: RtmposeMmposeRuntimeConfig;
  outputJsonPath: string;
};

export type RtmposeMmposeCliRunner = (
  input: RtmposeMmposeCliRunnerInput,
) => Promise<unknown>;

export type RtmposeMmposePoseAdapterOptions = {
  runtime?: RtmposeMmposeRuntimeConfig;
  runtimeChecker?: (
    runtime: RtmposeMmposeRuntimeConfig,
  ) => Promise<PoseDetectorRuntimeCheck>;
  cliRunner?: RtmposeMmposeCliRunner;
  lowConfidenceThreshold?: number;
};

type RtmposeMmposeFrameLike = {
  frameIndex?: unknown;
  timestampMs?: unknown;
  timestamp_ms?: unknown;
  keypoints?: unknown;
  keypoints2d?: unknown;
  keypointScores?: unknown;
  keypoint_scores?: unknown;
  scores?: unknown;
  confidence?: unknown;
  poseConfidence?: unknown;
  pose_confidence?: unknown;
  status?: unknown;
};

type RtmposeMmposeOutputLike = {
  detector?: unknown;
  detectorSource?: unknown;
  detector_source?: unknown;
  frames?: unknown;
  poseFrames?: unknown;
  pose_frames?: unknown;
  predictions?: unknown;
  expectedFrameCount?: unknown;
  expected_frame_count?: unknown;
  status?: unknown;
  reason?: unknown;
  warnings?: unknown;
};

export function createConfiguredRtmposeMmposePoseAdapter(
  env: NodeJS.ProcessEnv = process.env,
): MultiViewPoseAdapter | undefined {
  const runtime = rtmposeMmposeRuntimeConfigFromEnv(env);
  if (runtime.detector !== "rtmpose_mmpose") {
    return undefined;
  }
  return createRtmposeMmposePoseAdapter({ runtime });
}

export function createRtmposeMmposePoseAdapter(
  options: RtmposeMmposePoseAdapterOptions = {},
): MultiViewPoseAdapter {
  const runtime = options.runtime ?? rtmposeMmposeRuntimeConfigFromEnv();
  const runtimeChecker = options.runtimeChecker ?? checkRtmposeMmposeRuntime;
  const cliRunner = options.cliRunner ?? runRtmposeMmposeCli;

  return {
    name: "rtmpose_mmpose_adapter",
    version: "rtmpose_mmpose_cli_v1",
    async extractPoseArtifacts(input) {
      const runtimeCheck = await runtimeChecker(runtime);
      if (runtimeCheck.status !== "ready") {
        return input.processedSources.map((source) =>
          buildMissingArtifact({
            takeId: input.takeId,
            jobId: input.jobId,
            source,
            reason:
              runtimeCheck.reason ??
              "RTMPose/MMPose runtime is not ready for pose extraction.",
          }),
        );
      }

      return Promise.all(
        input.processedSources.map(async (source) => {
          const outputJsonPath = path.join(
            input.outputDir ?? path.dirname(source.normalizedPath),
            `rtmpose_mmpose_device_${source.deviceIndex}.json`,
          );
          try {
            const rawOutput = await cliRunner({
              takeId: input.takeId,
              jobId: input.jobId,
              source,
              runtime,
              outputJsonPath,
            });
            const detectorResult = parseRtmposeMmposeOutput(rawOutput);
            return buildPerCameraPoseArtifact({
              takeId: input.takeId,
              jobId: input.jobId,
              cameraId: source.cameraId ?? `device_${source.deviceIndex}`,
              deviceIndex: source.deviceIndex,
              deviceRole: source.deviceRole,
              sourceVideo: sourceVideoFromSource(source),
              detectorResult,
              lowConfidenceThreshold: options.lowConfidenceThreshold,
            });
          } catch (error) {
            return buildMissingArtifact({
              takeId: input.takeId,
              jobId: input.jobId,
              source,
              reason:
                error instanceof Error
                  ? error.message
                  : "RTMPose/MMPose pose extraction failed.",
            });
          }
        }),
      );
    },
  };
}

export async function runRtmposeMmposeCli(
  input: RtmposeMmposeCliRunnerInput,
): Promise<unknown> {
  if (!input.runtime.cliPath) {
    throw new Error("RTMPose/MMPose CLI path is not configured.");
  }
  if (!input.runtime.modelPath) {
    throw new Error("RTMPose/MMPose model path is not configured.");
  }

  await mkdir(path.dirname(input.outputJsonPath), { recursive: true });
  const args = [
    "--video",
    input.source.normalizedPath,
    "--output",
    input.outputJsonPath,
    "--model",
    input.runtime.modelPath,
    ...(input.runtime.configPath ? ["--config", input.runtime.configPath] : []),
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
      ? `RTMPose/MMPose CLI produced no JSON output: ${result.stderr.trim()}`
      : "RTMPose/MMPose CLI produced no JSON output.",
  );
}

export function parseRtmposeMmposeOutput(rawOutput: unknown): PoseDetectorResult {
  const output = recordOrNull(rawOutput) as RtmposeMmposeOutputLike | null;
  if (!output) {
    throw new Error("RTMPose/MMPose output must be a JSON object.");
  }
  const frameItems = arrayOrEmpty(
    output.frames ?? output.poseFrames ?? output.pose_frames ?? output.predictions,
  );
  const frames = frameItems.map((frame, index) =>
    parseRtmposeMmposeFrame(frame, index),
  );
  return {
    detector: {
      name: detectorName(output.detector),
      version: detectorVersion(output.detector),
      landmarkSchema: "custom",
    },
    detectorSource: stringValue(output.detectorSource ?? output.detector_source) ??
      "rtmpose_mmpose",
    expectedFrameCount: numberValue(
      output.expectedFrameCount ?? output.expected_frame_count,
    ),
    status: parsePoseStatus(output.status, frames.length),
    reason: stringValue(output.reason),
    warnings: [],
    frames,
  };
}

function parseRtmposeMmposeFrame(
  rawFrame: unknown,
  fallbackFrameIndex: number,
): PoseDetectorFrame {
  const frame = recordOrNull(rawFrame) as RtmposeMmposeFrameLike | null;
  if (!frame) {
    return {
      frameIndex: fallbackFrameIndex,
      keypoints: [],
      poseConfidence: 0,
    };
  }
  const confidence = numberArray(
    frame.confidence ?? frame.keypointScores ?? frame.keypoint_scores ?? frame.scores,
  );
  const keypoints = parseKeypoints(frame.keypoints ?? frame.keypoints2d, confidence);
  return {
    frameIndex: integerValue(frame.frameIndex) ?? fallbackFrameIndex,
    timestampMs: numberValue(frame.timestampMs ?? frame.timestamp_ms),
    keypoints,
    poseConfidence: numberValue(frame.poseConfidence ?? frame.pose_confidence),
  };
}

function parseKeypoints(
  rawKeypoints: unknown,
  confidence: readonly number[],
): PoseDetectorKeypoint2D[] {
  return arrayOrEmpty(rawKeypoints).flatMap((keypoint, index) => {
    const parsed = parseKeypoint(keypoint, index, confidence[index]);
    return parsed ? [parsed] : [];
  });
}

function parseKeypoint(
  rawKeypoint: unknown,
  index: number,
  confidenceFallback: number | undefined,
): PoseDetectorKeypoint2D | undefined {
  if (Array.isArray(rawKeypoint)) {
    const x = numberValue(rawKeypoint[0]);
    const y = numberValue(rawKeypoint[1]);
    const confidence = numberValue(rawKeypoint[2]) ?? confidenceFallback;
    return keypointOrMissing({
      jointId: RTMPOSE_COCO_17_JOINTS[index] ?? String(index),
      x,
      y,
      confidence,
    });
  }

  const keypoint = recordOrNull(rawKeypoint);
  if (!keypoint) return undefined;
  const x = numberValue(keypoint.x);
  const y = numberValue(keypoint.y);
  const confidence =
    numberValue(keypoint.confidence) ??
    numberValue(keypoint.score) ??
    confidenceFallback;
  const jointId =
    stringValue(keypoint.jointId) ??
    stringValue(keypoint.name) ??
    (RTMPOSE_COCO_17_JOINTS[index] ?? String(index));
  return keypointOrMissing({
    jointId,
    name: stringValue(keypoint.name),
    x,
    y,
    confidence,
    visibility: numberValue(keypoint.visibility),
    presence: numberValue(keypoint.presence),
  });
}

function keypointOrMissing(
  keypoint: PoseDetectorKeypoint2D,
): PoseDetectorKeypoint2D | undefined {
  if (!Number.isFinite(keypoint.x) || !Number.isFinite(keypoint.y)) {
    return undefined;
  }
  if (keypoint.x === 0 && keypoint.y === 0 && (keypoint.confidence ?? 0) <= 0) {
    return undefined;
  }
  return keypoint;
}

function buildMissingArtifact(input: {
  takeId: string;
  jobId: string;
  source: MultiViewOrchestratorSource;
  reason: string;
}): PerCameraPoseArtifact {
  return buildMissingPoseFramesArtifact({
    takeId: input.takeId,
    jobId: input.jobId,
    cameraId: input.source.cameraId ?? `device_${input.source.deviceIndex}`,
    deviceIndex: input.source.deviceIndex,
    deviceRole: input.source.deviceRole,
    sourceVideo: sourceVideoFromSource(input.source),
    detectorSource: "rtmpose_mmpose",
    reason: `${input.reason} Primary WHAM fallback remains available.`,
  });
}

function sourceVideoFromSource(
  source: MultiViewOrchestratorSource,
): PerCameraPoseArtifact["sourceVideo"] {
  return {
    storageKey: source.videoStorageKey,
    normalizedStorageKey: source.normalizedStorageKey,
    fps: source.fps,
    width: source.width,
    height: source.height,
    durationMs: source.durationMs,
  };
}

function parsePoseStatus(
  status: unknown,
  frameCount: number,
): PoseDetectorResult["status"] {
  const parsed = stringValue(status);
  if (
    parsed === "ready" ||
    parsed === "missing_pose_frames" ||
    parsed === "low_confidence" ||
    parsed === "failed"
  ) {
    return parsed;
  }
  return frameCount > 0 ? "ready" : "missing_pose_frames";
}

function detectorName(detector: unknown) {
  const record = recordOrNull(detector);
  return stringValue(record?.name) ?? "rtmpose_mmpose";
}

function detectorVersion(detector: unknown) {
  const record = recordOrNull(detector);
  return stringValue(record?.version) ?? "rtmpose_mmpose_cli_v1";
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberArray(value: unknown): number[] {
  return arrayOrEmpty(value).flatMap((item) => {
    const parsed = numberValue(item);
    return parsed === undefined ? [] : [parsed];
  });
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
        reject(new Error(`RTMPose/MMPose CLI timed out after ${input.timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `RTMPose/MMPose CLI exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
