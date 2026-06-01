import type {
  CameraCalibrationArtifact,
  CameraProjection,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  PerCameraPoseFrame,
  PoseFramesArtifact,
  PoseLandmark,
  ProjectionMatrix3x4,
} from "../types";
import {
  type RejectedTriangulatedLandmark,
  type TriangulatedLandmark,
  triangulateMatchedFramePair,
} from "./triangulation";
import { multiViewArtifactStorageKey, poseArtifactStorageKey } from "./multiViewArtifacts";

export type DualReconstructionStatus =
  | "ready"
  | "diagnostic_only"
  | "missing_calibration"
  | "missing_pose_frames"
  | "missing_sync"
  | "insufficient_views"
  | "failed";

export type DualReconstructionFrame = {
  frameIndex: number;
  timestampMs: number;
  sourceFrameIndices: Record<string, number>;
  landmarks3D: readonly TriangulatedLandmark[];
  rejectedLandmarks: readonly RejectedTriangulatedLandmark[];
  frameReprojectionErrorPx: number;
  status: DualReconstructionStatus;
  warnings: readonly string[];
};

export type DualReconstructionArtifact = {
  schema: "mocap.dual_reconstruction.v1";
  sessionId: string;
  takeId: string;
  jobId: string;
  cameraIds: readonly string[];
  deviceIds: readonly string[];
  frameCount: number;
  matchedFrameCount: number;
  triangulatedFrameCount: number;
  landmarksPerFrame: number;
  averageReprojectionErrorPx: number;
  reprojectionP95Px: number;
  triangulatedLandmarkRatio: number;
  fallbackLandmarkRatio: number;
  calibrationQualityScore: number;
  syncConfidence: number;
  status: DualReconstructionStatus;
  warnings: readonly string[];
  frames: readonly DualReconstructionFrame[];
};

export type MultiViewReconstructionSummaryArtifact = {
  schema: "mocap.multi_view_reconstruction_summary.v1";
  takeId: string;
  jobId: string;
  reconstructionMode: "dual_camera";
  reconstructionSource: "triangulated_2d_keypoints";
  status: DualReconstructionStatus;
  calibrationSummary: {
    status: string;
    cameraCount: number;
    validCameraCount: number;
    calibrationQualityScore: number;
    warnings: readonly string[];
  };
  syncSummary: {
    status: string;
    syncMethod: string;
    matchedFrameCount: number;
    syncConfidence: number;
    warnings: readonly string[];
  };
  triangulationSummary: {
    frameCount: number;
    triangulatedFrameCount: number;
    landmarksPerFrame: number;
    triangulatedLandmarkRatio: number;
    averageReprojectionErrorPx: number;
    reprojectionP95Px: number;
    warnings: readonly string[];
  };
  qualitySummary: {
    status: DualReconstructionStatus;
    calibrationQualityScore: number;
    syncConfidence: number;
    triangulatedLandmarkRatio: number;
    warnings: readonly string[];
  };
  artifactRefs: Record<string, string>;
};

export type BuildDualReconstructionArtifactsInput = {
  takeId: string;
  jobId: string;
  poseArtifacts: readonly PerCameraPoseArtifact[];
  syncReport: MultiViewSyncReport;
  calibrationArtifact: CameraCalibrationArtifact;
  artifactRefs?: Record<string, string>;
  minConfidence?: number;
  maxReprojectionErrorPx?: number;
  coverageWarningThreshold?: number;
};

export type BuildDualReconstructionArtifactsResult = {
  dualReconstruction: DualReconstructionArtifact;
  multiViewReconstruction: MultiViewReconstructionSummaryArtifact;
  diagnosticPoseFrames?: PoseFramesArtifact;
};

type BuildContext =
  | {
      ok: true;
      pose0: PerCameraPoseArtifact;
      pose1: PerCameraPoseArtifact;
      projection0: CameraProjection;
      projection1: CameraProjection;
    }
  | {
      ok: false;
      status: DualReconstructionStatus;
      warnings: string[];
    };

export function buildDualReconstructionArtifacts(
  input: BuildDualReconstructionArtifactsInput,
): BuildDualReconstructionArtifactsResult {
  const context = buildContext(input);
  const dualReconstruction = context.ok
    ? buildReadyDualReconstruction({ input, context })
    : buildBlockedDualReconstruction({ input, context });
  const artifactRefs = {
    ...defaultArtifactRefs({
      takeId: input.takeId,
      jobId: input.jobId,
      poseArtifacts: input.poseArtifacts,
    }),
    ...(input.artifactRefs ?? {}),
  };

  return {
    dualReconstruction,
    multiViewReconstruction: buildMultiViewReconstructionSummary({
      input,
      dualReconstruction,
      artifactRefs,
    }),
    diagnosticPoseFrames:
      dualReconstruction.frames.length > 0
        ? buildDiagnosticPoseFrames({
            dualReconstruction,
            referencePoseArtifact: context.ok ? context.pose0 : input.poseArtifacts[0],
          })
        : undefined,
  };
}

function buildReadyDualReconstruction(input: {
  input: BuildDualReconstructionArtifactsInput;
  context: Extract<BuildContext, { ok: true }>;
}): DualReconstructionArtifact {
  const warnings = new Set<string>(
    diagnosticWarnings({
      syncReport: input.input.syncReport,
      calibrationArtifact: input.input.calibrationArtifact,
    }),
  );
  const frameResults = input.input.syncReport.matchedFrames.map((matchedFrame) => {
    const observation0 = matchedFrame.observations.find(
      (observation) => observation.deviceIndex === input.context.pose0.deviceIndex,
    );
    const observation1 = matchedFrame.observations.find(
      (observation) => observation.deviceIndex === input.context.pose1.deviceIndex,
    );
    const frame0 = observation0
      ? frameByIndex(input.context.pose0, observation0.frameIndex)
      : undefined;
    const frame1 = observation1
      ? frameByIndex(input.context.pose1, observation1.frameIndex)
      : undefined;

    if (!observation0 || !observation1 || !frame0 || !frame1) {
      warnings.add("missing_pose_frames");
      return buildMissingFrame({
        matchedFrame,
      });
    }

    const result = triangulateMatchedFramePair({
      matchedFrame,
      device0Frame: frame0,
      device1Frame: frame1,
      device0CameraId: input.context.pose0.cameraId,
      device1CameraId: input.context.pose1.cameraId,
      projectionMatrixPDevice0: projectionMatrix(input.context.projection0),
      projectionMatrixPDevice1: projectionMatrix(input.context.projection1),
      minConfidence: input.input.minConfidence,
      maxReprojectionErrorPx: input.input.maxReprojectionErrorPx,
    });
    for (const warning of result.warnings) warnings.add(warning.code);

    return {
      frameIndex: matchedFrame.referenceFrameIndex,
      timestampMs: matchedFrame.timestampMs,
      sourceFrameIndices: {
        [input.context.pose0.cameraId]: frame0.frameIndex,
        [input.context.pose1.cameraId]: frame1.frameIndex,
      },
      landmarks3D: result.landmarks,
      rejectedLandmarks: result.rejectedLandmarks,
      frameReprojectionErrorPx:
        result.metrics.averageReprojectionErrorPx ?? 0,
      status: normalizeFrameStatus(result.status),
      warnings: result.warnings.map((warning) => warning.code),
    };
  });

  const metrics = aggregateFrameMetrics(frameResults);
  if (
    metrics.triangulatedLandmarkRatio <
    (input.input.coverageWarningThreshold ?? 0.5)
  ) {
    warnings.add("triangulation_coverage_low");
  }
  const status = statusForMetrics({
    frames: frameResults,
    warnings,
    calibrationArtifact: input.input.calibrationArtifact,
    syncReport: input.input.syncReport,
  });

  return {
    schema: "mocap.dual_reconstruction.v1",
    sessionId: input.input.takeId,
    takeId: input.input.takeId,
    jobId: input.input.jobId,
    cameraIds: [input.context.pose0.cameraId, input.context.pose1.cameraId],
    deviceIds: deviceIds(input.input.calibrationArtifact),
    frameCount: frameResults.length,
    matchedFrameCount: input.input.syncReport.metrics.matchedFrameCount,
    triangulatedFrameCount: frameResults.filter(
      (frame) => frame.landmarks3D.length > 0,
    ).length,
    landmarksPerFrame: metrics.landmarksPerFrame,
    averageReprojectionErrorPx: metrics.averageReprojectionErrorPx,
    reprojectionP95Px: metrics.reprojectionP95Px,
    triangulatedLandmarkRatio: metrics.triangulatedLandmarkRatio,
    fallbackLandmarkRatio: 0,
    calibrationQualityScore: input.input.calibrationArtifact.quality.score,
    syncConfidence: input.input.syncReport.metrics.syncConfidence,
    status,
    warnings: Array.from(warnings),
    frames: frameResults,
  };
}

function buildBlockedDualReconstruction(input: {
  input: BuildDualReconstructionArtifactsInput;
  context: Extract<BuildContext, { ok: false }>;
}): DualReconstructionArtifact {
  return {
    schema: "mocap.dual_reconstruction.v1",
    sessionId: input.input.takeId,
    takeId: input.input.takeId,
    jobId: input.input.jobId,
    cameraIds: input.input.poseArtifacts.map((artifact) => artifact.cameraId),
    deviceIds: deviceIds(input.input.calibrationArtifact),
    frameCount: 0,
    matchedFrameCount: input.input.syncReport.metrics.matchedFrameCount,
    triangulatedFrameCount: 0,
    landmarksPerFrame: 0,
    averageReprojectionErrorPx: 0,
    reprojectionP95Px: 0,
    triangulatedLandmarkRatio: 0,
    fallbackLandmarkRatio: 0,
    calibrationQualityScore: input.input.calibrationArtifact.quality.score,
    syncConfidence: input.input.syncReport.metrics.syncConfidence,
    status: input.context.status,
    warnings: input.context.warnings,
    frames: [],
  };
}

function buildMultiViewReconstructionSummary(input: {
  input: BuildDualReconstructionArtifactsInput;
  dualReconstruction: DualReconstructionArtifact;
  artifactRefs: Record<string, string>;
}): MultiViewReconstructionSummaryArtifact {
  const calibrationWarnings = input.input.calibrationArtifact.warnings.map(String);
  const syncWarnings = input.input.syncReport.warnings.map(String);
  const triangulationWarnings = input.dualReconstruction.warnings.filter(
    (warning) => !calibrationWarnings.includes(warning) && !syncWarnings.includes(warning),
  );

  return {
    schema: "mocap.multi_view_reconstruction_summary.v1",
    takeId: input.input.takeId,
    jobId: input.input.jobId,
    reconstructionMode: "dual_camera",
    reconstructionSource: "triangulated_2d_keypoints",
    status: input.dualReconstruction.status,
    calibrationSummary: {
      status: input.input.calibrationArtifact.status ?? "ready",
      cameraCount: input.input.calibrationArtifact.devices.length,
      validCameraCount: input.input.calibrationArtifact.devices.filter(
        (device) => Boolean(device.projectionMatrixP ?? device.projection),
      ).length,
      calibrationQualityScore: input.input.calibrationArtifact.quality.score,
      warnings: calibrationWarnings,
    },
    syncSummary: {
      status: input.input.syncReport.status,
      syncMethod: input.input.syncReport.syncMethod,
      matchedFrameCount: input.input.syncReport.metrics.matchedFrameCount,
      syncConfidence: input.input.syncReport.metrics.syncConfidence,
      warnings: syncWarnings,
    },
    triangulationSummary: {
      frameCount: input.dualReconstruction.frameCount,
      triangulatedFrameCount: input.dualReconstruction.triangulatedFrameCount,
      landmarksPerFrame: input.dualReconstruction.landmarksPerFrame,
      triangulatedLandmarkRatio:
        input.dualReconstruction.triangulatedLandmarkRatio,
      averageReprojectionErrorPx:
        input.dualReconstruction.averageReprojectionErrorPx,
      reprojectionP95Px: input.dualReconstruction.reprojectionP95Px,
      warnings: triangulationWarnings,
    },
    qualitySummary: {
      status: input.dualReconstruction.status,
      calibrationQualityScore: input.dualReconstruction.calibrationQualityScore,
      syncConfidence: input.dualReconstruction.syncConfidence,
      triangulatedLandmarkRatio:
        input.dualReconstruction.triangulatedLandmarkRatio,
      warnings: input.dualReconstruction.warnings,
    },
    artifactRefs: input.artifactRefs,
  };
}

function buildDiagnosticPoseFrames(input: {
  dualReconstruction: DualReconstructionArtifact;
  referencePoseArtifact?: PerCameraPoseArtifact;
}): PoseFramesArtifact {
  const frames = input.dualReconstruction.frames.map((frame) => {
    const worldLandmarks: PoseLandmark[] = frame.landmarks3D.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.confidence,
      presence: landmark.confidence,
    }));
    return {
      frameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
      landmarks: [],
      worldLandmarks,
      landmarkSchema: "custom" as const,
      poseConfidence: average(frame.landmarks3D.map((landmark) => landmark.confidence)),
      detectorVersion: "diagnostic_v1",
    };
  });

  return {
    schema: "mocap.pose_frames.v1",
    takeId: input.dualReconstruction.takeId,
    jobId: input.dualReconstruction.jobId,
    sourceVideo: input.referencePoseArtifact?.sourceVideo ?? {
      storageKey: "",
      fps: 0,
      width: 0,
      height: 0,
      durationMs: 0,
    },
    detector: {
      name: "backend_multiview_triangulation",
      version: "diagnostic_v1",
      landmarkSchema: "custom",
    },
    frames,
    quality: {
      frameCount: frames.length,
      detectedFrameCount: frames.filter((frame) => frame.worldLandmarks?.length).length,
      lowConfidenceFrameCount: frames.filter((frame) => frame.poseConfidence < 0.4)
        .length,
      averagePoseConfidence: average(frames.map((frame) => frame.poseConfidence)),
    },
  };
}

function buildContext(input: BuildDualReconstructionArtifactsInput): BuildContext {
  const pose0 = input.poseArtifacts.find((artifact) => artifact.deviceIndex === 0);
  const pose1 = input.poseArtifacts.find((artifact) => artifact.deviceIndex === 1);
  if (!pose0 || !pose1) {
    return {
      ok: false,
      status: "missing_pose_frames",
      warnings: ["missing_pose_frames"],
    };
  }
  if (
    pose0.status === "missing_pose_frames" ||
    pose1.status === "missing_pose_frames" ||
    pose0.frames.length === 0 ||
    pose1.frames.length === 0
  ) {
    return {
      ok: false,
      status: "missing_pose_frames",
      warnings: ["missing_pose_frames", ...pose0.warnings, ...pose1.warnings],
    };
  }
  if (
    input.calibrationArtifact.status === "missing_calibration" ||
    input.calibrationArtifact.status === "invalid_calibration" ||
    input.calibrationArtifact.devices.length < 2
  ) {
    return {
      ok: false,
      status: "missing_calibration",
      warnings: [
        "missing_calibration",
        ...input.calibrationArtifact.warnings.map(String),
      ],
    };
  }
  const projection0 = input.calibrationArtifact.devices.find(
    (device) => device.deviceIndex === pose0.deviceIndex,
  );
  const projection1 = input.calibrationArtifact.devices.find(
    (device) => device.deviceIndex === pose1.deviceIndex,
  );
  if (!projection0 || !projection1) {
    return {
      ok: false,
      status: "missing_calibration",
      warnings: ["missing_calibration"],
    };
  }
  if (input.syncReport.matchedFrames.length === 0) {
    return {
      ok: false,
      status: "missing_sync",
      warnings: ["missing_sync", ...input.syncReport.warnings.map(String)],
    };
  }
  return { ok: true, pose0, pose1, projection0, projection1 };
}

function diagnosticWarnings(input: {
  syncReport: MultiViewSyncReport;
  calibrationArtifact: CameraCalibrationArtifact;
}) {
  const warnings = new Set<string>([
    ...input.syncReport.warnings.map(String),
    ...input.calibrationArtifact.warnings.map(String),
  ]);
  if (input.syncReport.status !== "ready") {
    warnings.add(`sync_${input.syncReport.status}`);
  }
  if (
    input.calibrationArtifact.status &&
    input.calibrationArtifact.status !== "ready"
  ) {
    warnings.add(`calibration_${input.calibrationArtifact.status}`);
  }
  return Array.from(warnings);
}

function buildMissingFrame(input: {
  matchedFrame: MultiViewSyncReport["matchedFrames"][number];
}): DualReconstructionFrame {
  return {
    frameIndex: input.matchedFrame.referenceFrameIndex,
    timestampMs: input.matchedFrame.timestampMs,
    sourceFrameIndices: {},
    landmarks3D: [],
    rejectedLandmarks: [],
    frameReprojectionErrorPx: 0,
    status: "missing_pose_frames",
    warnings: ["missing_pose_frames"],
  };
}

function frameByIndex(
  artifact: PerCameraPoseArtifact,
  frameIndex: number,
): PerCameraPoseFrame | undefined {
  return artifact.frames.find((frame) => frame.frameIndex === frameIndex);
}

function projectionMatrix(camera: CameraProjection): ProjectionMatrix3x4 {
  return camera.projectionMatrixP ?? camera.projection;
}

function aggregateFrameMetrics(frames: readonly DualReconstructionFrame[]) {
  const errors = frames.flatMap((frame) =>
    frame.landmarks3D.map((landmark) => landmark.reprojectionErrorPx),
  );
  const totalJoints = frames.reduce(
    (sum, frame) => sum + frame.landmarks3D.length + frame.rejectedLandmarks.length,
    0,
  );
  const triangulatedJoints = frames.reduce(
    (sum, frame) => sum + frame.landmarks3D.length,
    0,
  );
  return {
    landmarksPerFrame:
      frames.length > 0 ? triangulatedJoints / frames.length : 0,
    averageReprojectionErrorPx: average(errors),
    reprojectionP95Px: percentile(errors, 0.95),
    triangulatedLandmarkRatio:
      totalJoints > 0 ? triangulatedJoints / totalJoints : 0,
  };
}

function statusForMetrics(input: {
  frames: readonly DualReconstructionFrame[];
  warnings: ReadonlySet<string>;
  calibrationArtifact: CameraCalibrationArtifact;
  syncReport: MultiViewSyncReport;
}): DualReconstructionStatus {
  if (input.frames.length === 0) return "insufficient_views";
  if (!input.frames.some((frame) => frame.landmarks3D.length > 0)) {
    return "insufficient_views";
  }
  if (
    input.warnings.size > 0 ||
    input.calibrationArtifact.status !== "ready" ||
    input.syncReport.status !== "ready"
  ) {
    return "diagnostic_only";
  }
  return "ready";
}

function normalizeFrameStatus(status: string): DualReconstructionStatus {
  if (status === "ready") return "ready";
  if (status === "insufficient_views") return "insufficient_views";
  if (status === "degenerate_baseline") return "failed";
  return "diagnostic_only";
}

function deviceIds(calibration: CameraCalibrationArtifact) {
  return calibration.devices.flatMap((device) =>
    device.deviceId ? [device.deviceId] : [],
  );
}

function defaultArtifactRefs(input: {
  takeId: string;
  jobId: string;
  poseArtifacts: readonly PerCameraPoseArtifact[];
}) {
  const refs: Record<string, string> = {
    dual_reconstruction_json: multiViewArtifactStorageKey({
      takeId: input.takeId,
      jobId: input.jobId,
      fileName: "dual_reconstruction.json",
    }),
    multi_view_reconstruction_json: multiViewArtifactStorageKey({
      takeId: input.takeId,
      jobId: input.jobId,
      fileName: "multi_view_reconstruction.json",
    }),
    pose_frames_json: multiViewArtifactStorageKey({
      takeId: input.takeId,
      jobId: input.jobId,
      fileName: "pose_frames.json",
    }),
  };
  for (const artifact of input.poseArtifacts) {
    refs[`pose_frames_device_${artifact.deviceIndex}_json`] = poseArtifactStorageKey({
      takeId: input.takeId,
      jobId: input.jobId,
      deviceIndex: artifact.deviceIndex,
    });
  }
  return refs;
}

function average(values: readonly number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}
