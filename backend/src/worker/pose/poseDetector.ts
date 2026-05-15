import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { config } from "../../config";
import type {
  PoseFrameArtifactFrame,
  PoseFramesArtifact,
  PoseLandmark,
} from "../types";
import { runCommand } from "../runtime/command";

export type DetectInput = {
  takeId: string;
  jobId: string;
  normalizedVideoPath: string;
  sourceStorageKey: string;
  normalizedStorageKey: string;
  outputDir: string;
  sourceVideo: PoseFramesArtifact["sourceVideo"];
};

type DetectorDefaults = {
  name: string;
  version: string;
  landmarkSchema?: PoseFrameArtifactFrame["landmarkSchema"];
  fallbackReason?: string;
};

function resolveScript(script: string) {
  return path.isAbsolute(script) ? script : path.join(process.cwd(), script);
}

function mediapipeScriptPath() {
  return resolveScript(config.worker.poseDetectorScript);
}

function rtmwScriptPath() {
  return config.worker.rtmwDetectorScript
    ? resolveScript(config.worker.rtmwDetectorScript)
    : undefined;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeLandmark(value: unknown): PoseLandmark {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const visibility = finite(item.visibility, finite(item.score, finite(item.confidence, 0)));
  return {
    x: finite(item.x),
    y: finite(item.y),
    z: finite(item.z),
    visibility,
    presence: finite(item.presence, visibility),
  };
}

function normalizeLandmarks(value: unknown): PoseLandmark[] {
  return Array.isArray(value) ? value.map(normalizeLandmark) : [];
}

function emptyLandmark(): PoseLandmark {
  return { x: 0, y: 0, z: 0, visibility: 0, presence: 0 };
}

function averageVisibility(landmarks: readonly PoseLandmark[]) {
  if (!landmarks.length) return 0;
  return (
    landmarks.reduce((acc, landmark) => acc + (landmark.visibility ?? landmark.presence ?? 0), 0) /
    landmarks.length
  );
}

function cocoWholeBodyToMediapipe33(wholeBody: readonly PoseLandmark[]) {
  const out = Array.from({ length: 33 }, emptyLandmark);
  const assign = (mpIndex: number, cocoIndex: number) => {
    if (wholeBody[cocoIndex]) out[mpIndex] = wholeBody[cocoIndex];
  };

  assign(0, 0); // nose
  assign(2, 1); // left eye
  assign(5, 2); // right eye
  assign(7, 3); // left ear
  assign(8, 4); // right ear
  assign(11, 5); // left shoulder
  assign(12, 6); // right shoulder
  assign(13, 7); // left elbow
  assign(14, 8); // right elbow
  assign(15, 9); // left wrist
  assign(16, 10); // right wrist
  assign(23, 11); // left hip
  assign(24, 12); // right hip
  assign(25, 13); // left knee
  assign(26, 14); // right knee
  assign(27, 15); // left ankle
  assign(28, 16); // right ankle
  assign(31, 17); // left foot index / big toe
  assign(29, 19); // left heel
  assign(32, 20); // right foot index / big toe
  assign(30, 22); // right heel

  return out;
}

function normalizeFrame(
  raw: unknown,
  index: number,
  defaults: DetectorDefaults,
): PoseFrameArtifactFrame {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawSchema =
    item.landmarkSchema === "coco_wholebody_133" ||
    item.landmarkSchema === "mediapipe_pose_33" ||
    item.landmarkSchema === "custom"
      ? item.landmarkSchema
      : defaults.landmarkSchema;
  let landmarks = normalizeLandmarks(item.landmarks);
  let wholeBodyLandmarks = normalizeLandmarks(item.wholeBodyLandmarks);
  let landmarkSchema = rawSchema;

  if (landmarks.length === 0 && Array.isArray(item.landmarks33)) {
    landmarks = normalizeLandmarks(item.landmarks33);
  }
  if (
    landmarks.length >= 133 &&
    (landmarkSchema === "coco_wholebody_133" || !landmarkSchema)
  ) {
    wholeBodyLandmarks = landmarks;
    landmarks = cocoWholeBodyToMediapipe33(wholeBodyLandmarks);
    landmarkSchema = "coco_wholebody_133";
  }
  if (landmarks.length !== 33 && wholeBodyLandmarks.length >= 133) {
    landmarks = cocoWholeBodyToMediapipe33(wholeBodyLandmarks);
    landmarkSchema = "coco_wholebody_133";
  }
  if (landmarks.length !== 33) {
    landmarks = [];
  }

  const faceLandmarks = normalizeLandmarks(item.faceLandmarks);
  const leftHandLandmarks = normalizeLandmarks(item.leftHandLandmarks);
  const rightHandLandmarks = normalizeLandmarks(item.rightHandLandmarks);
  const confidence = finite(item.poseConfidence, averageVisibility(landmarks));
  return {
    frameIndex: Number.isInteger(item.frameIndex) ? Number(item.frameIndex) : index,
    timestampMs: finite(item.timestampMs),
    landmarks,
    worldLandmarks: normalizeLandmarks(item.worldLandmarks),
    landmarkSchema:
      landmarkSchema === "coco_wholebody_133" ? "coco_wholebody_133" : "mediapipe_pose_33",
    wholeBodyLandmarks: wholeBodyLandmarks.length ? wholeBodyLandmarks : undefined,
    faceLandmarks: faceLandmarks.length ? faceLandmarks : undefined,
    leftHandLandmarks: leftHandLandmarks.length ? leftHandLandmarks : undefined,
    rightHandLandmarks: rightHandLandmarks.length ? rightHandLandmarks : undefined,
    poseConfidence: confidence,
    detectorVersion:
      typeof item.detectorVersion === "string" ? item.detectorVersion : defaults.version,
  };
}

function normalizePoseArtifact(
  raw: unknown,
  input: DetectInput,
  defaults: DetectorDefaults,
): PoseFramesArtifact {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawDetector =
    source.detector && typeof source.detector === "object"
      ? (source.detector as Record<string, unknown>)
      : {};
  const rawQuality =
    source.quality && typeof source.quality === "object"
      ? (source.quality as Record<string, unknown>)
      : {};
  const rawFrames = Array.isArray(source.frames) ? source.frames : [];
  const frames = rawFrames
    .map((frame, index) => normalizeFrame(frame, index, defaults))
    .filter((frame) => frame.landmarks.length === 33);
  const detectedFrameCount = finite(
    rawQuality.detectedFrameCount,
    frames.filter((frame) => frame.poseConfidence > 0).length,
  );
  const averagePoseConfidence =
    detectedFrameCount > 0
      ? finite(
          rawQuality.averagePoseConfidence,
          frames.reduce((acc, frame) => acc + frame.poseConfidence, 0) / detectedFrameCount,
        )
      : 0;

  return {
    schema: "mocap.pose_frames.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    sourceVideo: {
      ...input.sourceVideo,
      storageKey: input.sourceStorageKey,
      normalizedStorageKey: input.normalizedStorageKey,
    },
    detector: {
      name: typeof rawDetector.name === "string" ? rawDetector.name : defaults.name,
      version:
        typeof rawDetector.version === "string" ? rawDetector.version : defaults.version,
      landmarkSchema:
        rawDetector.landmarkSchema === "coco_wholebody_133"
          ? "coco_wholebody_133"
          : defaults.landmarkSchema ?? "mediapipe_pose_33",
      fallbackReason: defaults.fallbackReason,
    },
    frames,
    quality: {
      frameCount: finite(rawQuality.frameCount, rawFrames.length),
      detectedFrameCount,
      lowConfidenceFrameCount: finite(
        rawQuality.lowConfidenceFrameCount,
        frames.filter((frame) => frame.poseConfidence < 0.45).length,
      ),
      averagePoseConfidence,
    },
  };
}

async function runMediapipeDetector(
  input: DetectInput,
  fallbackReason?: string,
): Promise<PoseFramesArtifact> {
  const outputPath = path.join(input.outputDir, "pose_frames.mediapipe.json");
  await runCommand(
    config.worker.pythonPath,
    [
      mediapipeScriptPath(),
      "--input",
      input.normalizedVideoPath,
      "--output",
      outputPath,
      "--detector-version",
      config.worker.detectorVersion,
    ],
    { timeoutMs: config.worker.poseEngineTimeoutMs },
  );
  return normalizePoseArtifact(JSON.parse(await readFile(outputPath, "utf8")), input, {
    name: "mediapipe_pose",
    version: config.worker.detectorVersion,
    landmarkSchema: "mediapipe_pose_33",
    fallbackReason,
  });
}

async function runRtmwDetector(input: DetectInput): Promise<PoseFramesArtifact> {
  const script = rtmwScriptPath();
  if (!script) {
    throw new Error("RTMW_DETECTOR_SCRIPT is not configured.");
  }
  const outputPath = path.join(input.outputDir, "pose_frames.rtmw.json");
  await runCommand(
    config.worker.pythonPath,
    [
      script,
      "--input",
      input.normalizedVideoPath,
      "--output",
      outputPath,
      "--detector-version",
      config.worker.rtmwDetectorVersion,
      "--output-schema",
      "mocap.pose_frames.v1",
    ],
    { timeoutMs: config.worker.poseEngineTimeoutMs },
  );
  return normalizePoseArtifact(JSON.parse(await readFile(outputPath, "utf8")), input, {
    name: "rtmw_wholebody",
    version: config.worker.rtmwDetectorVersion,
    landmarkSchema: "coco_wholebody_133",
  });
}

export async function detectPoseFrames(input: DetectInput): Promise<PoseFramesArtifact> {
  await mkdir(input.outputDir, { recursive: true });

  if (config.worker.poseEngine === "auto" && !rtmwScriptPath()) {
    return await runMediapipeOrSynthetic(input);
  }

  if (config.worker.poseEngine === "rtmw" || config.worker.poseEngine === "auto") {
    try {
      return await runRtmwDetector(input);
    } catch (error) {
      if (config.worker.poseEngine === "rtmw" || !config.worker.allowPoseFallback) {
        throw error;
      }
      console.warn("[poseDetector] RTMW unavailable; falling back to MediaPipe", error);
      return await runMediapipeOrSynthetic(
        input,
        error instanceof Error ? error.message : "RTMW detector failed.",
      );
    }
  }

  return await runMediapipeOrSynthetic(input);
}

async function runMediapipeOrSynthetic(
  input: DetectInput,
  fallbackReason?: string,
): Promise<PoseFramesArtifact> {
  try {
    return await runMediapipeDetector(input, fallbackReason);
  } catch (error) {
    if (!config.worker.allowSyntheticPose) {
      throw error;
    }
    const outputPath = path.join(input.outputDir, "pose_frames.synthetic.json");
    await writeFile(outputPath, JSON.stringify(createSyntheticPose(input)), "utf8");
    return normalizePoseArtifact(JSON.parse(await readFile(outputPath, "utf8")), input, {
      name: "synthetic_pose",
      version: config.worker.detectorVersion,
      landmarkSchema: "mediapipe_pose_33",
      fallbackReason: error instanceof Error ? error.message : "MediaPipe detector failed.",
    });
  }
}

function createSyntheticPose(input: DetectInput) {
  const fps = Math.max(1, input.sourceVideo.fps);
  const frameCount = Math.max(1, Math.round((input.sourceVideo.durationMs / 1000) * fps));
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
    const timestampMs = Math.round((frameIndex / fps) * 1000);
    const landmarks = Array.from({ length: 33 }, (_unused, index) => ({
      x: 0.5 + Math.sin(frameIndex / 12 + index) * 0.05,
      y: 0.2 + index * 0.012,
      z: Math.cos(frameIndex / 14 + index) * 0.03,
      visibility: 0.9,
      presence: 0.9,
    }));
    return {
      frameIndex,
      timestampMs,
      landmarks,
      worldLandmarks: landmarks.map((landmark) => ({
        x: (landmark.x - 0.5) * 2,
        y: (landmark.y - 0.5) * 2,
        z: landmark.z,
        visibility: landmark.visibility,
        presence: landmark.presence,
      })),
      landmarkSchema: "mediapipe_pose_33",
      poseConfidence: 0.9,
      detectorVersion: config.worker.detectorVersion,
    };
  });
  return {
    schema: "mocap.pose_frames.v1",
    detector: { name: "synthetic_pose", version: config.worker.detectorVersion },
    frames,
  };
}
