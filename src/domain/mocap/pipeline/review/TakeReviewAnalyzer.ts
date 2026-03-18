import { lmAt } from "../../models/Landmark";
import { MP33 } from "../../models/MediapipePose33";
import type { PoseFrame } from "../../models/PoseFrame";
import type { Take, TakeReview } from "../../models/Take";
import { analyzeCalibration } from "../calibration/CalibrationAnalyzer";
import { PoseCleanupPipeline } from "../cleanup/PoseCleanupPipeline";
import { analyzeRetarget } from "../retarget/RetargetSolver";

export type ReviewFinding = Readonly<{
  id: string;
  label: string;
  severity: "info" | "warn" | "critical";
  description: string;
  count: number;
}>;

export type TakeReviewAnalysis = Readonly<{
  rawFrames: PoseFrame[];
  trimmedFrames: PoseFrame[];
  cleanedFrames: PoseFrame[];
  reviewRange: { startFrame: number; endFrame: number };
  calibration: ReturnType<typeof analyzeCalibration>;
  cleanup: ReturnType<typeof PoseCleanupPipeline.run>["report"];
  retarget: ReturnType<typeof analyzeRetarget>;
  issueFrames: number[];
  findings: ReviewFinding[];
  qualityScore: number;
  recommendedReview: TakeReview;
}>;

function clampIndex(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function coreConfidence(frame: PoseFrame) {
  return (
    [
      MP33.LEFT_SHOULDER,
      MP33.RIGHT_SHOULDER,
      MP33.LEFT_HIP,
      MP33.RIGHT_HIP,
      MP33.LEFT_KNEE,
      MP33.RIGHT_KNEE,
      MP33.LEFT_ANKLE,
      MP33.RIGHT_ANKLE,
    ].reduce((sum, index) => sum + lmAt(frame.landmarks, index).c, 0) / 8
  );
}

function extremityCoverage(frame: PoseFrame) {
  return (
    [
      MP33.LEFT_WRIST,
      MP33.RIGHT_WRIST,
      MP33.LEFT_ANKLE,
      MP33.RIGHT_ANKLE,
      MP33.LEFT_FOOT_INDEX,
      MP33.RIGHT_FOOT_INDEX,
    ].reduce((sum, index) => sum + Math.min(1, Math.max(0, lmAt(frame.landmarks, index).c)), 0) /
    6
  );
}

function shoulderTilt(frame: PoseFrame) {
  return Math.abs(
    lmAt(frame.landmarks, MP33.LEFT_SHOULDER).y -
      lmAt(frame.landmarks, MP33.RIGHT_SHOULDER).y,
  );
}

function buildIssueFrames(frames: readonly PoseFrame[], offset = 0) {
  const issueFrames = new Set<number>();
  let lowConfidence = 0;
  let croppedExtremities = 0;
  let unstableTorso = 0;

  frames.forEach((frame, index) => {
    const confidence = coreConfidence(frame);
    const coverage = extremityCoverage(frame);
    const tilt = shoulderTilt(frame);

    if (confidence < 0.42) {
      issueFrames.add(index + offset);
      lowConfidence += 1;
    }
    if (coverage < 0.4) {
      issueFrames.add(index + offset);
      croppedExtremities += 1;
    }
    if (tilt > 0.06) {
      issueFrames.add(index + offset);
      unstableTorso += 1;
    }
  });

  return {
    issueFrames: Array.from(issueFrames).sort((a, b) => a - b),
    lowConfidence,
    croppedExtremities,
    unstableTorso,
  };
}

function buildFindings(
  issueStats: ReturnType<typeof buildIssueFrames>,
  cleanup: ReturnType<typeof PoseCleanupPipeline.run>["report"],
  calibration: ReturnType<typeof analyzeCalibration>,
) {
  const findings: ReviewFinding[] = [];

  if (issueStats.lowConfidence > 0) {
    findings.push({
      id: "confidence",
      label: "Confidence drops",
      severity: issueStats.lowConfidence > 12 ? "critical" : "warn",
      description:
        "Core joints lost confidence in parts of the take. Review those sections before export.",
      count: issueStats.lowConfidence,
    });
  }

  if (issueStats.croppedExtremities > 0) {
    findings.push({
      id: "coverage",
      label: "Extremity coverage loss",
      severity: issueStats.croppedExtremities > 8 ? "critical" : "warn",
      description:
        "Wrists or feet left the frame. Retarget quality will degrade on those frames.",
      count: issueStats.croppedExtremities,
    });
  }

  if (cleanup.contactLockCount > 0 || cleanup.outlierFixCount > 0) {
    findings.push({
      id: "cleanup",
      label: "Cleanup interventions",
      severity: cleanup.outlierFixCount > 24 ? "warn" : "info",
      description:
        "The cleanup pipeline stabilized drift and contacts. Inspect the edited sections in cleaned view.",
      count: cleanup.contactLockCount + cleanup.outlierFixCount,
    });
  }

  if (calibration.status !== "ready") {
    findings.push({
      id: "calibration",
      label: "Calibration risk",
      severity: "warn",
      description:
        "The take started from a weak neutral pose. Double-check upper-body alignment before approving.",
      count: Math.max(1, Math.round((1 - calibration.readinessScore) * 10)),
    });
  }

  if (issueStats.unstableTorso > 0) {
    findings.push({
      id: "torso",
      label: "Torso sway",
      severity: "info",
      description:
        "Shoulder leveling drifted during the take. This may be acceptable for dynamic motion but should be reviewed.",
      count: issueStats.unstableTorso,
    });
  }

  return findings;
}

export function analyzeTakeReview(take: Take, frames: readonly PoseFrame[]): TakeReviewAnalysis {
  const rawFrames = [...frames];
  const maxIndex = Math.max(0, rawFrames.length - 1);
  const initialStart = clampIndex(take.review?.trimStartFrame ?? 0, 0, maxIndex);
  const initialEnd = clampIndex(
    take.review?.trimEndFrame ?? maxIndex,
    initialStart,
    maxIndex,
  );
  const trimmedFrames = rawFrames.slice(initialStart, initialEnd + 1);
  const cleanupRun = PoseCleanupPipeline.run(trimmedFrames);
  const cleanedFrames = cleanupRun.frames.length ? cleanupRun.frames : trimmedFrames;
  const calibration = analyzeCalibration(
    rawFrames.slice(0, Math.min(rawFrames.length, 18)),
    take.calibration?.targetPose ?? (take.trackingProfile === "holistic" ? "t-pose" : "a-pose"),
  );
  const retarget = analyzeRetarget(cleanedFrames);

  const issueStats = buildIssueFrames(trimmedFrames, initialStart);
  const findings = buildFindings(issueStats, cleanupRun.report, calibration);
  const qualityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        calibration.readinessScore * 28 +
          cleanupRun.report.qualityScore * 0.52 +
          (retarget.ready ? 20 : 8) -
          issueStats.issueFrames.length * 0.35,
      ),
    ),
  );

  return {
    rawFrames,
    trimmedFrames,
    cleanedFrames,
    reviewRange: { startFrame: initialStart, endFrame: initialEnd },
    calibration,
    cleanup: cleanupRun.report,
    retarget,
    issueFrames: issueStats.issueFrames,
    findings,
    qualityScore,
    recommendedReview: {
      status: take.review?.status ?? "pending",
      trimStartFrame: initialStart,
      trimEndFrame: initialEnd,
      selectedMode: take.review?.selectedMode ?? "cleaned",
      issueCount: issueStats.issueFrames.length,
      qualityScore,
      note: take.review?.note,
      reviewedAt: take.review?.reviewedAt ?? 0,
    },
  };
}
