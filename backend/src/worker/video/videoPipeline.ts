import { config } from "../../config";
import { runCommand } from "../runtime/command";

export type VideoProbe = {
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  codec: string;
  rotation: number;
};

type FfprobeStream = {
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, string | undefined>;
  side_data_list?: Array<{ rotation?: number }>;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string };
};

function parseRate(value: string | undefined) {
  if (!value) return 0;
  const [numRaw, denRaw] = value.split("/");
  const num = Number(numRaw);
  const den = Number(denRaw ?? 1);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function parseDurationMs(stream: FfprobeStream, output: FfprobeOutput) {
  const seconds = Number(stream.duration ?? output.format?.duration ?? 0);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

export async function probeVideo(inputPath: string): Promise<VideoProbe> {
  const result = await runCommand(config.worker.ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  const output = JSON.parse(result.stdout) as FfprobeOutput;
  const stream = output.streams?.find((item) => item.width && item.height);
  if (!stream) {
    throw new Error("No video stream found.");
  }
  const fps = parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate);
  const rotation =
    Number(stream.tags?.rotate ?? NaN) ||
    stream.side_data_list?.find((item) => item.rotation != null)?.rotation ||
    0;
  const durationMs = parseDurationMs(stream, output);
  if (durationMs / 1000 > config.limits.maxVideoDurationSeconds) {
    throw new Error(
      `Video exceeds duration limit (${config.limits.maxVideoDurationSeconds}s).`,
    );
  }

  return {
    fps: fps || config.limits.workerTargetFps,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    durationMs,
    codec: stream.codec_name ?? "unknown",
    rotation,
  };
}

export async function normalizeVideo(inputPath: string, outputPath: string) {
  const maxWidth = config.limits.workerMaxWidth;
  const fps = config.limits.workerTargetFps;
  await runCommand(config.worker.ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale='min(${maxWidth},iw)':-2,fps=${fps},format=yuv420p`,
    "-an",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  return probeVideo(outputPath);
}
