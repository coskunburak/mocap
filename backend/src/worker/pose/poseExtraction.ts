import type {
  LandmarkSchema,
  MultiViewWarningCode,
  PerCameraPoseArtifact,
  PerCameraPoseArtifactStatus,
  PerCameraPoseFrame,
  PerCameraPoseKeypoint2D,
  PerCameraPoseQuality,
  Point2D,
} from "../types";

export type PoseExtractionValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type PoseDetectorKeypoint2D = {
  jointId?: string;
  name?: string;
  x?: number;
  y?: number;
  confidence?: number;
  visibility?: number;
  presence?: number;
};

export type PoseDetectorFrame = {
  frameIndex: number;
  timestampMs?: number;
  timestampSource?: PerCameraPoseFrame["timestampSource"];
  keypoints?: readonly (PoseDetectorKeypoint2D | null | undefined)[];
  keypoints2d?: readonly (Point2D | null | undefined)[];
  confidence?: readonly number[];
  poseConfidence?: number;
};

export type PoseDetectorResult = {
  detector: {
    name: string;
    version: string;
    landmarkSchema: LandmarkSchema;
  };
  detectorSource?: string;
  frames: PoseDetectorFrame[];
  expectedFrameCount?: number;
  status?: PerCameraPoseArtifactStatus;
  reason?: string;
  warnings?: MultiViewWarningCode[];
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

export type BuildMissingPoseFramesArtifactInput =
  ExtractPoseFramesForVideoInput & {
    reason: string;
    detectorSource?: string;
    expectedFrameCount?: number;
  };

export async function extractPoseFramesForVideo(
  input: ExtractPoseFramesForVideoInput,
  adapter: PoseDetectorAdapter,
): Promise<PerCameraPoseArtifact> {
  let detectorResult: PoseDetectorResult;
  try {
    detectorResult = await adapter.extract({
      takeId: input.takeId,
      jobId: input.jobId,
      deviceIndex: input.deviceIndex,
      deviceRole: input.deviceRole,
      sourceVideo: input.sourceVideo,
    });
  } catch (error) {
    return buildMissingPoseFramesArtifact({
      ...input,
      reason:
        error instanceof Error
          ? error.message
          : "Pose detector did not return per-camera frames.",
    });
  }
  return buildPerCameraPoseArtifact({
    ...input,
    detectorResult,
  });
}

export async function extractPoseFramesForVideos(
  inputs: readonly ExtractPoseFramesForVideoInput[],
  adapter?: PoseDetectorAdapter,
): Promise<PerCameraPoseArtifact[]> {
  return Promise.all(
    inputs.map((input) =>
      adapter
        ? extractPoseFramesForVideo(input, adapter)
        : Promise.resolve(
            buildMissingPoseFramesArtifact({
              ...input,
              reason: "No backend 2D pose detector adapter is configured.",
              detectorSource: "unavailable",
            }),
          ),
    ),
  );
}

export function buildPerCameraPoseArtifact(
  input: BuildPerCameraPoseArtifactInput,
): PerCameraPoseArtifact {
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? 0.4;
  const detectorSource =
    input.detectorResult.detectorSource ?? input.detectorResult.detector.name;
  const cameraId = input.cameraId ?? `device_${input.deviceIndex}`;
  const normalizedFrames = input.detectorResult.frames
    .map((frame) =>
      normalizeFrame({
        frame,
        cameraId,
        deviceIndex: input.deviceIndex,
        fps: input.sourceVideo.fps,
        detectorSource,
        detectorVersion: input.detectorResult.detector.version,
        lowConfidenceThreshold,
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
  const hasDetectedKeypoints = quality.detectedFrameCount > 0;
  const status: PerCameraPoseArtifactStatus =
    input.detectorResult.status ??
    (hasDetectedKeypoints
      ? quality.lowConfidenceFrameCount > 0
        ? "low_confidence"
        : "ready"
      : "missing_pose_frames");
  const statusWarnings: MultiViewWarningCode[] = [
    ...(status === "missing_pose_frames"
      ? (["missing_pose_frames"] as const)
      : []),
    ...(quality.lowConfidenceFrameCount > 0
      ? (["low_pose_confidence"] as const)
      : []),
  ];
  const warnings = Array.from(
    new Set<MultiViewWarningCode>([
      ...(input.detectorResult.warnings ?? []),
      ...statusWarnings,
    ]),
  );

  return {
    schema: "mocap.pose_frames_device.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    cameraId,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: input.sourceVideo,
    detector: input.detectorResult.detector,
    detectorSource,
    status,
    reason:
      input.detectorResult.reason ??
      (status === "missing_pose_frames"
        ? "Detector returned no valid 2D keypoints for this camera."
        : undefined),
    frames: normalizedFrames,
    quality,
    averageConfidence: quality.averagePoseConfidence,
    warnings,
  };
}

export function buildMissingPoseFramesArtifact(
  input: BuildMissingPoseFramesArtifactInput,
): PerCameraPoseArtifact {
  const expectedFrameCount =
    input.expectedFrameCount ?? inferFrameCount(input.sourceVideo, []);
  const detectorSource = input.detectorSource ?? "unavailable";
  return {
    schema: "mocap.pose_frames_device.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    cameraId: input.cameraId ?? `device_${input.deviceIndex}`,
    deviceIndex: input.deviceIndex,
    deviceRole: input.deviceRole,
    sourceVideo: input.sourceVideo,
    detector: {
      name: "unavailable_pose_detector",
      version: "none",
      landmarkSchema: "custom",
    },
    detectorSource,
    status: "missing_pose_frames",
    reason: input.reason,
    frames: [],
    quality: {
      frameCount: expectedFrameCount,
      detectedFrameCount: 0,
      missingFrameCount: expectedFrameCount,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 0,
    },
    averageConfidence: 0,
    warnings: ["missing_pose_frames", "pose_detector_unavailable"],
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
  validatePoseStatus(artifact.status, "status", errors);
  validateQuality(artifact.quality, artifact.frames, errors);

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
  cameraId: string;
  deviceIndex: number;
  fps: number;
  detectorSource: string;
  detectorVersion: string;
  lowConfidenceThreshold: number;
}): PerCameraPoseFrame {
  const keypoints = normalizeKeypoints(input.frame);
  const averageFrameConfidence = averageConfidence(
    keypoints.map((keypoint) => keypoint.confidence),
  );
  const poseConfidence = input.frame.poseConfidence ?? averageFrameConfidence;
  const status: PerCameraPoseArtifactStatus =
    keypoints.length === 0
      ? "missing_pose_frames"
      : poseConfidence < input.lowConfidenceThreshold
        ? "low_confidence"
        : "ready";
  const warnings: MultiViewWarningCode[] =
    status === "low_confidence"
      ? ["low_pose_confidence"]
      : status === "missing_pose_frames"
        ? ["missing_pose_frames"]
        : [];

  return {
    cameraId: input.cameraId,
    deviceIndex: input.deviceIndex,
    frameIndex: input.frame.frameIndex,
    timestampMs:
      input.frame.timestampMs ??
      Math.round((input.frame.frameIndex / Math.max(input.fps, 1)) * 1000),
    timestampSource:
      input.frame.timestampSource ??
      (input.frame.timestampMs === undefined ? "frame_index" : "detector"),
    keypoints2d: keypoints.map((keypoint) => ({
      x: keypoint.x,
      y: keypoint.y,
    })),
    confidence: keypoints.map((keypoint) => keypoint.confidence),
    keypoints,
    poseConfidence,
    detectorVersion: input.detectorVersion,
    detectorSource: input.detectorSource,
    averageConfidence: averageFrameConfidence,
    status,
    warnings,
  };
}

function normalizeKeypoints(frame: PoseDetectorFrame): PerCameraPoseKeypoint2D[] {
  if (frame.keypoints) {
    return frame.keypoints.flatMap((keypoint, index) =>
      normalizeRichKeypoint(keypoint, index),
    );
  }

  return (frame.keypoints2d ?? []).flatMap((point, index) =>
    normalizePointKeypoint({
      point,
      index,
      confidence: frame.confidence?.[index],
    }),
  );
}

function normalizeRichKeypoint(
  keypoint: PoseDetectorKeypoint2D | null | undefined,
  index: number,
): PerCameraPoseKeypoint2D[] {
  if (!keypoint) return [];
  if (!isFiniteNumber(keypoint.x) || !isFiniteNumber(keypoint.y)) return [];
  return [
    {
      jointId: keypoint.jointId ?? String(index),
      ...(keypoint.name ? { name: keypoint.name } : {}),
      x: keypoint.x,
      y: keypoint.y,
      confidence: finiteUnitValue(keypoint.confidence, 0),
      ...(isFiniteNumber(keypoint.visibility)
        ? { visibility: finiteUnitValue(keypoint.visibility, 0) }
        : {}),
      ...(isFiniteNumber(keypoint.presence)
        ? { presence: finiteUnitValue(keypoint.presence, 0) }
        : {}),
    },
  ];
}

function normalizePointKeypoint(input: {
  point: Point2D | null | undefined;
  index: number;
  confidence: number | undefined;
}): PerCameraPoseKeypoint2D[] {
  if (!input.point) return [];
  if (!isFiniteNumber(input.point.x) || !isFiniteNumber(input.point.y)) {
    return [];
  }
  return [
    {
      jointId: String(input.index),
      x: input.point.x,
      y: input.point.y,
      confidence: finiteUnitValue(input.confidence, 0),
    },
  ];
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
  const detectedFrameCount = input.frames.filter(
    (frame) => frame.keypoints2d.length > 0,
  ).length;
  const averagePoseConfidence =
    detectedFrameCount > 0
      ? input.frames.reduce((sum, frame) => sum + frame.poseConfidence, 0) /
        Math.max(input.frames.length, 1)
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteUnitValue(value: unknown, fallback: number) {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.min(1, value));
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

function validatePoseStatus(
  status: PerCameraPoseArtifactStatus | undefined,
  field: string,
  errors: string[],
) {
  if (
    status &&
    !["ready", "missing_pose_frames", "low_confidence", "failed"].includes(status)
  ) {
    errors.push(`${field} is invalid`);
  }
}

function validateQuality(
  quality: PerCameraPoseQuality,
  frames: readonly PerCameraPoseFrame[],
  errors: string[],
) {
  const detectedFrameCount = frames.filter(
    (frame) => frame.keypoints2d.length > 0,
  ).length;
  if (quality.detectedFrameCount !== detectedFrameCount) {
    errors.push("quality.detectedFrameCount must match detected frames");
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
  if (frame.keypoints && frame.keypoints.length !== frame.keypoints2d.length) {
    errors.push(`frames[${index}] keypoints and keypoints2d lengths must match`);
  }
  validatePoseStatus(frame.status, `frames[${index}].status`, errors);
  if (
    frame.averageConfidence !== undefined &&
    (!Number.isFinite(frame.averageConfidence) ||
      frame.averageConfidence < 0 ||
      frame.averageConfidence > 1)
  ) {
    errors.push(`frames[${index}].averageConfidence must be between 0 and 1`);
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
  for (const [pointIndex, keypoint] of (frame.keypoints ?? []).entries()) {
    if (!keypoint.jointId) {
      errors.push(`frames[${index}].keypoints[${pointIndex}].jointId is required`);
    }
    if (!Number.isFinite(keypoint.x) || !Number.isFinite(keypoint.y)) {
      errors.push(`frames[${index}].keypoints[${pointIndex}] must be finite`);
    }
    if (
      !Number.isFinite(keypoint.confidence) ||
      keypoint.confidence < 0 ||
      keypoint.confidence > 1
    ) {
      errors.push(
        `frames[${index}].keypoints[${pointIndex}].confidence must be between 0 and 1`,
      );
    }
  }
}
