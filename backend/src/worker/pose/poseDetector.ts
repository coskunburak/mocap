import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { config } from "../../config";
import type { PoseFramesArtifact } from "../types";
import { runCommand } from "../runtime/command";

type DetectInput = {
  takeId: string;
  jobId: string;
  normalizedVideoPath: string;
  sourceStorageKey: string;
  normalizedStorageKey: string;
  outputDir: string;
  sourceVideo: PoseFramesArtifact["sourceVideo"];
};

function scriptPath() {
  return path.isAbsolute(config.worker.poseDetectorScript)
    ? config.worker.poseDetectorScript
    : path.join(process.cwd(), config.worker.poseDetectorScript);
}

export async function detectPoseFrames(input: DetectInput): Promise<PoseFramesArtifact> {
  await mkdir(input.outputDir, { recursive: true });
  const outputPath = path.join(input.outputDir, "pose_frames.raw.json");

  try {
    await runCommand(config.worker.pythonPath, [
      scriptPath(),
      "--input",
      input.normalizedVideoPath,
      "--output",
      outputPath,
      "--detector-version",
      config.worker.detectorVersion,
    ]);
  } catch (error) {
    if (!config.worker.allowSyntheticPose) {
      throw error;
    }
    await writeFile(outputPath, JSON.stringify(createSyntheticPose(input)), "utf8");
  }

  const raw = JSON.parse(await readFile(outputPath, "utf8")) as Omit<
    PoseFramesArtifact,
    "takeId" | "jobId" | "sourceVideo"
  >;

  return {
    schema: "mocap.pose_frames.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    sourceVideo: {
      ...input.sourceVideo,
      storageKey: input.sourceStorageKey,
      normalizedStorageKey: input.normalizedStorageKey,
    },
    detector: raw.detector,
    frames: raw.frames,
    quality: raw.quality,
  };
}

function createSyntheticPose(input: DetectInput) {
  const fps = Math.max(1, input.sourceVideo.fps);
  const frameCount = Math.max(1, Math.round(input.sourceVideo.durationMs / 1000 * fps));
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
      poseConfidence: 0.9,
      detectorVersion: config.worker.detectorVersion,
    };
  });
  return {
    schema: "mocap.pose_frames.v1",
    detector: { name: "synthetic_pose", version: config.worker.detectorVersion },
    frames,
    quality: {
      frameCount,
      detectedFrameCount: frameCount,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 0.9,
    },
  };
}
