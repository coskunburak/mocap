import type { PoseFramesArtifact, QualityReport, SolvedMotionArtifact } from "../types";
import { SKELETON } from "./skeletonDefinition";

function hasOnlyFiniteNumbers(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumbers);
  if (value && typeof value === "object") {
    return Object.values(value).every(hasOnlyFiniteNumbers);
  }
  return true;
}

export function validateSolvedMotion(motion: SolvedMotionArtifact) {
  const errors = [...motion.validation.errors];
  const warnings = [...motion.validation.warnings];

  if (motion.frameCount !== motion.frames.length) {
    errors.push("frameCount does not match frame array length.");
  }
  if (motion.frames.length === 0) {
    errors.push("Motion contains no frames.");
  }
  if (!hasOnlyFiniteNumbers(motion.frames)) {
    errors.push("Motion contains NaN or Infinity.");
  }
  for (const frame of motion.frames) {
    for (const joint of SKELETON) {
      if (!frame.joints[joint.name]) {
        errors.push(`Missing joint rotation: ${joint.name}`);
        break;
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
  };
}

export function validateBvhText(bvh: string, frameCount: number) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!bvh.startsWith("HIERARCHY")) errors.push("BVH does not start with HIERARCHY.");
  if (!bvh.includes("ROOT Hips")) errors.push("BVH root joint Hips is missing.");
  if (!bvh.includes("MOTION")) errors.push("BVH MOTION block is missing.");
  if (!bvh.includes(`Frames: ${frameCount}`)) errors.push("BVH frame count header is wrong.");
  if (frameCount < 2) warnings.push("BVH contains fewer than two frames.");
  if (/NaN|Infinity/.test(bvh)) errors.push("BVH contains NaN or Infinity.");

  return { ok: errors.length === 0, errors, warnings };
}

export function buildQualityReport(
  pose: PoseFramesArtifact,
  solved: SolvedMotionArtifact,
  validation: { ok: boolean; errors: string[]; warnings: string[] },
): QualityReport {
  const detectedRatio =
    pose.quality.frameCount > 0
      ? pose.quality.detectedFrameCount / pose.quality.frameCount
      : 0;
  const solvedRatio =
    pose.quality.frameCount > 0 ? solved.frameCount / pose.quality.frameCount : 0;
  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        pose.quality.averagePoseConfidence * 45 + detectedRatio * 35 + solvedRatio * 20,
      ),
    ),
  );

  return {
    schema: "mocap.quality_report.v1",
    takeId: pose.takeId,
    jobId: pose.jobId,
    score,
    metrics: {
      sourceFrameCount: pose.quality.frameCount,
      detectedFrameCount: pose.quality.detectedFrameCount,
      detectedRatio,
      lowConfidenceFrameCount: pose.quality.lowConfidenceFrameCount,
      averagePoseConfidence: pose.quality.averagePoseConfidence,
      solvedFrameCount: solved.frameCount,
      solvedRatio,
    },
    warnings: validation.warnings,
    errors: validation.errors,
  };
}
