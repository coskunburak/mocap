import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { config } from "../../config";
import type {
  PoseFramesArtifact,
  SmplParametersArtifact,
  SolvedMotionArtifact,
  SolvedMotionFrame,
  WhamInputUsageMetrics,
} from "../types";
import { runCommand } from "../runtime/command";
import { resolveMotionRetargetPreset } from "./retargetPresets";
import { ROTATION_ORDER, SKELETON, SKELETON_NAME } from "./skeletonDefinition";

type PremiumSolveInput = {
  takeId: string;
  jobId: string;
  poseArtifact: PoseFramesArtifact;
  source: "single_camera" | "dual_camera" | "multi_view";
  presetId?: string;
  outputDir: string;
  normalizedVideoPaths: string[];
  whamInputUsage?: WhamInputUsageMetrics;
};

export type PremiumSolveAttempt =
  | {
      attempted: true;
      solver: "wham";
      motion: SolvedMotionArtifact;
      overlayPreviewPath?: string;
    };

function resolveScript(script: string) {
  return path.isAbsolute(script) ? script : path.join(process.cwd(), script);
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeEuler(value: unknown): [number, number, number] {
  const item = Array.isArray(value) ? value : [];
  return [finite(item[0]), finite(item[1]), finite(item[2])];
}

function normalizeRoot(value: unknown): [number, number, number] {
  const item = Array.isArray(value) ? value : [];
  return [finite(item[0]), finite(item[1]), finite(item[2])];
}

function normalizeNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => finite(item)) : [];
}

function normalizeVectorArray(value: unknown): number[][] {
  return Array.isArray(value) ? value.map(normalizeNumberArray) : [];
}

function normalizeFrameVectorArray(value: unknown): number[][][] {
  return Array.isArray(value) ? value.map(normalizeVectorArray) : [];
}

function normalizeRootArray(value: unknown): Array<[number, number, number]> {
  return Array.isArray(value) ? value.map(normalizeRoot) : [];
}

function normalizeCamera(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry) => {
      const item = entry[1];
      return (
        typeof item === "number" ||
        typeof item === "string" ||
        typeof item === "boolean" ||
        Array.isArray(item)
      );
    }),
  );
}

function normalizeFrame(value: unknown, index: number): SolvedMotionFrame {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const jointsSource =
    item.joints && typeof item.joints === "object"
      ? (item.joints as Record<string, unknown>)
      : {};
  const joints: SolvedMotionFrame["joints"] = {};
  for (const joint of SKELETON) {
    joints[joint.name] = normalizeEuler(jointsSource[joint.name]);
  }
  return {
    frameIndex: Number.isInteger(item.frameIndex) ? Number(item.frameIndex) : index,
    timestampMs: finite(item.timestampMs),
    rootTranslation: normalizeRoot(item.rootTranslation),
    joints,
  };
}

function normalizePremiumMotion(
  raw: unknown,
  input: PremiumSolveInput,
): SolvedMotionArtifact {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const frames = (Array.isArray(item.frames) ? item.frames : []).map(normalizeFrame);
  const preset = resolveMotionRetargetPreset(input.presetId);
  const warnings = Array.isArray(item.warnings)
    ? item.warnings.filter((value): value is string => typeof value === "string")
    : [];
  const rawMetrics =
    item.metrics && typeof item.metrics === "object"
      ? Object.fromEntries(
          Object.entries(item.metrics as Record<string, unknown>).filter(
            (_entry): _entry is [string, number | string | boolean] =>
              ["number", "string", "boolean"].includes(typeof _entry[1]),
          ),
        )
      : undefined;
  const metrics = mergeWhamInputUsageMetrics(rawMetrics, input.whamInputUsage);
  const smpl = normalizeSmplParameters(item.smpl, input, frames, metrics);

  return {
    schema: "mocap.solved_motion.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    solver: {
      name: "wham",
      version: config.worker.whamSolverVersion,
      source: input.source,
      premium: true,
      metrics,
      whamInputUsage: input.whamInputUsage,
    },
    preset: {
      id: preset.id,
      label: preset.label,
      exportFormat: preset.exportFormat,
      targetSkeleton: preset.retarget.targetSkeleton,
      scaleMode: preset.retarget.scaleMode,
      rootMotion: preset.retarget.rootMotion,
      footLocking: preset.retarget.footLocking,
    },
    ik: {
      enabled: true,
      profile: "wham_world_grounded",
      appliedConstraintCount: preset.constraints.length,
      adjustedJointRotationCount: finite(item.adjustedJointRotationCount),
      warnings,
    },
    skeleton: {
      name: SKELETON_NAME,
      rotationOrder: ROTATION_ORDER,
      coordinateSystem: "right_handed_y_up",
    },
    fps: finite(item.fps, input.poseArtifact.sourceVideo.fps),
    frameCount: frames.length,
    durationMs: finite(item.durationMs, input.poseArtifact.sourceVideo.durationMs),
    frames,
    validation: {
      ok: true,
      warnings,
      errors: [],
    },
    smpl,
  };
}

function normalizeSmplParameters(
  raw: unknown,
  input: PremiumSolveInput,
  frames: SolvedMotionFrame[],
  metrics: Record<string, number | string | boolean> | undefined,
): SmplParametersArtifact | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const item = raw as Record<string, unknown>;
  const model = item.model && typeof item.model === "object"
    ? (item.model as Record<string, unknown>)
    : {};
  const bodyPose = normalizeFrameVectorArray(item.bodyPose);
  const globalOrient = Array.isArray(item.globalOrient)
    ? (item.globalOrient as unknown[]).map(normalizeNumberArray)
    : [];
  if (!bodyPose.length || !globalOrient.length) {
    return undefined;
  }
  const translation = normalizeRootArray(item.translation);
  const joints3d = normalizeFrameVectorArray(item.joints3d);
  const mesh = item.mesh && typeof item.mesh === "object"
    ? (item.mesh as Record<string, unknown>)
    : {};
  const smplify = item.smplify && typeof item.smplify === "object"
    ? (item.smplify as Record<string, unknown>)
    : {};

  const normalizedFrames = frames.map((frame, index) => ({
    frameIndex: frame.frameIndex,
    timestampMs: frame.timestampMs,
    bodyPose: bodyPose[index] ?? [],
    globalOrient: globalOrient[index] ?? [],
    translation: translation[index] ?? frame.rootTranslation,
    joints3d: joints3d[index],
    camera: normalizeCamera(item.camera),
    mesh: undefined,
  }));

  return {
    schema: "mocap.smpl_parameters.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: "wham",
    model: {
      family: "SMPL",
      gender: typeof model.gender === "string" ? model.gender : undefined,
      assetPath: typeof model.assetPath === "string" ? model.assetPath : undefined,
    },
    fps: finite(item.fps, input.poseArtifact.sourceVideo.fps),
    frameCount: frames.length,
    bodyPose,
    globalOrient,
    betas: normalizeNumberArray(item.betas),
    translation,
    camera: normalizeCamera(item.camera),
    joints3d: joints3d.length ? joints3d : undefined,
    mesh: Object.keys(mesh).length
      ? {
          vertexCount: optionalFinite(mesh.vertexCount),
          faceCount: optionalFinite(mesh.faceCount),
          vertices: normalizeFrameVectorArray(mesh.vertices),
          faces: normalizeVectorArray(mesh.faces),
          verticesStorageKey:
            typeof mesh.verticesStorageKey === "string" ? mesh.verticesStorageKey : undefined,
          facesStorageKey:
            typeof mesh.facesStorageKey === "string" ? mesh.facesStorageKey : undefined,
        }
      : undefined,
    smplify: {
      enabled: smplify.enabled === true,
      status:
        smplify.status === "completed" ||
        smplify.status === "failed" ||
        smplify.status === "unknown"
          ? smplify.status
          : "not_run",
      iterations: typeof smplify.iterations === "number" ? smplify.iterations : undefined,
      finalLoss: typeof smplify.finalLoss === "number" ? smplify.finalLoss : undefined,
      reason: typeof smplify.reason === "string" ? smplify.reason : undefined,
    },
    frames: normalizedFrames,
    metrics,
    whamInputUsage: input.whamInputUsage,
  };
}

function mergeWhamInputUsageMetrics(
  metrics: Record<string, number | string | boolean> | undefined,
  whamInputUsage: WhamInputUsageMetrics | undefined,
): Record<string, number | string | boolean> | undefined {
  if (!whamInputUsage) {
    return metrics;
  }
  return {
    ...(metrics ?? {}),
    primaryVideoUsed: whamInputUsage.primaryVideoUsed,
    additionalVideosProvided: whamInputUsage.additionalVideosProvided,
    multiViewReconstructionAvailable:
      whamInputUsage.multiViewReconstructionAvailable,
    multiViewConstraintsUsed: whamInputUsage.multiViewConstraintsUsed,
    primaryWhamFallbackUsed: whamInputUsage.primaryWhamFallbackUsed,
    primaryWhamFallbackReason: whamInputUsage.primaryWhamFallbackReason,
    ...(typeof whamInputUsage.primaryDeviceIndex === "number"
      ? { primaryDeviceIndex: whamInputUsage.primaryDeviceIndex }
      : {}),
  };
}

function optionalWhamArgs() {
  const args: string[] = [];
  if (config.worker.whamRepoDir) {
    args.push("--wham-repo", config.worker.whamRepoDir);
  }
  if (config.worker.whamConfigPath) {
    args.push("--wham-config", config.worker.whamConfigPath);
  }
  if (config.worker.whamPrecomputedOutputPkl) {
    args.push("--wham-output-pkl", config.worker.whamPrecomputedOutputPkl);
  }
  if (config.worker.whamCalibrationPath) {
    args.push("--calib", config.worker.whamCalibrationPath);
  }
  if (config.worker.whamEstimateLocalOnly) {
    args.push("--estimate-local-only");
  }
  if (config.worker.whamRenderOverlayPreview) {
    args.push("--render-overlay-preview");
  }
  args.push("--root-scale", String(config.worker.whamRootScale));
  return args;
}

function optionalWhamEnv() {
  if (!config.worker.whamLibraryPath) return undefined;
  return {
    LD_LIBRARY_PATH: [
      config.worker.whamLibraryPath,
      process.env.LD_LIBRARY_PATH,
    ].filter(Boolean).join(":"),
  };
}

export async function trySolvePremiumMotion(
  input: PremiumSolveInput,
): Promise<PremiumSolveAttempt> {
  if (!config.worker.whamSolverScript) {
    throw new Error("WHAM_SOLVER_SCRIPT is not configured.");
  }

  await mkdir(input.outputDir, { recursive: true });
  const posePath = path.join(input.outputDir, "premium_solver_pose_frames.json");
  const outputPath = path.join(input.outputDir, "premium_solved_motion.json");
  const overlayPreviewPath = path.join(input.outputDir, "wham_work", "output.mp4");
  await writeFile(posePath, JSON.stringify(input.poseArtifact), "utf8");

  try {
    await runCommand(
      config.worker.pythonPath,
      [
        resolveScript(config.worker.whamSolverScript),
        "--pose",
        posePath,
        "--output",
        outputPath,
        "--solver-version",
        config.worker.whamSolverVersion,
        "--source",
        input.source,
        "--preset",
        input.presetId ?? "",
        "--take-id",
        input.takeId,
        "--job-id",
        input.jobId,
        ...optionalWhamArgs(),
        ...input.normalizedVideoPaths.flatMap((videoPath) => ["--video", videoPath]),
      ],
      {
        timeoutMs: config.worker.premiumMotionTimeoutMs,
        env: optionalWhamEnv(),
      },
    );
    const raw = JSON.parse(await readFile(outputPath, "utf8"));
    const overlayPreviewExists = await stat(overlayPreviewPath)
      .then((item) => item.isFile())
      .catch(() => false);
    return {
      attempted: true,
      solver: "wham",
      motion: normalizePremiumMotion(raw, input),
      overlayPreviewPath: overlayPreviewExists ? overlayPreviewPath : undefined,
    };
  } catch (error) {
    const failedReason =
      error instanceof Error ? error.message : "Premium WHAM motion solver failed.";
    throw new Error(failedReason);
  }
}
