import type { Take } from "../../../domain/mocap/models/Take";

export function takeBadge(take: Take) {
  if (take.review?.status === "approved") {
    return "APPROVED";
  }
  if (take.review?.status === "needs-work") {
    return "FIX";
  }
  if (take.postProcess?.status === "cleaned" && take.retarget?.ready) {
    return "READY";
  }
  if (take.postProcess?.status === "cleaned") {
    return "CLEAN";
  }
  if (take.calibration?.status === "ready") {
    return "CAL";
  }
  return "RAW";
}

export function takeTone(take: Take): "default" | "accent" | "muted" | "danger" {
  if (take.review?.status === "needs-work") {
    return "danger";
  }
  if (take.review?.status === "approved") {
    return "accent";
  }
  if (take.postProcess?.qualityScore != null && take.postProcess.qualityScore < 65) {
    return "danger";
  }
  if (take.postProcess?.status === "cleaned") {
    return "accent";
  }
  if (take.calibration?.status === "ready") {
    return "default";
  }
  return "muted";
}

export function takeHighlight(take: Take) {
  const parts = [
    take.calibration
      ? `Cal ${Math.round(take.calibration.readinessScore * 100)}%`
      : undefined,
    take.postProcess
      ? `Cleanup ${take.postProcess.qualityScore}%`
      : undefined,
    take.retarget
      ? `Retarget ${take.retarget.mappedBones}/${take.retarget.totalSourceBones}`
      : undefined,
    take.review
      ? `Review ${take.review.trimStartFrame + 1}-${take.review.trimEndFrame + 1}`
      : undefined,
  ].filter(Boolean);

  return parts.length
    ? parts.join("  •  ")
    : "Capture pending review, calibration, and cleanup.";
}
