import type {
  WhamFallbackReason,
  WhamInputUsageMetrics,
  WhamInputUsageSource,
} from "./types";

export class WhamInputUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhamInputUsageError";
  }
}

export function buildWhamInputUsageMetrics(input: {
  source: WhamInputUsageSource;
  selectedVideos: ReadonlyArray<{
    deviceIndex?: number | null;
    storageKey?: string | null;
  }>;
  primaryDeviceIndex?: number;
  multiViewReconstructionAvailable: boolean;
  multiViewConstraintsUsed: boolean;
  primaryWhamFallbackUsed: boolean;
  primaryWhamFallbackReason: WhamFallbackReason;
}): WhamInputUsageMetrics {
  if (input.selectedVideos.length === 0) {
    throw new WhamInputUsageError(
      "At least one selected video is required to report WHAM input usage.",
    );
  }

  const requestedPrimaryDeviceIndex = Number.isInteger(input.primaryDeviceIndex)
    ? input.primaryDeviceIndex
    : 0;
  const primaryVideoIndex = Math.max(
    input.selectedVideos.findIndex(
      (video) => video.deviceIndex === requestedPrimaryDeviceIndex,
    ),
    0,
  );
  const primaryVideo = input.selectedVideos[primaryVideoIndex] ?? input.selectedVideos[0];
  const primaryDeviceIndex = Number.isInteger(primaryVideo.deviceIndex)
    ? Number(primaryVideo.deviceIndex)
    : requestedPrimaryDeviceIndex;
  const additionalDeviceIndexes = input.selectedVideos
    .filter((_video, index) => index !== primaryVideoIndex)
    .map((video) => video.deviceIndex)
    .filter((deviceIndex): deviceIndex is number => Number.isInteger(deviceIndex));
  const primaryVideoStorageKey =
    typeof primaryVideo.storageKey === "string" && primaryVideo.storageKey.length > 0
      ? primaryVideo.storageKey
      : undefined;

  return {
    source: input.source,
    primaryVideoUsed: true,
    primaryDeviceIndex,
    primaryVideoStorageKey,
    additionalVideosProvided: Math.max(0, input.selectedVideos.length - 1),
    additionalDeviceIndexes,
    multiViewReconstructionAvailable: input.multiViewReconstructionAvailable,
    multiViewConstraintsUsed: false,
    primaryWhamFallbackUsed: input.primaryWhamFallbackUsed,
    primaryWhamFallbackReason: input.primaryWhamFallbackReason,
  };
}

export function whamFallbackReasonFromMultiViewError(
  errorCode: string,
): WhamFallbackReason {
  if (errorCode === "multi_view_pose_extraction_failed") {
    return "multi_view_pose_extraction_failed";
  }
  if (errorCode === "multi_view_reconstruction_disabled") {
    return "multi_view_reconstruction_disabled";
  }
  return "multi_view_reconstruction_failed";
}
