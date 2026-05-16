import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { config } from "../../config";
import type { PoseFramesArtifact, SolvedMotionArtifact, SolvedMotionFrame } from "../types";
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
};

export type PremiumSolveAttempt =
  | {
      attempted: true;
      solver: "wham";
      motion: SolvedMotionArtifact;
      overlayPreviewPath?: string;
    }
  | {
      attempted: false;
      solver: "wham";
      skippedReason: string;
    }
  | {
      attempted: true;
      solver: "wham";
      failedReason: string;
    };

function resolveScript(script: string) {
  return path.isAbsolute(script) ? script : path.join(process.cwd(), script);
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeEuler(value: unknown): [number, number, number] {
  const item = Array.isArray(value) ? value : [];
  return [finite(item[0]), finite(item[1]), finite(item[2])];
}

function normalizeRoot(value: unknown): [number, number, number] {
  const item = Array.isArray(value) ? value : [];
  return [finite(item[0]), finite(item[1]), finite(item[2])];
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
  const metrics =
    item.metrics && typeof item.metrics === "object"
      ? Object.fromEntries(
          Object.entries(item.metrics as Record<string, unknown>).filter(
            (_entry): _entry is [string, number | string | boolean] =>
              ["number", "string", "boolean"].includes(typeof _entry[1]),
          ),
        )
      : undefined;

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
  if (config.worker.motionSolver === "builtin") {
    return {
      attempted: false,
      solver: "wham",
      skippedReason: "MOTION_SOLVER is set to builtin.",
    };
  }

  if (!config.worker.whamSolverScript) {
    const skippedReason = "WHAM_SOLVER_SCRIPT is not configured.";
    if (config.worker.motionSolver === "wham" || config.worker.requirePremiumMotion) {
      throw new Error(skippedReason);
    }
    return { attempted: false, solver: "wham", skippedReason };
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
    if (config.worker.motionSolver === "wham" || config.worker.requirePremiumMotion) {
      throw error;
    }
    console.warn("[premiumMotionSolver] WHAM unavailable; falling back to builtin", error);
    return {
      attempted: true,
      solver: "wham",
      failedReason,
    };
  }
}
