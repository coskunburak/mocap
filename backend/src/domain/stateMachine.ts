import type { ProcessingJobState } from "./types";

const order: ProcessingJobState[] = [
  "queued",
  "ingesting",
  "extracting_frames",
  "solving_motion",
  "cleaning",
  "exporting",
  "succeeded",
];

export function canTransitionJob(from: ProcessingJobState, to: ProcessingJobState) {
  if (from === "failed" || from === "canceled" || from === "succeeded") return false;
  if (to === "failed" || to === "canceled") return true;
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  return fromIndex >= 0 && toIndex >= 0 && toIndex >= fromIndex;
}
