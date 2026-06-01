import type {
  CameraCalibrationArtifact,
  CameraProjection,
  MultiViewSource,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  PerCameraPoseFrame,
  ProjectionMatrix3x4,
  TriangulatedJointTrackArtifact,
  TriangulatedJointTrackFrame,
  TriangulatedJointTrackFrameStatus,
  TriangulatedJointTrackJoint,
  TriangulatedJointTrackJointStatus,
  TriangulatedJointTrackStatus,
  Vector3,
} from "../types";
import { triangulateMatchedFramePair } from "./triangulation";

const DEFAULT_MIN_KEYPOINT_CONFIDENCE = 0.3;
const DEFAULT_MAX_REPROJECTION_ERROR_PX = 10;
const DEFAULT_MAX_TEMPORAL_JUMP_METERS = 1.5;
const DEFAULT_SMOOTHING_WINDOW_FRAMES = 3;
const DEFAULT_MIN_TRIANGULATED_JOINT_RATIO = 0.5;

export type TriangulatedJointTrackOptions = {
  minKeypointConfidence?: number;
  maxReprojectionErrorPx?: number;
  maxTemporalJumpMeters?: number;
  smoothingWindowFrames?: number;
  minTriangulatedJointRatio?: number;
  allowDiagnosticApproximateCalibration?: boolean;
};

export type BuildTriangulatedJointTrackInput = {
  takeId: string;
  jobId: string;
  source: MultiViewSource;
  poseArtifacts?: readonly PerCameraPoseArtifact[];
  syncReport?: MultiViewSyncReport;
  cameraCalibration?: CameraCalibrationArtifact;
  options?: TriangulatedJointTrackOptions;
};

type NormalizedOptions = Required<TriangulatedJointTrackOptions>;

type BuildContext = {
  pose0: PerCameraPoseArtifact;
  pose1: PerCameraPoseArtifact;
  projection0: CameraProjection;
  projection1: CameraProjection;
};

type MutableTrackJoint = {
  jointId: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  rawX?: number;
  rawY?: number;
  rawZ?: number;
  confidence?: number;
  sourceCameraIds: string[];
  reprojectionErrorPx?: number;
  status: TriangulatedJointTrackJointStatus;
  reason?: string;
  warnings: string[];
};

type MutableTrackFrame = {
  frameIndex: number;
  timestampMs: number;
  sourceFrameIndices: Record<string, number>;
  status: TriangulatedJointTrackFrameStatus;
  joints: MutableTrackJoint[];
  warnings: string[];
};

type Counters = {
  totalJointSlots: number;
  trackedJointCount: number;
  lowConfidenceJointCount: number;
  occludedJointCount: number;
  highReprojectionJointCount: number;
  smoothedJointCount: number;
  interpolatedJointCount: number;
  droppedJointCount: number;
  reprojectionErrors: number[];
  confidences: number[];
};

export function buildTriangulatedJointTrackArtifact(
  input: BuildTriangulatedJointTrackInput,
): TriangulatedJointTrackArtifact {
  const options = normalizeOptions(input.options);
  const blocked = blockedStatus(input, options);
  if (blocked) {
    return buildBlockedArtifact({ input, status: blocked.status, reason: blocked.reason });
  }

  const context = buildContext(input);
  if (!context) {
    return buildBlockedArtifact({
      input,
      status: "missing_calibration",
      reason: "At least two calibrated camera projection matrices are required.",
    });
  }
  const syncReport = input.syncReport;
  const cameraCalibration = input.cameraCalibration;
  if (!syncReport || !cameraCalibration) {
    return buildBlockedArtifact({
      input,
      status: !syncReport ? "missing_sync" : "missing_calibration",
      reason: !syncReport
        ? "A valid multi-view sync report is required."
        : "At least two valid camera calibrations are required.",
    });
  }

  const warnings = new Set<string>();
  if (syncReport.status !== "ready") {
    warnings.add(`sync_${syncReport.status}`);
  }
  if (cameraCalibration.status && cameraCalibration.status !== "ready") {
    warnings.add(`calibration_${cameraCalibration.status}`);
  }

  let frames = syncReport.matchedFrames.map((matchedFrame) =>
    buildTrackFrame({ matchedFrame, context, options }),
  );
  const temporalJitterBefore = computeTemporalJitter(frames, "raw");
  frames = interpolateOcclusions({ frames, options });
  frames = smoothFrames({ frames, options });
  frames = refreshFrameStatuses(frames);
  const temporalJitterAfter = computeTemporalJitter(frames, "smoothed");
  const metrics = buildMetrics({
    matchedFrameCount: syncReport.metrics.matchedFrameCount,
    frames,
    temporalJitterBefore,
    temporalJitterAfter,
  });
  if (
    metrics.triangulatedJointRatio !== undefined &&
    metrics.triangulatedJointRatio < options.minTriangulatedJointRatio
  ) {
    warnings.add("joint_track_coverage_low");
  }
  for (const frame of frames) {
    for (const warning of frame.warnings) warnings.add(warning);
    for (const joint of frame.joints) {
      for (const warning of joint.warnings) warnings.add(warning);
    }
  }

  const status = resolveArtifactStatus({
    frames,
    metrics,
    warnings,
    options,
  });

  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    source: input.source,
    status,
    ...(status === "ready"
      ? {}
      : { reason: reasonForStatus(status, metrics) }),
    coordinateSystem: "right_handed_y_up",
    jointSet: inferJointSet(input.poseArtifacts ?? []),
    cameraIds: [context.pose0.cameraId, context.pose1.cameraId],
    frameCount: frames.length,
    trackedFrameCount: frames.filter((frame) =>
      frame.joints.some((joint) => has3d(joint)),
    ).length,
    metrics,
    frames: frames.map(readonlyFrame),
    warnings: Array.from(warnings),
  };
}

export function validateTriangulatedJointTrackArtifact(
  artifact: TriangulatedJointTrackArtifact,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (artifact.schema !== "mocap.triangulated_joint_track.v1") {
    errors.push("schema must be mocap.triangulated_joint_track.v1");
  }
  if (!artifact.takeId) errors.push("takeId is required");
  if (!artifact.jobId) errors.push("jobId is required");
  if (!["dual_camera", "multi_view"].includes(artifact.source)) {
    errors.push("source must be dual_camera or multi_view");
  }
  if (artifact.frameCount !== artifact.frames.length) {
    errors.push("frameCount must match frames length");
  }
  if (artifact.trackedFrameCount > artifact.frameCount) {
    errors.push("trackedFrameCount must not exceed frameCount");
  }
  for (const [frameIndex, frame] of artifact.frames.entries()) {
    if (!Number.isInteger(frame.frameIndex) || frame.frameIndex < 0) {
      errors.push(`frames[${frameIndex}].frameIndex must be a non-negative integer`);
    }
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0) {
      errors.push(`frames[${frameIndex}].timestampMs must be a non-negative number`);
    }
    for (const [jointIndex, joint] of frame.joints.entries()) {
      if (!joint.jointId) {
        errors.push(`frames[${frameIndex}].joints[${jointIndex}].jointId is required`);
      }
      const coordinateKeys = ["x", "y", "z", "rawX", "rawY", "rawZ"] as const;
      for (const key of coordinateKeys) {
        const value = joint[key];
        if (value !== undefined && !Number.isFinite(value)) {
          errors.push(`frames[${frameIndex}].joints[${jointIndex}].${key} must be finite`);
        }
      }
      if (
        joint.status !== "occluded" &&
        joint.status !== "dropped" &&
        joint.status !== "low_confidence" &&
        joint.status !== "high_reprojection_error" &&
        joint.status !== "insufficient_views" &&
        (!Number.isFinite(joint.x) ||
          !Number.isFinite(joint.y) ||
          !Number.isFinite(joint.z))
      ) {
        errors.push(
          `frames[${frameIndex}].joints[${jointIndex}] tracked/interpolated/smoothed joints require finite x/y/z`,
        );
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function blockedStatus(
  input: BuildTriangulatedJointTrackInput,
  options: NormalizedOptions,
): { status: TriangulatedJointTrackStatus; reason: string } | null {
  const poseArtifacts = input.poseArtifacts ?? [];
  if (
    poseArtifacts.length < 2 ||
    poseArtifacts.some(
      (artifact) =>
        artifact.status === "missing_pose_frames" ||
        artifact.quality.detectedFrameCount === 0,
    )
  ) {
    return {
      status: "missing_pose_frames",
      reason: "At least two per-camera pose artifacts with detected 2D keypoints are required.",
    };
  }
  if (!input.syncReport || input.syncReport.status === "failed") {
    return {
      status: "missing_sync",
      reason: "A valid multi-view sync report is required.",
    };
  }
  if (!input.syncReport.matchedFrames.length) {
    return {
      status: "missing_sync",
      reason: "Sync report contains no matched frames.",
    };
  }
  const calibration = input.cameraCalibration;
  if (
    !calibration ||
    calibration.status === "missing_calibration" ||
    calibration.status === "invalid_calibration" ||
    calibration.status === "failed" ||
    calibration.devices.length < 2
  ) {
    return {
      status: "missing_calibration",
      reason: "At least two valid camera calibrations are required.",
    };
  }
  if (
    calibration.status &&
    calibration.status !== "ready" &&
    !options.allowDiagnosticApproximateCalibration
  ) {
    return {
      status: "missing_calibration",
      reason: "Diagnostic or approximate calibration is not allowed for this joint track.",
    };
  }
  return null;
}

function buildContext(input: BuildTriangulatedJointTrackInput): BuildContext | null {
  const poseArtifacts = [...(input.poseArtifacts ?? [])].sort(
    (left, right) => left.deviceIndex - right.deviceIndex,
  );
  const pose0 = poseArtifacts[0];
  const pose1 = poseArtifacts[1];
  if (!pose0 || !pose1 || !input.cameraCalibration) return null;
  const projection0 = input.cameraCalibration.devices.find(
    (device) => device.deviceIndex === pose0.deviceIndex,
  );
  const projection1 = input.cameraCalibration.devices.find(
    (device) => device.deviceIndex === pose1.deviceIndex,
  );
  if (!projection0?.projection && !projection0?.projectionMatrixP) return null;
  if (!projection1?.projection && !projection1?.projectionMatrixP) return null;
  return { pose0, pose1, projection0, projection1 };
}

function buildTrackFrame(input: {
  matchedFrame: MultiViewSyncReport["matchedFrames"][number];
  context: BuildContext;
  options: NormalizedOptions;
}): MutableTrackFrame {
  const observation0 = input.matchedFrame.observations.find(
    (observation) => observation.deviceIndex === input.context.pose0.deviceIndex,
  );
  const observation1 = input.matchedFrame.observations.find(
    (observation) => observation.deviceIndex === input.context.pose1.deviceIndex,
  );
  const frame0 = observation0
    ? frameByIndex(input.context.pose0, observation0.frameIndex)
    : undefined;
  const frame1 = observation1
    ? frameByIndex(input.context.pose1, observation1.frameIndex)
    : undefined;
  const sourceFrameIndices: Record<string, number> = {};
  if (frame0) sourceFrameIndices[input.context.pose0.cameraId] = frame0.frameIndex;
  if (frame1) sourceFrameIndices[input.context.pose1.cameraId] = frame1.frameIndex;

  if (!frame0 || !frame1) {
    return {
      frameIndex: input.matchedFrame.referenceFrameIndex,
      timestampMs: input.matchedFrame.timestampMs,
      sourceFrameIndices,
      status: "insufficient_views",
      joints: [],
      warnings: ["missing_pose_frames"],
    };
  }

  let result: ReturnType<typeof triangulateMatchedFramePair>;
  try {
    result = triangulateMatchedFramePair({
      matchedFrame: input.matchedFrame,
      device0Frame: frame0,
      device1Frame: frame1,
      projectionMatrixPDevice0: projectionMatrix(input.context.projection0),
      projectionMatrixPDevice1: projectionMatrix(input.context.projection1),
      device0CameraId: input.context.pose0.cameraId,
      device1CameraId: input.context.pose1.cameraId,
      minConfidence: input.options.minKeypointConfidence,
      maxReprojectionErrorPx: input.options.maxReprojectionErrorPx,
    });
  } catch (error) {
    return {
      frameIndex: input.matchedFrame.referenceFrameIndex,
      timestampMs: input.matchedFrame.timestampMs,
      sourceFrameIndices,
      status: "insufficient_views",
      joints: [],
      warnings: [
        error instanceof Error ? `triangulation_failed:${error.message}` : "triangulation_failed",
      ],
    };
  }
  const joints: MutableTrackJoint[] = [
    ...result.landmarks.map((landmark): MutableTrackJoint => ({
      jointId: landmark.jointId,
      ...(landmark.name ? { name: landmark.name } : {}),
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      rawX: landmark.x,
      rawY: landmark.y,
      rawZ: landmark.z,
      confidence: landmark.confidence,
      sourceCameraIds: [...landmark.sourceCameraIds],
      reprojectionErrorPx: landmark.reprojectionErrorPx,
      status: "tracked",
      warnings: [...landmark.warnings],
    })),
    ...result.rejectedLandmarks.map((landmark): MutableTrackJoint => ({
      jointId: landmark.jointId,
      ...(landmark.name ? { name: landmark.name } : {}),
      confidence: landmark.confidence,
      sourceCameraIds: [...landmark.sourceCameraIds],
      reprojectionErrorPx: landmark.reprojectionErrorPx,
      status: rejectedStatus(landmark.status, landmark.sourceCameraIds.length),
      reason: landmark.reason,
      warnings: [...landmark.warnings],
    })),
  ].sort((left, right) => left.jointId.localeCompare(right.jointId));
  const warnings = Array.from(
    new Set(result.warnings.map((warning) => warning.code)),
  );

  return {
    frameIndex: input.matchedFrame.referenceFrameIndex,
    timestampMs: input.matchedFrame.timestampMs,
    sourceFrameIndices,
    status: frameStatus(joints),
    joints,
    warnings,
  };
}

function interpolateOcclusions(input: {
  frames: readonly MutableTrackFrame[];
  options: NormalizedOptions;
}): MutableTrackFrame[] {
  const frames = cloneFrames(input.frames);
  const jointIds = allJointIds(frames);
  const maxGap = Math.max(1, Math.floor(input.options.smoothingWindowFrames));
  for (const jointId of jointIds) {
    for (let index = 0; index < frames.length; index++) {
      const joint = jointById(frames[index], jointId);
      if (!joint || has3d(joint)) continue;
      if (joint.status !== "occluded" && joint.status !== "insufficient_views") continue;
      const previous = nearestValidJoint(frames, jointId, index, -1);
      const next = nearestValidJoint(frames, jointId, index, 1);
      if (!previous || !next) continue;
      if (index - previous.index > maxGap || next.index - index > maxGap) continue;
      const alpha =
        (frames[index].timestampMs - frames[previous.index].timestampMs) /
        Math.max(1, frames[next.index].timestampMs - frames[previous.index].timestampMs);
      const interpolated: Vector3 = [
        lerp(previous.point[0], next.point[0], alpha),
        lerp(previous.point[1], next.point[1], alpha),
        lerp(previous.point[2], next.point[2], alpha),
      ];
      const jump = Math.max(
        distance(previous.point, interpolated),
        distance(interpolated, next.point),
      );
      if (jump > input.options.maxTemporalJumpMeters) continue;
      joint.x = interpolated[0];
      joint.y = interpolated[1];
      joint.z = interpolated[2];
      joint.confidence = Math.min(previous.confidence, next.confidence) * 0.5;
      joint.status = "interpolated";
      joint.reason = "Short occlusion gap was interpolated from neighboring 3D joints.";
      joint.warnings = Array.from(new Set([...joint.warnings, "occlusion_interpolated"]));
      frames[index].warnings = Array.from(
        new Set([...frames[index].warnings, "occlusion_interpolated"]),
      );
    }
  }
  return frames;
}

function smoothFrames(input: {
  frames: readonly MutableTrackFrame[];
  options: NormalizedOptions;
}): MutableTrackFrame[] {
  const frames = cloneFrames(input.frames);
  const jointIds = allJointIds(frames);
  const radius = Math.floor(Math.max(1, input.options.smoothingWindowFrames) / 2);
  if (radius === 0) return frames;

  for (const jointId of jointIds) {
    for (let index = 0; index < frames.length; index++) {
      const joint = jointById(frames[index], jointId);
      if (!joint || !has3d(joint) || joint.status === "interpolated") continue;
      const samples: Array<{ point: Vector3; weight: number }> = [];
      for (
        let sampleIndex = Math.max(0, index - radius);
        sampleIndex <= Math.min(frames.length - 1, index + radius);
        sampleIndex++
      ) {
        const sample = jointById(frames[sampleIndex], jointId);
        if (!sample || !has3d(sample)) continue;
        samples.push({
          point: [
            sample.rawX ?? sample.x ?? 0,
            sample.rawY ?? sample.y ?? 0,
            sample.rawZ ?? sample.z ?? 0,
          ],
          weight: smoothingWeight(sample),
        });
      }
      if (samples.length < 2) continue;
      const smoothed = weightedAverage(samples);
      if (distance([joint.x ?? 0, joint.y ?? 0, joint.z ?? 0], smoothed) < 1e-9) {
        continue;
      }
      joint.x = smoothed[0];
      joint.y = smoothed[1];
      joint.z = smoothed[2];
      if (joint.status === "tracked") {
        joint.status = "smoothed";
      }
      joint.warnings = Array.from(new Set([...joint.warnings, "temporal_smoothed"]));
    }
  }
  return frames;
}

function buildMetrics(input: {
  matchedFrameCount: number;
  frames: readonly MutableTrackFrame[];
  temporalJitterBefore?: number;
  temporalJitterAfter?: number;
}): TriangulatedJointTrackArtifact["metrics"] {
  const counters: Counters = {
    totalJointSlots: 0,
    trackedJointCount: 0,
    lowConfidenceJointCount: 0,
    occludedJointCount: 0,
    highReprojectionJointCount: 0,
    smoothedJointCount: 0,
    interpolatedJointCount: 0,
    droppedJointCount: 0,
    reprojectionErrors: [],
    confidences: [],
  };
  for (const frame of input.frames) {
    for (const joint of frame.joints) {
      counters.totalJointSlots += 1;
      if (has3d(joint)) counters.trackedJointCount += 1;
      if (joint.status === "low_confidence") counters.lowConfidenceJointCount += 1;
      if (joint.status === "occluded" || joint.status === "insufficient_views") {
        counters.occludedJointCount += 1;
      }
      if (joint.status === "high_reprojection_error") {
        counters.highReprojectionJointCount += 1;
      }
      if (joint.status === "smoothed") counters.smoothedJointCount += 1;
      if (joint.status === "interpolated") counters.interpolatedJointCount += 1;
      if (joint.status === "dropped") counters.droppedJointCount += 1;
      if (
        joint.status === "high_reprojection_error" ||
        joint.status === "low_confidence" ||
        joint.status === "occluded" ||
        joint.status === "insufficient_views"
      ) {
        counters.droppedJointCount += 1;
      }
      if (Number.isFinite(joint.reprojectionErrorPx) && has3d(joint)) {
        counters.reprojectionErrors.push(joint.reprojectionErrorPx ?? 0);
      }
      if (Number.isFinite(joint.confidence)) {
        counters.confidences.push(joint.confidence ?? 0);
      }
    }
  }
  const ratio = (value: number) =>
    counters.totalJointSlots > 0 ? value / counters.totalJointSlots : undefined;
  const temporalSmoothingGain =
    input.temporalJitterBefore !== undefined &&
    input.temporalJitterAfter !== undefined &&
    input.temporalJitterBefore > 0
      ? Math.max(
          0,
          (input.temporalJitterBefore - input.temporalJitterAfter) /
            input.temporalJitterBefore,
        )
      : undefined;

  return {
    matchedFrameCount: input.matchedFrameCount,
    ...(ratio(counters.trackedJointCount) !== undefined
      ? { triangulatedJointRatio: ratio(counters.trackedJointCount) }
      : {}),
    ...(counters.reprojectionErrors.length
      ? {
          averageReprojectionErrorPx: average(counters.reprojectionErrors),
          reprojectionP95Px: percentile(counters.reprojectionErrors, 0.95),
        }
      : {}),
    ...(counters.confidences.length
      ? { averageJointConfidence: average(counters.confidences) }
      : {}),
    ...(ratio(counters.lowConfidenceJointCount) !== undefined
      ? { lowConfidenceJointRatio: ratio(counters.lowConfidenceJointCount) }
      : {}),
    ...(ratio(counters.occludedJointCount) !== undefined
      ? { occludedJointRatio: ratio(counters.occludedJointCount) }
      : {}),
    ...(ratio(counters.smoothedJointCount) !== undefined
      ? { smoothedJointRatio: ratio(counters.smoothedJointCount) }
      : {}),
    ...(ratio(counters.interpolatedJointCount) !== undefined
      ? { interpolatedJointRatio: ratio(counters.interpolatedJointCount) }
      : {}),
    ...(ratio(counters.droppedJointCount) !== undefined
      ? { droppedJointRatio: ratio(counters.droppedJointCount) }
      : {}),
    ...(input.temporalJitterBefore !== undefined
      ? { temporalJitterBefore: input.temporalJitterBefore }
      : {}),
    ...(input.temporalJitterAfter !== undefined
      ? { temporalJitterAfter: input.temporalJitterAfter }
      : {}),
    ...(temporalSmoothingGain !== undefined
      ? { temporalSmoothingGain }
      : {}),
  };
}

function resolveArtifactStatus(input: {
  frames: readonly MutableTrackFrame[];
  metrics: TriangulatedJointTrackArtifact["metrics"];
  warnings: ReadonlySet<string>;
  options: NormalizedOptions;
}): TriangulatedJointTrackStatus {
  const joints = input.frames.flatMap((frame) => frame.joints);
  if (!joints.length) return "insufficient_views";
  if (joints.every((joint) => joint.status === "low_confidence")) return "low_confidence";
  if (joints.every((joint) => joint.status === "high_reprojection_error")) {
    return "high_reprojection_error";
  }
  if (!joints.some(has3d)) return "insufficient_views";
  if (
    input.metrics.triangulatedJointRatio !== undefined &&
    input.metrics.triangulatedJointRatio < input.options.minTriangulatedJointRatio
  ) {
    return "diagnostic_only";
  }
  if (input.warnings.size > 0) return "diagnostic_only";
  return "ready";
}

function buildBlockedArtifact(input: {
  input: BuildTriangulatedJointTrackInput;
  status: TriangulatedJointTrackStatus;
  reason: string;
}): TriangulatedJointTrackArtifact {
  return {
    schema: "mocap.triangulated_joint_track.v1",
    takeId: input.input.takeId,
    jobId: input.input.jobId,
    source: input.input.source,
    status: input.status,
    reason: input.reason,
    coordinateSystem: "right_handed_y_up",
    jointSet: inferJointSet(input.input.poseArtifacts ?? []),
    cameraIds: (input.input.poseArtifacts ?? []).map((artifact) => artifact.cameraId),
    frameCount: 0,
    trackedFrameCount: 0,
    metrics: {
      matchedFrameCount: input.input.syncReport?.metrics.matchedFrameCount ?? 0,
    },
    frames: [],
    warnings: [input.status],
  };
}

function normalizeOptions(
  options: TriangulatedJointTrackOptions | undefined,
): NormalizedOptions {
  return {
    minKeypointConfidence:
      options?.minKeypointConfidence ?? DEFAULT_MIN_KEYPOINT_CONFIDENCE,
    maxReprojectionErrorPx:
      options?.maxReprojectionErrorPx ?? DEFAULT_MAX_REPROJECTION_ERROR_PX,
    maxTemporalJumpMeters:
      options?.maxTemporalJumpMeters ?? DEFAULT_MAX_TEMPORAL_JUMP_METERS,
    smoothingWindowFrames:
      options?.smoothingWindowFrames ?? DEFAULT_SMOOTHING_WINDOW_FRAMES,
    minTriangulatedJointRatio:
      options?.minTriangulatedJointRatio ?? DEFAULT_MIN_TRIANGULATED_JOINT_RATIO,
    allowDiagnosticApproximateCalibration:
      options?.allowDiagnosticApproximateCalibration ?? true,
  };
}

function frameByIndex(
  artifact: PerCameraPoseArtifact,
  frameIndex: number,
): PerCameraPoseFrame | undefined {
  return artifact.frames.find((frame) => frame.frameIndex === frameIndex);
}

function projectionMatrix(projection: CameraProjection): ProjectionMatrix3x4 {
  return projection.projectionMatrixP ?? projection.projection;
}

function rejectedStatus(
  status: string,
  sourceCameraCount: number,
): TriangulatedJointTrackJointStatus {
  if (status === "low_confidence") return "low_confidence";
  if (status === "high_reprojection_error") return "high_reprojection_error";
  if (status === "missing_observations") {
    return sourceCameraCount === 1 ? "occluded" : "insufficient_views";
  }
  return "dropped";
}

function frameStatus(
  joints: readonly MutableTrackJoint[],
): TriangulatedJointTrackFrameStatus {
  if (joints.some(has3d)) {
    return joints.some((joint) => joint.status !== "tracked" && joint.status !== "smoothed")
      ? "diagnostic_only"
      : "ready";
  }
  if (joints.some((joint) => joint.status === "high_reprojection_error")) {
    return "high_reprojection_error";
  }
  if (joints.some((joint) => joint.status === "low_confidence")) {
    return "low_confidence";
  }
  return "insufficient_views";
}

function refreshFrameStatuses(
  frames: readonly MutableTrackFrame[],
): MutableTrackFrame[] {
  return frames.map((frame) => ({
    ...frame,
    status: frameStatus(frame.joints),
  }));
}

function cloneFrames(frames: readonly MutableTrackFrame[]): MutableTrackFrame[] {
  return frames.map((frame) => ({
    ...frame,
    sourceFrameIndices: { ...frame.sourceFrameIndices },
    joints: frame.joints.map((joint) => ({
      ...joint,
      sourceCameraIds: [...joint.sourceCameraIds],
      warnings: [...joint.warnings],
    })),
    warnings: [...frame.warnings],
  }));
}

function readonlyFrame(frame: MutableTrackFrame): TriangulatedJointTrackFrame {
  return {
    ...frame,
    joints: frame.joints.map((joint): TriangulatedJointTrackJoint => ({ ...joint })),
  };
}

function allJointIds(frames: readonly MutableTrackFrame[]) {
  return Array.from(
    new Set(frames.flatMap((frame) => frame.joints.map((joint) => joint.jointId))),
  ).sort();
}

function jointById(
  frame: MutableTrackFrame,
  jointId: string,
): MutableTrackJoint | undefined {
  return frame.joints.find((joint) => joint.jointId === jointId);
}

function has3d(joint: Pick<MutableTrackJoint, "x" | "y" | "z">): boolean {
  return (
    Number.isFinite(joint.x) &&
    Number.isFinite(joint.y) &&
    Number.isFinite(joint.z)
  );
}

function nearestValidJoint(
  frames: readonly MutableTrackFrame[],
  jointId: string,
  startIndex: number,
  direction: -1 | 1,
): { index: number; point: Vector3; confidence: number } | null {
  for (
    let index = startIndex + direction;
    index >= 0 && index < frames.length;
    index += direction
  ) {
    const joint = jointById(frames[index], jointId);
    if (!joint || !has3d(joint)) continue;
    return {
      index,
      point: [joint.x ?? 0, joint.y ?? 0, joint.z ?? 0],
      confidence: joint.confidence ?? 0,
    };
  }
  return null;
}

function smoothingWeight(joint: MutableTrackJoint) {
  const confidence = Math.max(0.05, joint.confidence ?? 0.5);
  const reprojectionPenalty = 1 / (1 + Math.max(0, joint.reprojectionErrorPx ?? 0));
  return confidence * reprojectionPenalty;
}

function weightedAverage(samples: readonly { point: Vector3; weight: number }[]): Vector3 {
  const weightSum = samples.reduce((sum, sample) => sum + sample.weight, 0);
  if (weightSum <= 0) return samples[0]?.point ?? [0, 0, 0];
  return [
    samples.reduce((sum, sample) => sum + sample.point[0] * sample.weight, 0) /
      weightSum,
    samples.reduce((sum, sample) => sum + sample.point[1] * sample.weight, 0) /
      weightSum,
    samples.reduce((sum, sample) => sum + sample.point[2] * sample.weight, 0) /
      weightSum,
  ];
}

function computeTemporalJitter(
  frames: readonly MutableTrackFrame[],
  mode: "raw" | "smoothed",
): number | undefined {
  const distances: number[] = [];
  for (const jointId of allJointIds(frames)) {
    let previous: Vector3 | undefined;
    for (const frame of frames) {
      const joint = jointById(frame, jointId);
      if (!joint || !has3d(joint)) continue;
      const point: Vector3 =
        mode === "raw"
          ? [
              joint.rawX ?? joint.x ?? 0,
              joint.rawY ?? joint.y ?? 0,
              joint.rawZ ?? joint.z ?? 0,
            ]
          : [joint.x ?? 0, joint.y ?? 0, joint.z ?? 0];
      if (previous) distances.push(distance(previous, point));
      previous = point;
    }
  }
  return distances.length ? average(distances) : undefined;
}

function inferJointSet(
  artifacts: readonly PerCameraPoseArtifact[],
): TriangulatedJointTrackArtifact["jointSet"] {
  const schema = artifacts[0]?.detector.landmarkSchema;
  if (schema === "body_33") return "body33";
  if (schema === "wham_internal") return "smpl_compatible";
  const firstKeypoints = artifacts[0]?.frames[0]?.keypoints ?? [];
  const cocoNames = new Set([
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
  ]);
  if (
    firstKeypoints.length > 0 &&
    firstKeypoints.every((keypoint) => cocoNames.has(keypoint.jointId))
  ) {
    return "coco17";
  }
  return "custom";
}

function reasonForStatus(
  status: TriangulatedJointTrackStatus,
  metrics: TriangulatedJointTrackArtifact["metrics"],
) {
  if (status === "diagnostic_only") {
    return `Triangulated joint coverage is diagnostic (${metrics.triangulatedJointRatio ?? 0}).`;
  }
  if (status === "low_confidence") {
    return "All candidate joints were below the confidence threshold.";
  }
  if (status === "high_reprojection_error") {
    return "All candidate joints exceeded the reprojection error threshold.";
  }
  if (status === "insufficient_views") {
    return "No joints had two valid camera observations.";
  }
  return status;
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values: readonly number[], percentileValue: number) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index];
}

function distance(left: Vector3, right: Vector3) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function lerp(left: number, right: number, alpha: number) {
  return left + (right - left) * alpha;
}
