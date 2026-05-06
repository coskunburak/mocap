import * as FSAny from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import type { PoseFrame } from "../../models/PoseFrame";
import type { Take, TakeId, TakeMotionArtifact } from "../../models/Take";
import { BVHWriter } from "./BVHWriter";
import { readTakeFrames, readTakeMeta } from "../../../../infra/persistence/takeRepoFs.reader";
import { takeRepoFs } from "../../../../infra/persistence/TakeRepo.fs";
import { analyzeCalibration } from "../calibration/CalibrationAnalyzer";
import { PoseCleanupPipeline } from "../cleanup/PoseCleanupPipeline";
import { analyzeRetarget } from "../retarget/RetargetSolver";
import {
  getExportPreset,
  type ExportFormat,
  type ExportPresetId,
  type SingleExportFormat,
} from "./ExportPresets";
import { bakeAnimation } from "./AnimationBake";
import { GltfWriter } from "./GltfWriter";
import { FbxWriter } from "./FbxWriter";
import { UsdWriter } from "./UsdWriter";
import {
  validateBakedAnimation,
  type ExportValidationResult,
} from "./ExportValidator";
export type {
  ExportFormat,
  ExportPresetId,
  SingleExportFormat,
} from "./ExportPresets";

type ExpoFS = typeof FSAny & {
  documentDirectory: string | null;
  cacheDirectory: string | null;
  EncodingType: { UTF8: string };
};

const FS = FSAny as unknown as ExpoFS;

export type ExportResult = {
  exportDir: string;
  files: Array<{ format: SingleExportFormat; path: string; primary?: boolean }>;
  primaryPath?: string;
  validation?: ExportValidationResult;
  jsonPath?: string;
  bvhPath?: string;
  gltfPath?: string;
  glbPath?: string;
  fbxPath?: string;
  usdPath?: string;
};

type ExportOptions = {
  format?: ExportFormat;
  presetId?: ExportPresetId;
  filenamePrefix?: string;
  includeFramesInJson?: boolean;
  bvhFps?: number;
};

function safeName(value: string) {
  return value.replace(/[^\w\-\.]+/g, "_");
}

function ensureExportDir(): string {
  const base = FS.cacheDirectory ?? FS.documentDirectory;
  if (!base) {
    return "file://";
  }
  return `${base}mocap/exports/`;
}

async function mkdirp(dir: string) {
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function writeUtf8(path: string, content: string) {
  await FS.writeAsStringAsync(path, content, { encoding: FS.EncodingType.UTF8 as any } as any);
}

async function writeBase64(path: string, content: string) {
  await FS.writeAsStringAsync(path, content, { encoding: "base64" as any } as any);
}

function estimateFps(frames: PoseFrame[]): number | null {
  if (frames.length < 2) {
    return null;
  }

  const dt = frames[frames.length - 1].ts - frames[0].ts;
  if (dt <= 0) {
    return null;
  }

  return (frames.length - 1) / (dt / 1000);
}

function buildExportMotionArtifact(
  rawFrames: readonly PoseFrame[],
  cleanedFrames: readonly PoseFrame[],
  baked: ReturnType<typeof bakeAnimation>,
  calibration: NonNullable<Take["calibration"]>,
  retarget: ReturnType<typeof analyzeRetarget>,
  validation: ExportValidationResult,
  qualityScore: number,
  avatarPreset: string,
): TakeMotionArtifact {
  const issues = validation.issues.map((issue) => issue.message);

  return {
    status:
      validation.ok && retarget.ready && calibration.status === "ready" && qualityScore >= 70
        ? "ready"
        : "needs-review",
    solverVersion: baked.solverVersion,
    sourceSpace: baked.sourceSpace,
    raw2dFrameCount: rawFrames.length,
    rawWorldFrameCount: rawFrames.filter((frame) => frame.worldLandmarks).length,
    triangulatedFrameCount: rawFrames.filter(
      (frame) => frame.triangulated && frame.worldLandmarks,
    ).length,
    cleaned3dFrameCount: cleanedFrames.length,
    bakedAvatarFrameCount: baked.frames.length,
    calibrationFrameCount: baked.calibrationFrameCount,
    targetPose: baked.targetPose,
    avatarPreset,
    qualityScore,
    issues,
    generatedAt: Date.now(),
  };
}

export const TakeExporter = {
  async exportTake(takeId: TakeId, opts?: ExportOptions): Promise<ExportResult> {
    const preset = getExportPreset(opts?.presetId ?? "dcc-archive");
    const format: ExportFormat = opts?.format ?? "bundle";
    const includeFramesInJson = opts?.includeFramesInJson ?? true;
    const formats: SingleExportFormat[] =
      format === "bundle"
        ? [...preset.formats]
        : format === "both"
          ? ["json", "bvh"]
          : [format];

    const [meta, rawFrames] = await Promise.all([readTakeMeta(takeId), readTakeFrames(takeId)]);
    if (rawFrames.length === 0) {
      throw new Error("No frames available for export.");
    }
    const trimStart = Math.max(0, meta.review?.trimStartFrame ?? 0);
    const trimEnd = Math.max(
      trimStart,
      Math.min(rawFrames.length - 1, meta.review?.trimEndFrame ?? rawFrames.length - 1),
    );
    const frames = rawFrames.slice(trimStart, trimEnd + 1);
    const cleanup = PoseCleanupPipeline.run(frames);
    const cleanedFrames = cleanup.frames.length ? cleanup.frames : frames;
    const calibration =
      meta.calibration ??
      analyzeCalibration(cleanedFrames.slice(0, Math.min(cleanedFrames.length, 18)));
    const retarget = analyzeRetarget(cleanedFrames, {
      presetId: preset.retargetPresetId,
    });
    const baked = bakeAnimation(cleanedFrames, {
      fps: opts?.bvhFps ?? estimateFps(cleanedFrames) ?? 30,
      presetId: preset.id,
      preserveRootMotion: "auto",
      targetPose: calibration.targetPose,
    });
    const validation = validateBakedAnimation(baked, preset.id);
    if (!validation.ok) {
      throw new Error(
        validation.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join(" "),
      );
    }
    const qualityScore = Math.round(
      ((calibration.readinessScore * 100) + cleanup.report.qualityScore) / 2,
    );
    const motion = buildExportMotionArtifact(
      rawFrames,
      cleanedFrames,
      baked,
      calibration,
      retarget,
      validation,
      qualityScore,
      preset.id,
    );
    const nextMeta: Take = await takeRepoFs.updateTakeMeta(takeId, {
      trackingProfile:
        meta.trackingProfile ??
        cleanedFrames[0]?.trackingProfile ??
        meta.trackingProfile,
      calibration,
      postProcess: cleanup.report,
      retarget,
      review: meta.review,
      motion,
      qualityScore,
    });

    const exportDir = ensureExportDir();
    await mkdirp(exportDir);

    const baseName = safeName(opts?.filenamePrefix ?? `take_${takeId}`);
    const out: ExportResult = { exportDir, files: [], validation };
    const setOutput = (formatName: SingleExportFormat, path: string) => {
      out.files.push({
        format: formatName,
        path,
        primary: formatName === preset.primaryFormat,
      });
      if (formatName === "json") out.jsonPath = path;
      if (formatName === "bvh") out.bvhPath = path;
      if (formatName === "gltf") out.gltfPath = path;
      if (formatName === "glb") out.glbPath = path;
      if (formatName === "fbx") out.fbxPath = path;
      if (formatName === "usd") out.usdPath = path;
    };

    if (formats.includes("json")) {
      const payload = includeFramesInJson
        ? {
            schema: "mocap.take.v6",
            take: nextMeta,
            cleanup: cleanup.report,
            retarget,
            calibration,
            motion: nextMeta.motion,
            review: nextMeta.review,
            exportPreset: {
              id: preset.id,
              primaryFormat: preset.primaryFormat,
              formats: [...preset.formats],
              retargetPresetId: preset.retargetPresetId,
            },
            exportValidation: validation,
            skeleton: {
              root: baked.nodes[0]?.name ?? "Hips",
              fps: baked.fps,
              duration: baked.duration,
              scaleMultiplier: baked.scaleMultiplier,
              solverVersion: baked.solverVersion,
              sourceSpace: baked.sourceSpace,
              targetPose: baked.targetPose,
              joints: baked.nodes.map((node, index) => ({
                sourceJoint: node.sourceJoint,
                name: node.name,
                parentIndex: node.parentIndex,
                offset: node.offset,
                restLocalRotation: baked.restLocalRotations[index],
              })),
            },
            frames: cleanedFrames.map((frame) => ({
              ts: frame.ts,
              lm: Array.from(frame.landmarks),
              wlm: frame.worldLandmarks ? Array.from(frame.worldLandmarks) : undefined,
              flm: frame.faceLandmarks ? Array.from(frame.faceLandmarks) : undefined,
              lhm: frame.leftHandLandmarks
                ? Array.from(frame.leftHandLandmarks)
                : undefined,
              lhwm: frame.leftHandWorldLandmarks
                ? Array.from(frame.leftHandWorldLandmarks)
                : undefined,
              rhm: frame.rightHandLandmarks
                ? Array.from(frame.rightHandLandmarks)
                : undefined,
              rhwm: frame.rightHandWorldLandmarks
                ? Array.from(frame.rightHandWorldLandmarks)
                : undefined,
              fbs: frame.faceBlendshapes,
              psm: frame.hasPoseSegmentationMask ?? false,
              prof: frame.trackingProfile ?? "pose",
              rprof: frame.requestedTrackingProfile ?? "auto",
            })),
          }
        : {
            schema: "mocap.take.v6",
            take: nextMeta,
            cleanup: cleanup.report,
            retarget,
            calibration,
            motion: nextMeta.motion,
            review: nextMeta.review,
            exportPreset: {
              id: preset.id,
              primaryFormat: preset.primaryFormat,
              formats: [...preset.formats],
              retargetPresetId: preset.retargetPresetId,
            },
            exportValidation: validation,
            skeleton: {
              root: baked.nodes[0]?.name ?? "Hips",
              fps: baked.fps,
              duration: baked.duration,
              scaleMultiplier: baked.scaleMultiplier,
              solverVersion: baked.solverVersion,
              sourceSpace: baked.sourceSpace,
              targetPose: baked.targetPose,
              joints: baked.nodes.map((node, index) => ({
                sourceJoint: node.sourceJoint,
                name: node.name,
                parentIndex: node.parentIndex,
                offset: node.offset,
                restLocalRotation: baked.restLocalRotations[index],
              })),
            },
            frames: [],
          };

      const jsonPath = `${exportDir}${baseName}.json`;
      await writeUtf8(jsonPath, JSON.stringify(payload));
      setOutput("json", jsonPath);
    }

    if (formats.includes("bvh")) {
      const bvh = BVHWriter.fromBakedAnimation(baked);

      const bvhPath = `${exportDir}${baseName}.bvh`;
      await writeUtf8(bvhPath, bvh);
      setOutput("bvh", bvhPath);
    }

    if (formats.includes("gltf")) {
      const gltf = GltfWriter.toGltf(baked);
      const gltfPath = `${exportDir}${baseName}.gltf`;
      await writeUtf8(gltfPath, gltf.jsonText);
      setOutput("gltf", gltfPath);
    }

    if (formats.includes("glb")) {
      const glb = GltfWriter.toGlb(baked);
      const glbPath = `${exportDir}${baseName}.glb`;
      const base64 = (() => {
        const alphabet =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let output = "";
        const bytes = glb.glbBytes;
        for (let index = 0; index < bytes.length; index += 3) {
          const a = bytes[index] ?? 0;
          const b = bytes[index + 1] ?? 0;
          const c = bytes[index + 2] ?? 0;
          const chunk = (a << 16) | (b << 8) | c;
          const remaining = Math.min(3, bytes.length - index);
          output += alphabet[(chunk >> 18) & 63];
          output += alphabet[(chunk >> 12) & 63];
          output += remaining > 1 ? alphabet[(chunk >> 6) & 63] : "=";
          output += remaining > 2 ? alphabet[chunk & 63] : "=";
        }
        return output;
      })();
      await writeBase64(glbPath, base64);
      setOutput("glb", glbPath);
    }

    if (formats.includes("fbx")) {
      const fbx = FbxWriter.fromBakedAnimation(baked);
      const fbxPath = `${exportDir}${baseName}.fbx`;
      await writeUtf8(fbxPath, fbx);
      setOutput("fbx", fbxPath);
    }

    if (formats.includes("usd")) {
      const usd = UsdWriter.fromBakedAnimation(baked);
      const usdPath = `${exportDir}${baseName}.usda`;
      await writeUtf8(usdPath, usd);
      setOutput("usd", usdPath);
    }

    out.primaryPath =
      out.files.find((file) => file.primary)?.path ?? out.files[0]?.path;

    return out;
  },

  async shareFile(path: string) {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { shared: false as const };
    }

    await Sharing.shareAsync(path);
    return { shared: true as const };
  },

  async getTakeMeta(takeId: TakeId): Promise<Take> {
    return await readTakeMeta(takeId);
  },
};
