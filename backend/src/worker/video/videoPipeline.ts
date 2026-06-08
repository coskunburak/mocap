import { rename, rm } from "fs/promises";
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

export type NormalizeVideoOptions = {
  expectedOrientation?: string | null;
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

function normalizeRotation(value: number) {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function expectedAxis(orientation: string | null | undefined) {
  switch (orientation) {
    case "portrait":
    case "portrait_upside_down":
      return "portrait";
    case "landscape_left":
    case "landscape_right":
      return "landscape";
    default:
      return undefined;
  }
}

function scaleFilter() {
  const maxWidth = config.limits.workerMaxWidth;
  return (
    `scale='if(gt(iw,ih),min(${maxWidth},iw),-2)':` +
    `'if(gt(iw,ih),-2,min(${maxWidth},ih))'`
  );
}

function videoFilter(prefixFilters: string[] = []) {
  const filters = [
    ...prefixFilters,
    scaleFilter(),
    `fps=${config.limits.workerTargetFps}`,
    "format=yuv420p",
  ];
  return filters.join(",");
}

async function transcodeVideo(inputPath: string, outputPath: string, filters: string[]) {
  await runCommand(config.worker.ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-vf",
    videoFilter(filters),
    "-an",
    "-metadata:s:v:0",
    "rotate=0",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

function fallbackOrientationFilter(
  probe: VideoProbe,
  expectedOrientation: string | null | undefined,
) {
  const axis = expectedAxis(expectedOrientation);
  if (axis === "portrait" && probe.width > probe.height) {
    return expectedOrientation === "portrait_upside_down"
      ? "transpose=cclock"
      : "transpose=clock";
  }
  if (axis === "landscape" && probe.height > probe.width) {
    return expectedOrientation === "landscape_right"
      ? "transpose=clock"
      : "transpose=cclock";
  }
  return undefined;
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
  const rotation = normalizeRotation(
    Number(stream.tags?.rotate ?? NaN) ||
      stream.side_data_list?.find((item) => item.rotation != null)?.rotation ||
      0,
  );
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

export async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  options: NormalizeVideoOptions = {},
) {
  await transcodeVideo(inputPath, outputPath, []);
  let normalizedProbe = await probeVideo(outputPath);

  const orientationFilter = fallbackOrientationFilter(
    normalizedProbe,
    options.expectedOrientation,
  );
  if (!orientationFilter) {
    return normalizedProbe;
  }

  const guardedPath = `${outputPath}.orientation.mp4`;
  try {
    await transcodeVideo(outputPath, guardedPath, [orientationFilter]);
    await rm(outputPath, { force: true });
    await rename(guardedPath, outputPath);
    normalizedProbe = await probeVideo(outputPath);
  } finally {
    await rm(guardedPath, { force: true }).catch(() => undefined);
  }

  return normalizedProbe;
}
