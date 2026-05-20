import type {
  CleanupReport,
  PoseFramesArtifact,
  PreviewSummary,
  QualityReport,
  SolvedMotionArtifact,
} from "../types";
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
  cleanup: CleanupReport,
  validation: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    blenderOk: boolean;
    blenderSkipped: boolean;
  },
  inputSource: "single_camera" | "dual_camera" | "multi_view" = "single_camera",
): QualityReport {
  const detectedRatio =
    pose.quality.frameCount > 0
      ? pose.quality.detectedFrameCount / pose.quality.frameCount
      : 0;
  const solvedRatio =
    pose.quality.frameCount > 0 ? solved.frameCount / pose.quality.frameCount : 0;
  const singleCameraScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        pose.quality.averagePoseConfidence * 24 +
          detectedRatio * 18 +
          solvedRatio * 14 +
          cleanup.metrics.jitterScore * 13 +
          cleanup.metrics.footSlidingScore * 11 +
          cleanup.metrics.boneLengthConsistency * 12 +
          cleanup.metrics.rootStability * 8,
      ),
    ),
  );
  const score = singleCameraScore;
  const grade =
    validation.errors.length > 0
      ? "failed"
      : score >= 88
        ? "excellent"
        : score >= 74
          ? "good"
          : score >= 58
            ? "usable"
            : "poor";
  const summary =
    grade === "excellent"
      ? "Clean solve. Export is ready for DCC review."
      : grade === "good"
        ? "Usable solve with minor cleanup warnings."
        : grade === "usable"
          ? "Export is usable, but review foot contact and jitter before final delivery."
          : grade === "poor"
            ? "Input quality is low. Re-capture is recommended for production delivery."
            : "Export validation failed. Reprocess or re-capture before delivery.";

  return {
    schema: "mocap.quality_report.v1",
    takeId: pose.takeId,
    jobId: pose.jobId,
    score,
    grade,
    summary,
    metrics: {
      ...cleanup.metrics,
      detectedFrameCount: pose.quality.detectedFrameCount,
      detectedRatio,
      lowConfidenceFrameCount: pose.quality.lowConfidenceFrameCount,
      averagePoseConfidence: pose.quality.averagePoseConfidence,
      solvedRatio,
      ikAppliedConstraintCount: solved.ik?.appliedConstraintCount ?? 0,
      ikAdjustedJointRotationCount: solved.ik?.adjustedJointRotationCount ?? 0,
      retargetPresetEnabled: solved.preset ? 1 : 0,
    },
    warnings: [
      ...validation.warnings,
      ...cleanup.warnings,
      ...(solved.ik?.warnings ?? []),
    ],
    errors: validation.errors,
    actions: cleanup.actions,
    validation: {
      exportOk: validation.ok,
      blenderOk: validation.blenderOk,
      blenderSkipped: validation.blenderSkipped,
    },
    inputSource: {
      source: inputSource,
    },
  };
}

export function buildPreviewSummary(
  solved: SolvedMotionArtifact,
  quality: QualityReport,
  cleanup: CleanupReport,
): PreviewSummary {
  const roots = solved.frames.map((frame) => frame.rootTranslation);
  const min = roots.reduce(
    (acc, root) => [
      Math.min(acc[0], root[0]),
      Math.min(acc[1], root[1]),
      Math.min(acc[2], root[2]),
    ] as [number, number, number],
    [Infinity, Infinity, Infinity],
  );
  const max = roots.reduce(
    (acc, root) => [
      Math.max(acc[0], root[0]),
      Math.max(acc[1], root[1]),
      Math.max(acc[2], root[2]),
    ] as [number, number, number],
    [-Infinity, -Infinity, -Infinity],
  );
  const rootTravel = roots.slice(1).reduce((acc, root, index) => {
    const previous = roots[index];
    return acc + Math.hypot(root[0] - previous[0], root[2] - previous[2]);
  }, 0);

  return {
    schema: "mocap.preview_summary.v1",
    takeId: solved.takeId,
    jobId: solved.jobId,
    fps: solved.fps,
    durationMs: solved.durationMs,
    frameCount: solved.frameCount,
    qualityScore: quality.score,
    rootTravel,
    rootBounds: {
      min: min.map((value) => (Number.isFinite(value) ? value : 0)) as [
        number,
        number,
        number,
      ],
      max: max.map((value) => (Number.isFinite(value) ? value : 0)) as [
        number,
        number,
        number,
      ],
    },
    contactFrames: cleanup.metrics.footContactFrameCount,
    warnings: quality.warnings.slice(0, 8),
  };
}
