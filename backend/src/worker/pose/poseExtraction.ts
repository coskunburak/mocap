import type {
  LandmarkSchema,
  PerCameraPoseArtifact,
  PerCameraPoseFrame,
  PerCameraPoseQuality,
  Point2D,
} from "../types";

export type PoseExtractionValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type PoseDetectorFrame = {
  frameIndex: number;
  timestampMs?: number;
  keypoints2d: Point2D[];
  confidence: number[];
  poseConfidence?: number;
};

export type PoseDetectorResult = {
  detector: {
    name: string;
    version: string;
    landmarkSchema: LandmarkSchema;
  };
  frames: PoseDetectorFrame[];
  expectedFrameCount?: number;
};

export type PoseDetectorAdapterInput = {
  takeId: string;
  jobId: string;
  deviceIndex: number;
  deviceRole: string;
  sourceVideo: PerCameraPoseArtifact["sourceVideo"];
};

export type PoseDetectorAdapter = {
  extract(input: PoseDetectorAdapterInput): Promise<PoseDetectorResult>;
};

export type ExtractPoseFramesForVideoInput = PoseDetectorAdapterInput & {
  cameraId?: string;
  lowConfidenceThreshold?: number;
};

export type BuildPerCameraPoseArtifactInput = ExtractPoseFramesForVideoInput & {
  detectorResult: PoseDetectorResult;
};

export async function extractPoseFramesForVideo(
  input: ExtractPoseFramesForVideoInput,
  adapter: PoseDetectorAdapter,
): Promise<PerCameraPoseArtifact> {
  const detectorResult = await adapter.extract({
    takeId: input.takeId,
    jobId: input.jobId,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: input.sourceVideo,
  });
  return buildPerCameraPoseArtifact({
    ...input,
    detectorResult,
  });
}

export function buildPerCameraPoseArtifact(
  input: BuildPerCameraPoseArtifactInput,
): PerCameraPoseArtifact {
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? 0.4;
  const normalizedFrames = input.detectorResult.frames
    .map((frame) =>
      normalizeFrame({
        frame,
        fps: input.sourceVideo.fps,
        detectorVersion: input.detectorResult.detector.version,
      }),
    )
    .sort((a, b) => a.frameIndex - b.frameIndex);
  const quality = buildPoseQuality({
    frames: normalizedFrames,
    expectedFrameCount:
      input.detectorResult.expectedFrameCount ??
      inferFrameCount(input.sourceVideo, normalizedFrames),
    lowConfidenceThreshold,
  });

  return {
    schema: "mocap.pose_frames_device.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    cameraId: input.cameraId ?? `device_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: input.sourceVideo,
    detector: input.detectorResult.detector,
    frames: normalizedFrames,
    quality,
    warnings: [],
  };
}

export function validatePerCameraPoseArtifact(
  artifact: PerCameraPoseArtifact,
): PoseExtractionValidationResult {
  const errors: string[] = [];
  if (artifact.schema !== "mocap.pose_frames_device.v1") {
    errors.push("schema must be mocap.pose_frames_device.v1");
  }
  if (!artifact.takeId) errors.push("takeId is required");
  if (!artifact.jobId) errors.push("jobId is required");
  if (!artifact.cameraId) errors.push("cameraId is required");
  if (!Number.isInteger(artifact.deviceIndex) || artifact.deviceIndex < 0) {
    errors.push("deviceIndex must be a non-negative integer");
  }
  if (!artifact.deviceRole) errors.push("deviceRole is required");
  validateSourceVideo(artifact.sourceVideo, errors);
  if (!artifact.detector.name) errors.push("detector.name is required");
  if (!artifact.detector.version) errors.push("detector.version is required");
  if (!["body_33", "wham_internal", "custom"].includes(artifact.detector.landmarkSchema)) {
    errors.push("detector.landmarkSchema is invalid");
  }
  validateQuality(artifact.quality, artifact.frames.length, errors);

  let previousFrameIndex = -1;
  for (const [index, frame] of artifact.frames.entries()) {
    validateFrame(frame, index, errors);
    if (frame.frameIndex <= previousFrameIndex) {
      errors.push(`frames[${index}].frameIndex must be strictly increasing`);
    }
    previousFrameIndex = frame.frameIndex;
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

function normalizeFrame(input: {
  frame: PoseDetectorFrame;
  fps: number;
  detectorVersion: string;
}): PerCameraPoseFrame {
  return {
    frameIndex: input.frame.frameIndex,
    timestampMs:
      input.frame.timestampMs ??
      Math.round((input.frame.frameIndex / Math.max(input.fps, 1)) * 1000),
    keypoints2d: input.frame.keypoints2d,
    confidence: input.frame.confidence,
    poseConfidence:
      input.frame.poseConfidence ?? averageConfidence(input.frame.confidence),
    detectorVersion: input.detectorVersion,
  };
}

function inferFrameCount(
  sourceVideo: PerCameraPoseArtifact["sourceVideo"],
  frames: readonly PerCameraPoseFrame[],
) {
  const maxFrameIndex = frames.reduce(
    (max, frame) => Math.max(max, frame.frameIndex),
    -1,
  );
  const indexFrameCount = maxFrameIndex + 1;
  const durationFrameCount = Math.round(
    (sourceVideo.durationMs / 1000) * sourceVideo.fps,
  );
  return Math.max(indexFrameCount, durationFrameCount, frames.length);
}

function buildPoseQuality(input: {
  frames: readonly PerCameraPoseFrame[];
  expectedFrameCount: number;
  lowConfidenceThreshold: number;
}): PerCameraPoseQuality {
  const detectedFrameCount = input.frames.length;
  const averagePoseConfidence =
    detectedFrameCount > 0
      ? input.frames.reduce((sum, frame) => sum + frame.poseConfidence, 0) /
        detectedFrameCount
      : 0;
  return {
    frameCount: Math.max(input.expectedFrameCount, detectedFrameCount),
    detectedFrameCount,
    missingFrameCount: Math.max(0, input.expectedFrameCount - detectedFrameCount),
    lowConfidenceFrameCount: input.frames.filter(
      (frame) => frame.poseConfidence < input.lowConfidenceThreshold,
    ).length,
    averagePoseConfidence,
  };
}

function averageConfidence(confidence: readonly number[]) {
  if (!confidence.length) return 0;
  return confidence.reduce((sum, value) => sum + value, 0) / confidence.length;
}

function validateSourceVideo(
  sourceVideo: PerCameraPoseArtifact["sourceVideo"],
  errors: string[],
) {
  if (!sourceVideo.storageKey) errors.push("sourceVideo.storageKey is required");
  if (!sourceVideo.normalizedStorageKey) {
    errors.push("sourceVideo.normalizedStorageKey is required");
  }
  for (const key of ["fps", "width", "height", "durationMs"] as const) {
    const value = sourceVideo[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`sourceVideo.${key} must be a non-negative finite number`);
    }
  }
}

function validateQuality(
  quality: PerCameraPoseQuality,
  frameLength: number,
  errors: string[],
) {
  if (quality.detectedFrameCount !== frameLength) {
    errors.push("quality.detectedFrameCount must match frames length");
  }
  for (const key of [
    "frameCount",
    "detectedFrameCount",
    "missingFrameCount",
    "lowConfidenceFrameCount",
    "averagePoseConfidence",
  ] as const) {
    const value = quality[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`quality.${key} must be a non-negative finite number`);
    }
  }
  if (quality.averagePoseConfidence > 1) {
    errors.push("quality.averagePoseConfidence must be between 0 and 1");
  }
}

function validateFrame(
  frame: PerCameraPoseFrame,
  index: number,
  errors: string[],
) {
  if (!Number.isInteger(frame.frameIndex) || frame.frameIndex < 0) {
    errors.push(`frames[${index}].frameIndex must be a non-negative integer`);
  }
  if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0) {
    errors.push(`frames[${index}].timestampMs must be a non-negative finite number`);
  }
  if (frame.keypoints2d.length !== frame.confidence.length) {
    errors.push(`frames[${index}] keypoints2d and confidence lengths must match`);
  }
  if (
    !Number.isFinite(frame.poseConfidence) ||
    frame.poseConfidence < 0 ||
    frame.poseConfidence > 1
  ) {
    errors.push(`frames[${index}].poseConfidence must be between 0 and 1`);
  }
  for (const [pointIndex, point] of frame.keypoints2d.entries()) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      errors.push(`frames[${index}].keypoints2d[${pointIndex}] must be finite`);
    }
  }
  for (const [confidenceIndex, confidence] of frame.confidence.entries()) {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push(
        `frames[${index}].confidence[${confidenceIndex}] must be between 0 and 1`,
      );
    }
  }
}
