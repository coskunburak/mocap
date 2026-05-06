import { mkdir, readFile } from "fs/promises";
import path from "path";
import { config } from "../../config";
import { runCommand } from "../runtime/command";

type MetadataLike = Record<string, unknown> | null | undefined;

export type AudioSyncEstimate = {
  method: "audio_waveform" | "metadata_clock" | "recording_timestamp" | "none";
  offsetMs: number;
  confidence: number;
  warnings: string[];
};

const SAMPLE_RATE = 2000;
const WINDOW_MS = 20;
const WINDOW_SAMPLES = Math.max(1, Math.round((SAMPLE_RATE * WINDOW_MS) / 1000));

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateMs(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metadataClockOffset(primary: MetadataLike, secondary: MetadataLike) {
  const primarySync = asRecord(asRecord(primary)?.sync);
  const secondarySync = asRecord(asRecord(secondary)?.sync);
  const primaryOffset = finiteNumber(primarySync?.clockOffsetMs) ?? 0;
  const secondaryOffset = finiteNumber(secondarySync?.clockOffsetMs);
  return secondaryOffset == null ? null : secondaryOffset - primaryOffset;
}

function recordingStartOffset(primary: MetadataLike, secondary: MetadataLike) {
  const primaryStart = dateMs(asRecord(primary)?.recordingStartedAt);
  const secondaryStart = dateMs(asRecord(secondary)?.recordingStartedAt);
  if (primaryStart == null || secondaryStart == null) return null;
  return secondaryStart - primaryStart;
}

async function extractPcmEnvelope(videoPath: string, rawPath: string) {
  await runCommand(config.worker.ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-f",
    "s16le",
    rawPath,
  ]);
  const raw = await readFile(rawPath);
  const windowCount = Math.floor(raw.length / 2 / WINDOW_SAMPLES);
  const envelope = new Float64Array(windowCount);
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    let sum = 0;
    for (let sampleIndex = 0; sampleIndex < WINDOW_SAMPLES; sampleIndex += 1) {
      const byteOffset = (windowIndex * WINDOW_SAMPLES + sampleIndex) * 2;
      const sample = raw.readInt16LE(byteOffset) / 32768;
      sum += sample * sample;
    }
    envelope[windowIndex] = Math.sqrt(sum / WINDOW_SAMPLES);
  }
  return envelope;
}

function normalizeEnvelope(envelope: Float64Array) {
  if (envelope.length === 0) return [];
  const values = Array.from(envelope);
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance) || 1;
  return values.map((value) => (value - mean) / std);
}

function peakConfidence(envelope: Float64Array) {
  if (envelope.length < 3) return { index: -1, confidence: 0 };
  let peak = -Infinity;
  let peakIndex = -1;
  let total = 0;
  for (let index = 0; index < envelope.length; index += 1) {
    const value = envelope[index];
    total += value;
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
  }
  const mean = total / envelope.length;
  const variance =
    Array.from(envelope).reduce((acc, value) => acc + (value - mean) ** 2, 0) /
    envelope.length;
  const std = Math.sqrt(variance) || 1;
  return { index: peakIndex, confidence: Math.max(0, (peak - mean) / std) };
}

function correlateOffset(primary: Float64Array, secondary: Float64Array) {
  const a = normalizeEnvelope(primary);
  const b = normalizeEnvelope(secondary);
  if (a.length < 10 || b.length < 10) return null;
  const maxLag = Math.round(1500 / WINDOW_MS);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < a.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      score += a[i] * b[j];
      count += 1;
    }
    if (count < 10) continue;
    const normalized = score / count;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestLag = lag;
    }
  }
  if (!Number.isFinite(bestScore)) return null;
  return {
    offsetMs: bestLag * WINDOW_MS,
    confidence: Math.max(0, Math.min(1, (bestScore + 1) / 2)),
  };
}

export async function estimateDualCameraSync(input: {
  primaryVideoPath: string;
  secondaryVideoPath: string;
  primaryMetadata: MetadataLike;
  secondaryMetadata: MetadataLike;
  outputDir: string;
}): Promise<AudioSyncEstimate> {
  const warnings: string[] = [];
  await mkdir(input.outputDir, { recursive: true });
  try {
    const primaryRaw = path.join(input.outputDir, "audio_primary.raw");
    const secondaryRaw = path.join(input.outputDir, "audio_secondary.raw");
    const [primaryEnvelope, secondaryEnvelope] = await Promise.all([
      extractPcmEnvelope(input.primaryVideoPath, primaryRaw),
      extractPcmEnvelope(input.secondaryVideoPath, secondaryRaw),
    ]);
    const primaryPeak = peakConfidence(primaryEnvelope);
    const secondaryPeak = peakConfidence(secondaryEnvelope);
    if (primaryPeak.confidence >= 5 && secondaryPeak.confidence >= 5) {
      return {
        method: "audio_waveform",
        offsetMs: (secondaryPeak.index - primaryPeak.index) * WINDOW_MS,
        confidence: Math.min(1, Math.min(primaryPeak.confidence, secondaryPeak.confidence) / 12),
        warnings,
      };
    }
    const correlated = correlateOffset(primaryEnvelope, secondaryEnvelope);
    if (correlated && correlated.confidence >= 0.58) {
      return {
        method: "audio_waveform",
        offsetMs: correlated.offsetMs,
        confidence: correlated.confidence,
        warnings,
      };
    }
    warnings.push("Audio waveform sync confidence was too low; metadata sync was used.");
  } catch (error) {
    warnings.push(
      `Audio waveform sync unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const clockOffset = metadataClockOffset(input.primaryMetadata, input.secondaryMetadata);
  if (clockOffset != null) {
    return {
      method: "metadata_clock",
      offsetMs: clockOffset,
      confidence: 0.62,
      warnings,
    };
  }
  const startOffset = recordingStartOffset(input.primaryMetadata, input.secondaryMetadata);
  if (startOffset != null) {
    return {
      method: "recording_timestamp",
      offsetMs: startOffset,
      confidence: 0.42,
      warnings,
    };
  }
  return {
    method: "none",
    offsetMs: 0,
    confidence: 0.25,
    warnings: [...warnings, "No audio or metadata sync signal was available."],
  };
}
