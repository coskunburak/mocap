import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { config } from "../config";
import type { CaptureVideo, ProcessingJob } from "../domain/types";
import type { CalibrationTargetDetectorAdapter } from "./calibration/calibrationDetectorTypes";
import {
  CaptureSessionRepository,
  ExportRepository,
  JobRepository,
  TakeRepository,
  UploadRepository,
} from "../infra/db/repositories";
import { artifactStorageKey, ObjectStorage } from "../infra/storage/objectStorage";
import { cleanupSolvedMotion } from "./cleanup/motionCleanup";
import { writeBvh } from "./export/bvhWriter";
import { runBlenderSmokeTest } from "./export/blenderSmokeTest";
import {
  buildPreviewSummary,
  buildQualityReport,
  type QualityReportMultiViewDiagnosticInput,
  validateBvhText,
  validateSolvedMotion,
} from "./export/exportValidation";
import {
  artifactRefsFromPersistedMultiViewArtifacts,
  buildMotionPipelineStage,
  buildReconstructionDiagnosticStages,
  sortMotionPipelineStages,
} from "./export/motionPipelineStages";
import { runDualCameraFittingOptimization } from "./fitting/dualCameraOptimizer";
import { validateDualFitReportArtifact } from "./fitting/dualFitArtifacts";
import { buildDualFitAcceptanceSummary } from "./fitting/fittingQuality";
import { trySolvePremiumMotion } from "./export/premiumMotionSolver";
import { buildCaptureMetadataDiagnostics } from "./captureMetadataDiagnostics";
import {
  type PersistedMultiViewArtifact,
  persistMultiViewArtifacts,
} from "./reconstruction/multiViewArtifacts";
import type { FrameSyncOptions } from "./reconstruction/frameSync";
import type { CameraIntrinsicsInput } from "./reconstruction/cameraCalibration";
import {
  MultiViewOrchestratorError,
  type MultiViewPoseAdapter,
  resolveWorkerPipelineBranch,
  resolveMultiViewStageFailure,
  runMultiViewReconstruction,
} from "./reconstruction/multiViewOrchestrator";
import { normalizeVideo, probeVideo } from "./video/videoPipeline";
import {
  buildWhamInputUsageMetrics,
  whamFallbackReasonFromMultiViewError,
} from "./whamInputUsage";
import type {
  MotionPipelineReport,
  MotionPipelineStageStatus,
  CalibrationObservationsArtifact,
  CalibrationTargetType,
  DualFitGateFailureCode,
  DualFitReportArtifact,
  DualFitQualityGateSummary,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  SolvedMotionArtifact,
  WhamFallbackReason,
} from "./types";

type Deps = {
  jobs?: JobRepository;
  takes?: TakeRepository;
  captureSessions?: CaptureSessionRepository;
  uploads?: UploadRepository;
  exports?: ExportRepository;
  storage?: ObjectStorage;
  multiViewPoseAdapter?: MultiViewPoseAdapter;
  calibrationTargetDetectorAdapter?: CalibrationTargetDetectorAdapter;
};

type ProcessedSource = {
  video: CaptureVideo;
  inputPath: string;
  normalizedPath: string;
  normalizedKey: string;
  normalizedProbe: Awaited<ReturnType<typeof probeVideo>>;
};

type MultiViewDiagnosticSummary = {
  branch: string;
  reconstructionBranchEntered?: boolean;
  workerRuntime?: {
    nodeEnv: string;
    enableMultiViewReconstruction: boolean;
    allowPrimaryWhamFallback: boolean;
    selectedVideoCount: number;
  };
  reconstructionAvailable: boolean;
  matchedFrameCount?: number;
  triangulatedLandmarkRatio?: number;
  reprojectionErrorPx?: number;
  usedForWhamConstraints: false;
  primaryWhamContinues: boolean;
  fallbackToPrimaryWham?: boolean;
  primaryWhamFallbackReason?: WhamFallbackReason;
  errorCode?: string;
  errorMessage?: string;
};

class WorkerProcessingError extends Error {
  constructor(
    message: string,
    readonly code = "worker_processing_failed",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkerProcessingError";
  }
}

function workerDir(jobId: string) {
  return path.join(config.worker.tempDir, jobId);
}

function captureVideoOrientation(captureMetadata: unknown): string | undefined {
  if (!captureMetadata || typeof captureMetadata !== "object") return undefined;
  const metadata = captureMetadata as Record<string, unknown>;
  const video = metadata.video;
  if (!video || typeof video !== "object") return undefined;
  const orientation = (video as Record<string, unknown>).orientation;
  return typeof orientation === "string" ? orientation : undefined;
}

async function createConfiguredMultiViewPoseAdapter() {
  const { createConfiguredRtmposeMmposePoseAdapter } = await import(
    "./pose/rtmposeMmposeAdapter"
  );
  return createConfiguredRtmposeMmposePoseAdapter();
}

async function createConfiguredCalibrationTargetDetectorAdapter() {
  const { createConfiguredCalibrationTargetDetectorAdapter } = await import(
    "./calibration/aprilTagCheckerboardAdapter"
  );
  return createConfiguredCalibrationTargetDetectorAdapter();
}

async function configuredCalibrationTargetType() {
  const { calibrationDetectorRuntimeConfigFromEnv } = await import(
    "./calibration/calibrationDetectorRuntime"
  );
  return calibrationDetectorRuntimeConfigFromEnv().targetType;
}

async function safeRm(dir: string) {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function whamMetadataPoseArtifact(input: {
  takeId: string;
  jobId: string;
  sourceVideo: PoseFramesArtifact["sourceVideo"];
}): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    sourceVideo: input.sourceVideo,
    detector: {
      name: "wham_video_metadata",
      version: config.worker.whamSolverVersion,
      landmarkSchema: "wham_internal",
    },
    frames: [],
    quality: {
      frameCount: 0,
      detectedFrameCount: 0,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: 0,
    },
  };
}

function whamSolvedPoseArtifact(input: {
  takeId: string;
  jobId: string;
  sourceVideo: PoseFramesArtifact["sourceVideo"];
  solved: SolvedMotionArtifact;
}): PoseFramesArtifact {
  return {
    schema: "mocap.pose_frames.v1",
    takeId: input.takeId,
    jobId: input.jobId,
    sourceVideo: input.sourceVideo,
    detector: {
      name: "wham_internal_vitpose",
      version: config.worker.whamSolverVersion,
      landmarkSchema: "wham_internal",
    },
    frames: input.solved.frames.map((frame) => ({
      frameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
      landmarks: [],
      landmarkSchema: "wham_internal",
      poseConfidence: 1,
      detectorVersion: config.worker.whamSolverVersion,
    })),
    quality: {
      frameCount: input.solved.frameCount,
      detectedFrameCount: input.solved.frameCount,
      lowConfidenceFrameCount: 0,
      averagePoseConfidence: input.solved.frameCount > 0 ? 1 : 0,
    },
  };
}

function poseArtifactsFromMultiViewError(error: unknown): PerCameraPoseArtifact[] {
  if (!(error instanceof MultiViewOrchestratorError)) return [];
  const details = error.details;
  if (!details || typeof details !== "object") return [];
  const poseArtifacts = (details as { poseArtifacts?: unknown }).poseArtifacts;
  if (!Array.isArray(poseArtifacts)) return [];
  return poseArtifacts.filter(
    (artifact): artifact is PerCameraPoseArtifact =>
      Boolean(
        artifact &&
          typeof artifact === "object" &&
          (artifact as { schema?: unknown }).schema ===
            "mocap.pose_frames_device.v1",
      ),
  );
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
  return numbers.length === value.length ? numbers : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function wallClockMsFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matrix3x3FromUnknown(value: unknown): CameraIntrinsicsInput["matrix"] | undefined {
  const numbers = finiteNumberArray(value);
  if (!numbers || numbers.length !== 9) return undefined;
  return numbers as unknown as CameraIntrinsicsInput["matrix"];
}

function frameSyncOptionsFromCaptureVideos(
  videos: readonly CaptureVideo[],
): FrameSyncOptions | undefined {
  const networkClockOffsetMsByDevice: Record<number, number> = {};
  const recordingStartWallClockMsByDevice: Record<number, number> = {};
  const recordingStartMonotonicMsByDevice: Record<number, number> = {};
  const firstFrameTimestampMsByDevice: Record<number, number> = {};
  const framePresentationTimestampsMsByDevice: Record<number, number[]> = {};
  const fpsByDevice: Record<number, number> = {};
  const frameCountByDevice: Record<number, number> = {};
  const hasAudioTrackByDevice: Record<number, boolean> = {};
  const manualOffsetMsByDevice: Record<number, number> = {};

  for (const video of videos) {
    const captureMetadata = recordOrNull(video.captureMetadata);
    const videoMetadata = recordOrNull(captureMetadata?.video);
    const syncMetadata =
      recordOrNull(video.syncMetadata) ?? recordOrNull(captureMetadata?.sync);
    const clockOffsetMs =
      finiteNumber(syncMetadata?.networkClockOffsetMs) ??
      finiteNumber(captureMetadata?.networkClockOffsetMs) ??
      finiteNumber(syncMetadata?.clockOffsetMs);
    const manualOffsetMs =
      finiteNumber(syncMetadata?.manualOffsetMs) ??
      finiteNumber(captureMetadata?.manualOffsetMs);
    const recordingStartWallClockMs =
      finiteNumber(captureMetadata?.recordingStartWallClockMs) ??
      finiteNumber(videoMetadata?.recordingStartWallClockMs) ??
      finiteNumber(captureMetadata?.recordingStartTimeMs) ??
      finiteNumber(videoMetadata?.recordingStartTimeMs) ??
      wallClockMsFromUnknown(captureMetadata?.recordingStartedAt);
    const recordingStartMonotonicMs =
      finiteNumber(captureMetadata?.recordingStartMonotonicMs) ??
      finiteNumber(videoMetadata?.recordingStartMonotonicMs);
    const firstFrameTimestampMs =
      finiteNumber(captureMetadata?.firstFrameTimestampMs) ??
      finiteNumber(videoMetadata?.firstFrameTimestampMs);
    const framePresentationTimestampsMs =
      finiteNumberArray(captureMetadata?.framePresentationTimestampsMs) ??
      finiteNumberArray(videoMetadata?.framePresentationTimestampsMs);
    const fps = finiteNumber(captureMetadata?.fps) ?? finiteNumber(videoMetadata?.fps);
    const frameCount =
      finiteNumber(captureMetadata?.frameCount) ??
      finiteNumber(videoMetadata?.frameCount);
    const hasAudioTrack =
      booleanValue(captureMetadata?.hasAudioTrack) ??
      booleanValue(videoMetadata?.hasAudioTrack);

    if (clockOffsetMs !== undefined) {
      networkClockOffsetMsByDevice[video.deviceIndex] = clockOffsetMs;
    }
    if (recordingStartWallClockMs !== undefined) {
      recordingStartWallClockMsByDevice[video.deviceIndex] =
        recordingStartWallClockMs;
    }
    if (recordingStartMonotonicMs !== undefined) {
      recordingStartMonotonicMsByDevice[video.deviceIndex] =
        recordingStartMonotonicMs;
    }
    if (firstFrameTimestampMs !== undefined) {
      firstFrameTimestampMsByDevice[video.deviceIndex] = firstFrameTimestampMs;
    }
    if (framePresentationTimestampsMs) {
      framePresentationTimestampsMsByDevice[video.deviceIndex] =
        framePresentationTimestampsMs;
    }
    if (fps !== undefined && fps > 0) {
      fpsByDevice[video.deviceIndex] = fps;
    }
    if (frameCount !== undefined && frameCount >= 0) {
      frameCountByDevice[video.deviceIndex] = frameCount;
    }
    if (hasAudioTrack !== undefined) {
      hasAudioTrackByDevice[video.deviceIndex] = hasAudioTrack;
    }
    if (manualOffsetMs !== undefined) {
      manualOffsetMsByDevice[video.deviceIndex] = manualOffsetMs;
    }
  }

  const hasNetworkClockOffsets =
    Object.keys(networkClockOffsetMsByDevice).length > 0;
  const hasWallClockStarts =
    Object.keys(recordingStartWallClockMsByDevice).length > 0;
  const hasMonotonicStarts =
    Object.keys(recordingStartMonotonicMsByDevice).length > 0;
  const hasFirstFrameTimestamps =
    Object.keys(firstFrameTimestampMsByDevice).length > 0;
  const hasFramePresentationTimestamps =
    Object.keys(framePresentationTimestampsMsByDevice).length > 0;
  const hasFps = Object.keys(fpsByDevice).length > 0;
  const hasFrameCounts = Object.keys(frameCountByDevice).length > 0;
  const hasAudioTrackMetadata = Object.keys(hasAudioTrackByDevice).length > 0;
  const hasManualOffsets = Object.keys(manualOffsetMsByDevice).length > 0;
  if (
    !hasNetworkClockOffsets &&
    !hasWallClockStarts &&
    !hasMonotonicStarts &&
    !hasFirstFrameTimestamps &&
    !hasFramePresentationTimestamps &&
    !hasFps &&
    !hasFrameCounts &&
    !hasAudioTrackMetadata &&
    !hasManualOffsets
  ) {
    return undefined;
  }

  return {
    audioAnalysisAvailable: false,
    ...(hasNetworkClockOffsets ? { networkClockOffsetMsByDevice } : {}),
    ...(hasWallClockStarts ? { recordingStartWallClockMsByDevice } : {}),
    ...(hasMonotonicStarts ? { recordingStartMonotonicMsByDevice } : {}),
    ...(hasFirstFrameTimestamps ? { firstFrameTimestampMsByDevice } : {}),
    ...(hasFramePresentationTimestamps
      ? { framePresentationTimestampsMsByDevice }
      : {}),
    ...(hasFps ? { fpsByDevice } : {}),
    ...(hasFrameCounts ? { frameCountByDevice } : {}),
    ...(hasAudioTrackMetadata ? { hasAudioTrackByDevice } : {}),
    ...(hasManualOffsets ? { manualOffsetMsByDevice } : {}),
  };
}

function cameraIntrinsicsFromCaptureMetadata(
  captureMetadata: Record<string, unknown> | null,
): CameraIntrinsicsInput | null {
  const camera = recordOrNull(captureMetadata?.camera);
  const intrinsics =
    recordOrNull(camera?.intrinsics) ??
    recordOrNull(camera?.cameraIntrinsics) ??
    recordOrNull(captureMetadata?.cameraIntrinsics);
  const matrix =
    matrix3x3FromUnknown(captureMetadata?.intrinsicMatrixK) ??
    matrix3x3FromUnknown(camera?.intrinsicMatrixK) ??
    matrix3x3FromUnknown(intrinsics?.intrinsicMatrixK) ??
    matrix3x3FromUnknown(intrinsics?.matrix);
  const distortionCoefficients =
    finiteNumberArray(captureMetadata?.lensDistortion) ??
    finiteNumberArray(camera?.lensDistortion) ??
    finiteNumberArray(intrinsics?.distortionCoefficients);
  if (matrix) {
    return {
      matrix,
      ...(distortionCoefficients ? { distortionCoefficients } : {}),
      source: "capture_metadata",
    };
  }
  if (!intrinsics) return null;
  const fx = finiteNumber(intrinsics.fx);
  const fy = finiteNumber(intrinsics.fy);
  const cx = finiteNumber(intrinsics.cx);
  const cy = finiteNumber(intrinsics.cy);
  const skew = finiteNumber(intrinsics.skew);
  const width = finiteNumber(intrinsics.width);
  const height = finiteNumber(intrinsics.height);
  if (fx === undefined || cx === undefined || cy === undefined) {
    return null;
  }
  return {
    fx,
    ...(fy !== undefined ? { fy } : {}),
    cx,
    cy,
    ...(skew !== undefined ? { skew } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(distortionCoefficients ? { distortionCoefficients } : {}),
    source: "capture_metadata",
  };
}

function fovDegreesFromCaptureMetadata(
  captureMetadata: Record<string, unknown> | null,
): number | undefined {
  const camera = recordOrNull(captureMetadata?.camera);
  return finiteNumber(camera?.fovDegrees) ?? finiteNumber(captureMetadata?.fovDegrees);
}

function approxCameraAngleFromCaptureMetadata(
  captureMetadata: Record<string, unknown> | null,
): number | undefined {
  return (
    finiteNumber(captureMetadata?.approximateCameraAngle) ??
    finiteNumber(captureMetadata?.approxCameraAngle)
  );
}

function calibrationTargetTypeFromCaptureMetadata(
  sources: readonly ProcessedSource[],
): CalibrationTargetType | undefined {
  for (const source of sources) {
    const captureMetadata = recordOrNull(source.video.captureMetadata);
    const value =
      stringValue(captureMetadata?.calibrationTargetType) ??
      stringValue(recordOrNull(captureMetadata?.calibration)?.targetType);
    if (value && isCalibrationTargetType(value)) return value;
  }
  return undefined;
}

function calibrationDetectorConfigFromCaptureMetadata(
  sources: readonly ProcessedSource[],
): Record<string, unknown> | undefined {
  for (const source of sources) {
    const captureMetadata = recordOrNull(source.video.captureMetadata);
    const configValue =
      recordOrNull(captureMetadata?.calibrationDetectorConfig) ??
      recordOrNull(recordOrNull(captureMetadata?.calibration)?.detectorConfig);
    if (configValue) return configValue;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isCalibrationTargetType(value: string): value is CalibrationTargetType {
  return ["apriltag", "checkerboard", "charuco", "human_pose_calibration"].includes(
    value,
  );
}

function replaceMotionPipelineStage(
  stages: MotionPipelineStageStatus[],
  stage: MotionPipelineStageStatus,
) {
  const index = stages.findIndex((item) => item.stageName === stage.stageName);
  if (index >= 0) {
    stages[index] = stage;
    return;
  }
  stages.push(stage);
}

function dualFitStageStatusForWorker(
  status: DualFitReportArtifact["status"],
): MotionPipelineStageStatus["status"] {
  if (status === "failed" || status === "optimization_failed") return "failed";
  if (status === "ready") return "ready";
  return "diagnostic_only";
}

function dualFitQualityGateSummary(
  report: DualFitReportArtifact,
): DualFitQualityGateSummary {
  const acceptance =
    report.acceptance ??
    buildDualFitAcceptanceSummary({
      metrics: report.metrics,
      gates: report.qualityGates,
      acceptedAsFinalAnimation: report.acceptedAsFinalAnimation,
    });
  return {
    passed: report.qualityGates.filter((gate) => gate.passed).length,
    failed: report.qualityGates.filter((gate) => !gate.passed).length,
    blockingFailed: report.qualityGates.filter(
      (gate) => !gate.passed && gate.severity === "blocking",
    ).length,
    warningFailed: report.qualityGates.filter(
      (gate) => !gate.passed && gate.severity === "warning",
    ).length,
    accepted: acceptance.accepted,
    blockingFailures: acceptance.blockingFailures,
    warnings: acceptance.warnings,
    unavailableMetrics: acceptance.unavailableMetrics,
    metrics: acceptance.metrics,
    finalAnimationSourceRecommendation:
      acceptance.finalAnimationSourceRecommendation,
  };
}

function acceptDualFitReport(
  report: DualFitReportArtifact,
  artifactRefs: Record<string, string>,
): DualFitReportArtifact {
  const metrics = {
    ...report.metrics,
    optimizedMotionValid: true,
    optimizedBvhValid: true,
    optimizedArtifactsPresent: Boolean(
      artifactRefs.optimized_solved_motion_json && artifactRefs.optimized_bvh,
    ),
    acceptedAsFinalAnimation: true,
  };
  return {
    ...report,
    status: "ready",
    reason:
      "Optimized dual-camera motion and BVH passed export validation and quality gates.",
    metrics,
    acceptance: buildDualFitAcceptanceSummary({
      metrics,
      gates: report.qualityGates,
      acceptedAsFinalAnimation: true,
    }),
    acceptedAsFinalAnimation: true,
    finalAnimationSourceCandidate: "true_dual_solve",
    artifactRefs: {
      ...report.artifactRefs,
      ...artifactRefs,
    },
    warnings: Array.from(
      new Set([
        ...report.warnings.filter(
          (warning) => warning !== "dual_fit_rejected_primary_wham_final",
        ),
        "dual_fit_accepted_true_dual_solve",
      ]),
    ),
  };
}

function rejectDualFitReport(
  report: DualFitReportArtifact,
  reason: string,
  artifactRefs: Record<string, string> = {},
  failureCode?: DualFitGateFailureCode,
): DualFitReportArtifact {
  const metrics = {
    ...report.metrics,
    ...(failureCode === "optimized_motion_invalid"
      ? { optimizedMotionValid: false }
      : {}),
    ...(failureCode === "optimized_bvh_invalid" ||
    failureCode === "optimized_bvh_missing"
      ? { optimizedBvhValid: false }
      : {}),
    ...(failureCode === "optimized_artifacts_missing"
      ? { optimizedArtifactsPresent: false }
      : {}),
    acceptedAsFinalAnimation: false,
  };
  return {
    ...report,
    status:
      report.status === "ready" || report.acceptedAsFinalAnimation
        ? "optimization_failed"
        : report.status,
    reason,
    metrics,
    acceptance: buildDualFitAcceptanceSummary({
      metrics,
      gates: report.qualityGates,
      acceptedAsFinalAnimation: false,
      additionalBlockingFailures: failureCode ? [failureCode] : [],
    }),
    acceptedAsFinalAnimation: false,
    finalAnimationSourceCandidate: "primary_wham",
    artifactRefs: {
      ...report.artifactRefs,
      ...artifactRefs,
    },
    warnings: Array.from(
      new Set([
        ...report.warnings.filter(
          (warning) => warning !== "dual_fit_accepted_true_dual_solve_candidate",
        ),
        reason,
        "dual_fit_rejected_primary_wham_final",
      ]),
    ),
  };
}

export class WorkerJobProcessor {
  private readonly jobs: JobRepository;
  private readonly takes: TakeRepository;
  private readonly captureSessions: CaptureSessionRepository;
  private readonly uploads: UploadRepository;
  private readonly exports: ExportRepository;
  private readonly storage: ObjectStorage;
  private readonly multiViewPoseAdapter: MultiViewPoseAdapter | undefined;
  private readonly calibrationTargetDetectorAdapter:
    | CalibrationTargetDetectorAdapter
    | undefined;

  constructor(deps: Deps = {}) {
    this.jobs = deps.jobs ?? new JobRepository();
    this.takes = deps.takes ?? new TakeRepository();
    this.captureSessions = deps.captureSessions ?? new CaptureSessionRepository();
    this.uploads = deps.uploads ?? new UploadRepository();
    this.exports = deps.exports ?? new ExportRepository();
    this.storage = deps.storage ?? new ObjectStorage();
    this.multiViewPoseAdapter = deps.multiViewPoseAdapter;
    this.calibrationTargetDetectorAdapter =
      deps.calibrationTargetDetectorAdapter;
  }

  async process(job: ProcessingJob) {
    const dir = workerDir(job.id);
    await safeRm(dir);
    await mkdir(dir, { recursive: true });
    let captureSessionIds: string[] = [];

    try {
      const take = await this.takes.get(job.userId, job.takeId);
      const videos = await this.uploads.listVideosByTake(job.userId, job.takeId);
      const uploadedSources = videos
        .filter((video) => video.status === "uploaded")
        .sort((a, b) => a.deviceIndex - b.deviceIndex);
      captureSessionIds = Array.from(
        new Set(
          uploadedSources
            .map((video) => video.captureSessionId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (uploadedSources.length < take.expectedVideoCount) {
        throw new WorkerProcessingError(
          "Not all expected source videos are uploaded for this take.",
          "source_video_missing",
          {
            takeId: job.takeId,
            uploadedVideoCount: uploadedSources.length,
            expectedVideoCount: take.expectedVideoCount,
          },
        );
      }
      const useDualInput = take.captureMode === "dual" && uploadedSources.length >= 2;
      const useMultiViewInput =
        take.captureMode === "pro_4_camera" && uploadedSources.length >= 4;
      const usesMultiSourceInput = useDualInput || useMultiViewInput;
      const motionSource = useMultiViewInput
        ? "multi_view"
        : useDualInput
          ? "dual_camera"
          : "single_camera";
      const sources = useMultiViewInput
        ? uploadedSources.slice(0, 4)
        : useDualInput
          ? uploadedSources.slice(0, 2)
          : uploadedSources.slice(0, 1);
      const captureMetadataDiagnostics = usesMultiSourceInput
        ? buildCaptureMetadataDiagnostics(
            sources.map((source) => ({
              deviceIndex: source.deviceIndex,
              deviceId: source.deviceId,
              deviceRole: source.deviceRole,
              captureMetadata: source.captureMetadata,
            })),
          )
        : undefined;
      const pipelineBranch = resolveWorkerPipelineBranch({
        captureMode: take.captureMode,
        selectedVideoCount: sources.length,
        enableMultiViewReconstruction: config.worker.enableMultiViewReconstruction,
        allowPrimaryWhamFallback: config.worker.allowPrimaryWhamFallback,
      });
      const reconstructionBranchEntered =
        pipelineBranch.kind === "multi_view_reconstruction";
      const workerRuntime = {
        nodeEnv: config.nodeEnv,
        enableMultiViewReconstruction:
          config.worker.enableMultiViewReconstruction,
        allowPrimaryWhamFallback: config.worker.allowPrimaryWhamFallback,
        selectedVideoCount: sources.length,
      };
      const pipelineSelection = {
        captureMode: take.captureMode,
        selectedVideoCount: sources.length,
        selectedPipelineBranch: pipelineBranch.kind,
        pipelineBranchReason: pipelineBranch.reason,
        reconstructionBranchEntered,
        workerRuntime,
      };
      if (pipelineBranch.kind === "multi_view_disabled") {
        throw new WorkerProcessingError(
          "Multi-view reconstruction is disabled and primary WHAM fallback is not allowed.",
          "multi_view_reconstruction_disabled",
          {
            captureMode: take.captureMode,
            selectedVideoCount: sources.length,
            branch: pipelineBranch,
            pipelineSelection,
            ...(captureMetadataDiagnostics ? { captureMetadataDiagnostics } : {}),
          },
        );
      }
      let multiViewReconstructionAvailable = false;
      let primaryWhamFallbackUsed = pipelineBranch.kind === "primary_wham_fallback";
      let primaryWhamFallbackReason: WhamFallbackReason =
        pipelineBranch.kind === "primary_wham_fallback"
          ? "multi_view_reconstruction_disabled"
          : "none";
      const processedSources: ProcessedSource[] = [];
      const pipelineStages: MotionPipelineStageStatus[] = [];
      const videoNormalizationStartedAt = Date.now();

      await this.jobs.updateState({
        jobId: job.id,
        state: "ingesting",
        progress: 10,
        message: useMultiViewInput
          ? "Downloading pro multi-view source videos."
          : useDualInput
            ? "Downloading dual-camera source videos."
            : "Downloading source video.",
        metrics: {
          captureMode: take.captureMode,
          sourceCount: sources.length,
          videoStorageKeys: sources.map((source) => source.videoStorageKey),
          pipelineSelection,
          ...(captureMetadataDiagnostics ? { captureMetadataDiagnostics } : {}),
        },
      });

      for (const source of sources) {
        const deviceDir = path.join(dir, `device_${source.deviceIndex}`);
        await mkdir(deviceDir, { recursive: true });
        const inputPath = path.join(deviceDir, "source_video");
        await this.storage.downloadToFile(source.videoStorageKey, inputPath);
        const originalProbe = await probeVideo(inputPath);

        await this.jobs.updateState({
          jobId: job.id,
          state: "extracting_frames",
          progress: usesMultiSourceInput ? 18 + source.deviceIndex * 4 : 25,
          message: `Normalizing device ${source.deviceIndex} video.`,
          metrics: {
            deviceIndex: source.deviceIndex,
            probe: originalProbe,
          },
        });

        const normalizedPath = path.join(deviceDir, "normalized.mp4");
        const normalizedProbe = await normalizeVideo(inputPath, normalizedPath, {
          expectedOrientation: captureVideoOrientation(source.captureMetadata),
        });
        const normalizedKey = artifactStorageKey(
          job.takeId,
          job.id,
          usesMultiSourceInput
            ? `normalized/device_${source.deviceIndex}.mp4`
            : "normalized.mp4",
        );
        await this.storage.putFile({
          storageKey: normalizedKey,
          filePath: normalizedPath,
          contentType: "video/mp4",
        });

        processedSources.push({
          video: source,
          inputPath,
          normalizedPath,
          normalizedKey,
          normalizedProbe,
        });
      }

      pipelineStages.push(
        buildMotionPipelineStage({
          stageName: "video_normalization",
          status: "completed",
          reason: usesMultiSourceInput
            ? "Selected multi-source videos were normalized independently."
            : "Selected primary source video was normalized.",
          startedAtMs: videoNormalizationStartedAt,
          completedAtMs: Date.now(),
          artifactRefs: Object.fromEntries(
            processedSources.map((source) => [
              `normalized_device_${source.video.deviceIndex}`,
              source.normalizedKey,
            ]),
          ),
          warnings: [],
        }),
      );

      const primarySource = processedSources[0];
      if (!primarySource) {
        throw new WorkerProcessingError("No source video was prepared.", "source_video_missing");
      }
      let multiViewDiagnostic: MultiViewDiagnosticSummary | undefined;
      let qualityReportMultiViewDiagnostic:
        | QualityReportMultiViewDiagnosticInput
        | undefined = captureMetadataDiagnostics
        ? {
            pipelineBranch: pipelineBranch.kind,
            reconstructionBranchEntered,
            workerRuntime,
            reconstructionAvailable: false,
            captureMetadataDiagnostics,
            warnings: captureMetadataDiagnostics.missingMetadataWarnings,
          }
        : undefined;
      let persistedMultiViewArtifacts: PersistedMultiViewArtifact[] = [];
      let multiViewArtifactPersistenceWarnings: string[] = [];
      if (pipelineBranch.kind === "multi_view_reconstruction") {
        const reconstructionStartedAt = Date.now();
        await this.jobs.updateState({
          jobId: job.id,
          state: "solving_motion",
          progress: 60,
          message: "Running multi-view reconstruction diagnostic stage.",
          metrics: {
            captureMode: take.captureMode,
            branch: pipelineBranch,
            pipelineSelection,
            ...(captureMetadataDiagnostics ? { captureMetadataDiagnostics } : {}),
          },
        });
        let reconstruction:
          | Awaited<ReturnType<typeof runMultiViewReconstruction>>
          | undefined;
        let calibrationObservations: CalibrationObservationsArtifact | undefined;
        try {
          const poseAdapter =
            this.multiViewPoseAdapter ??
            (await createConfiguredMultiViewPoseAdapter());
          const calibrationDetectorAdapter =
            this.calibrationTargetDetectorAdapter ??
            (await createConfiguredCalibrationTargetDetectorAdapter());
          if (calibrationDetectorAdapter) {
            calibrationObservations =
              await calibrationDetectorAdapter.detectCalibrationObservations({
                takeId: job.takeId,
                jobId: job.id,
                sessionId: captureSessionIds[0] ?? null,
                targetType:
                  calibrationTargetTypeFromCaptureMetadata(processedSources) ??
                  (await configuredCalibrationTargetType()),
                detectorConfig:
                  calibrationDetectorConfigFromCaptureMetadata(processedSources),
                outputArtifactName: "calibration_observations.json",
                cameras: processedSources.map((source) => {
                  const captureMetadata = recordOrNull(source.video.captureMetadata);
                  const cameraId =
                    typeof captureMetadata?.cameraId === "string" &&
                    captureMetadata.cameraId.trim().length > 0
                      ? captureMetadata.cameraId.trim()
                      : `device_${source.video.deviceIndex}`;
                  return {
                    cameraId,
                    deviceId: source.video.deviceId ?? undefined,
                    normalizedVideoPath: source.normalizedPath,
                    videoMetadata: {
                      fps: source.normalizedProbe.fps,
                      width: source.normalizedProbe.width,
                      height: source.normalizedProbe.height,
                      durationMs: source.normalizedProbe.durationMs,
                    },
                  };
                }),
              });
          }
          reconstruction = await runMultiViewReconstruction({
            takeId: job.takeId,
            jobId: job.id,
            source: motionSource === "multi_view" ? "multi_view" : "dual_camera",
            processedSources: processedSources.map((source) => {
              const captureMetadata = recordOrNull(source.video.captureMetadata);
              const cameraId =
                typeof captureMetadata?.cameraId === "string" &&
                captureMetadata.cameraId.trim().length > 0
                  ? captureMetadata.cameraId.trim()
                  : `device_${source.video.deviceIndex}`;
              return {
                cameraId,
                deviceId: source.video.deviceId ?? undefined,
                deviceIndex: source.video.deviceIndex,
                deviceRole: source.video.deviceRole,
                videoStorageKey: source.video.videoStorageKey,
                normalizedStorageKey: source.normalizedKey,
                normalizedPath: source.normalizedPath,
                fps: source.normalizedProbe.fps,
                width: source.normalizedProbe.width,
                height: source.normalizedProbe.height,
                durationMs: source.normalizedProbe.durationMs,
                intrinsics: cameraIntrinsicsFromCaptureMetadata(captureMetadata),
                fovDegrees: fovDegreesFromCaptureMetadata(captureMetadata),
                approxCameraAngleDegrees:
                  approxCameraAngleFromCaptureMetadata(captureMetadata),
              };
            }),
            outputDir: path.join(dir, "multi_view_reconstruction"),
            poseAdapter,
            syncOptions: frameSyncOptionsFromCaptureVideos(
              processedSources.map((source) => source.video),
            ),
            ...(calibrationObservations ? { calibrationObservations } : {}),
          });
        } catch (error) {
          const failedPoseArtifacts = poseArtifactsFromMultiViewError(error);
          const action = resolveMultiViewStageFailure({
            error,
            allowPrimaryWhamFallback: config.worker.allowPrimaryWhamFallback,
          });
          multiViewDiagnostic = {
            branch: pipelineBranch.kind,
            reconstructionBranchEntered,
            workerRuntime,
            reconstructionAvailable: false,
            usedForWhamConstraints: false,
            primaryWhamContinues: action.shouldContinueWithPrimaryWham,
            fallbackToPrimaryWham: action.shouldContinueWithPrimaryWham,
            primaryWhamFallbackReason: whamFallbackReasonFromMultiViewError(
              action.errorCode,
            ),
            errorCode: action.errorCode,
            errorMessage: action.errorMessage,
          };
          qualityReportMultiViewDiagnostic = {
            pipelineBranch: pipelineBranch.kind,
            reconstructionBranchEntered,
            workerRuntime,
            reconstructionAvailable: false,
            captureMetadataDiagnostics,
            ...(calibrationObservations ? { calibrationObservations } : {}),
            warnings: [
              action.errorCode,
              ...(calibrationObservations?.warnings ?? []),
              ...(captureMetadataDiagnostics?.missingMetadataWarnings ?? []),
            ],
            errorCode: action.errorCode,
            errorMessage: action.errorMessage,
            ...(failedPoseArtifacts.length
              ? { poseArtifacts: failedPoseArtifacts }
              : {}),
          };
          if (action.shouldContinueWithPrimaryWham && failedPoseArtifacts.length > 0) {
            try {
              const persistenceResult = await persistMultiViewArtifacts({
                takeId: job.takeId,
                jobId: job.id,
                source:
                  take.captureMode === "pro_4_camera"
                    ? "pro_4_camera"
                    : motionSource === "multi_view"
                      ? "multi_view"
                      : "dual_camera",
                poseArtifacts: failedPoseArtifacts,
                ...(calibrationObservations
                  ? { calibrationObservations }
                  : {}),
                storage: {
                  uploadJson: (key, value) => this.storage.putJson(key, value),
                },
                exportsRepository: {
                  createExportFile: ({ format, artifactName, storageKey, sizeBytes }) =>
                    this.exports.create({
                      userId: job.userId,
                      projectId: job.projectId,
                      takeId: job.takeId,
                      jobId: job.id,
                      preset: job.preset,
                      format,
                      artifactName,
                      storageKey,
                      fileSizeBytes: sizeBytes,
                    }),
                },
              });
              persistedMultiViewArtifacts = persistenceResult.artifacts;
              multiViewArtifactPersistenceWarnings = persistenceResult.warnings;
            } catch {
              multiViewArtifactPersistenceWarnings = [
                ...multiViewArtifactPersistenceWarnings,
                "multi_view_pose_artifact_persistence_failed",
              ];
            }
          }
          pipelineStages.push(
            ...buildReconstructionDiagnosticStages({
              source: motionSource,
              branchKind: pipelineBranch.kind,
              reconstructionAvailable: false,
              errorCode: action.errorCode,
              errorMessage: action.errorMessage,
              artifactRefs: artifactRefsFromPersistedMultiViewArtifacts(
                persistedMultiViewArtifacts,
              ),
              ...(calibrationObservations ? { calibrationObservations } : {}),
              warnings: [
                action.errorCode,
                ...(calibrationObservations?.warnings ?? []),
                ...(captureMetadataDiagnostics?.missingMetadataWarnings ?? []),
                ...multiViewArtifactPersistenceWarnings,
              ],
              startedAtMs: reconstructionStartedAt,
              completedAtMs: Date.now(),
            }),
          );
          if (!action.shouldContinueWithPrimaryWham) {
            throw new WorkerProcessingError(
              "Multi-view reconstruction failed and primary WHAM fallback is disabled.",
              action.errorCode,
              {
                captureMode: take.captureMode,
                branch: pipelineBranch,
                multiView: multiViewDiagnostic,
                pipelineSelection,
                ...(captureMetadataDiagnostics
                  ? { captureMetadataDiagnostics }
                  : {}),
              },
            );
          }
          primaryWhamFallbackUsed = true;
          primaryWhamFallbackReason = whamFallbackReasonFromMultiViewError(
            action.errorCode,
          );
          await this.jobs.updateState({
            jobId: job.id,
            state: "solving_motion",
            progress: 66,
            message:
              "Multi-view reconstruction unavailable; continuing primary WHAM fallback.",
            metrics: {
              captureMode: take.captureMode,
              multiView: multiViewDiagnostic,
              pipelineSelection,
              ...(captureMetadataDiagnostics
                ? { captureMetadataDiagnostics }
                : {}),
              ...(persistedMultiViewArtifacts.length
                ? { multiViewArtifacts: persistedMultiViewArtifacts }
                : {}),
              ...(multiViewArtifactPersistenceWarnings.length
                ? { warnings: multiViewArtifactPersistenceWarnings }
                : {}),
            },
          });
        }
        if (reconstruction) {
          multiViewDiagnostic = {
            branch: pipelineBranch.kind,
            reconstructionBranchEntered,
            workerRuntime,
            reconstructionAvailable: true,
            matchedFrameCount:
              reconstruction.reconstructionArtifact.metrics.matchedFrameCount,
            triangulatedLandmarkRatio:
              reconstruction.reconstructionArtifact.metrics.triangulatedLandmarkRatio,
            reprojectionErrorPx:
              reconstruction.reconstructionArtifact.metrics.reprojectionErrorPx,
            usedForWhamConstraints: false,
            primaryWhamContinues: true,
            primaryWhamFallbackReason:
              "multi_view_reconstruction_diagnostic_only",
          };
          qualityReportMultiViewDiagnostic = {
            pipelineBranch: pipelineBranch.kind,
            reconstructionBranchEntered,
            workerRuntime,
            reconstructionAvailable: true,
            captureMetadataDiagnostics,
            syncReport: reconstruction.syncReport,
            calibrationObservations: reconstruction.calibrationObservations,
            cameraCalibration: reconstruction.calibrationArtifact,
            captureVolume: reconstruction.captureVolumeArtifact,
            reconstruction: reconstruction.reconstructionArtifact,
            jointTrack: reconstruction.triangulatedJointTrackArtifact,
            dualReconstruction: reconstruction.dualReconstructionArtifact,
            multiViewReconstruction:
              reconstruction.multiViewReconstructionSummaryArtifact,
            poseArtifacts: reconstruction.poseArtifacts,
            warnings: Array.from(
              new Set([
                ...reconstruction.syncReport.warnings,
                ...(reconstruction.calibrationObservations?.warnings ?? []),
                ...reconstruction.calibrationArtifact.warnings,
                ...reconstruction.captureVolumeArtifact.warnings,
                ...reconstruction.reconstructionArtifact.warnings,
                ...(reconstruction.triangulatedJointTrackArtifact?.warnings ?? []),
                ...(captureMetadataDiagnostics?.missingMetadataWarnings ?? []),
                ...(reconstruction.dualReconstructionArtifact?.warnings ?? []),
                ...(
                  reconstruction.multiViewReconstructionSummaryArtifact
                    ?.qualitySummary.warnings ?? []
                ),
              ]),
            ),
          };
          multiViewReconstructionAvailable = true;
          primaryWhamFallbackUsed = true;
          primaryWhamFallbackReason =
            "multi_view_reconstruction_diagnostic_only";
          let artifactPersistenceErrorMessage: string | undefined;
          try {
            const persistenceResult = await persistMultiViewArtifacts({
              takeId: job.takeId,
              jobId: job.id,
              source:
                take.captureMode === "pro_4_camera"
                  ? "pro_4_camera"
                  : motionSource === "multi_view"
                    ? "multi_view"
                    : "dual_camera",
              poseArtifacts: reconstruction.poseArtifacts,
              syncReport: reconstruction.syncReport,
              calibrationObservations: reconstruction.calibrationObservations,
              cameraCalibration: reconstruction.calibrationArtifact,
              captureVolume: reconstruction.captureVolumeArtifact,
              reconstruction: reconstruction.reconstructionArtifact,
              triangulatedJointTrack:
                reconstruction.triangulatedJointTrackArtifact,
              dualReconstruction: reconstruction.dualReconstructionArtifact,
              multiViewReconstruction:
                reconstruction.multiViewReconstructionSummaryArtifact,
              diagnosticPoseFrames: reconstruction.diagnosticPoseFramesArtifact,
              storage: {
                uploadJson: (key, value) => this.storage.putJson(key, value),
              },
              exportsRepository: {
                createExportFile: ({ format, artifactName, storageKey, sizeBytes }) =>
                  this.exports.create({
                    userId: job.userId,
                    projectId: job.projectId,
                    takeId: job.takeId,
                    jobId: job.id,
                    preset: job.preset,
                    format,
                    artifactName,
                    storageKey,
                    fileSizeBytes: sizeBytes,
                  }),
              },
            });
            persistedMultiViewArtifacts = persistenceResult.artifacts;
            multiViewArtifactPersistenceWarnings = persistenceResult.warnings;
          } catch (error) {
            artifactPersistenceErrorMessage =
              error instanceof Error
                ? error.message
                : "Multi-view artifact persistence failed.";
            multiViewArtifactPersistenceWarnings = [
              ...multiViewArtifactPersistenceWarnings,
              "multi_view_artifact_persistence_failed",
            ];
            qualityReportMultiViewDiagnostic.warnings = Array.from(
              new Set([
                ...(qualityReportMultiViewDiagnostic.warnings ?? []),
                ...multiViewArtifactPersistenceWarnings,
              ]),
            );
          }
          pipelineStages.push(
            ...buildReconstructionDiagnosticStages({
              source: motionSource,
              branchKind: pipelineBranch.kind,
              reconstructionAvailable: true,
              reconstructionStatus:
                reconstruction.triangulatedJointTrackArtifact?.status ??
                reconstruction.dualReconstructionArtifact?.status ??
                reconstruction.multiViewReconstructionSummaryArtifact?.status ??
                "ready",
              errorCode: artifactPersistenceErrorMessage
                ? "multi_view_artifact_persistence_failed"
                : undefined,
              errorMessage: artifactPersistenceErrorMessage,
              artifactRefs: artifactRefsFromPersistedMultiViewArtifacts(
                persistedMultiViewArtifacts,
              ),
              syncReport: reconstruction.syncReport,
              calibrationObservations: reconstruction.calibrationObservations,
              cameraCalibration: reconstruction.calibrationArtifact,
              captureVolume: reconstruction.captureVolumeArtifact,
              triangulatedJointTrack:
                reconstruction.triangulatedJointTrackArtifact,
              warnings: [
                ...(qualityReportMultiViewDiagnostic.warnings ?? []),
                ...multiViewArtifactPersistenceWarnings,
              ],
              startedAtMs: reconstructionStartedAt,
              completedAtMs: Date.now(),
            }),
          );
          await this.jobs.updateState({
            jobId: job.id,
            state: "solving_motion",
            progress: 66,
            message:
              "Multi-view reconstruction diagnostic stage completed; artifacts persisted; continuing primary WHAM solve.",
            metrics: {
              captureMode: take.captureMode,
              multiView: multiViewDiagnostic,
              pipelineSelection,
              ...(captureMetadataDiagnostics
                ? { captureMetadataDiagnostics }
                : {}),
              multiViewArtifacts: persistedMultiViewArtifacts,
              warnings: multiViewArtifactPersistenceWarnings,
            },
          });
        }
      } else if (motionSource !== "single_camera") {
        pipelineStages.push(
          ...buildReconstructionDiagnosticStages({
            source: motionSource,
            branchKind: pipelineBranch.kind,
            reconstructionAvailable: false,
            warnings:
              primaryWhamFallbackReason === "none"
                ? captureMetadataDiagnostics?.missingMetadataWarnings ?? []
                : [
                    primaryWhamFallbackReason,
                    ...(captureMetadataDiagnostics?.missingMetadataWarnings ?? []),
                  ],
          }),
        );
      }
      let whamInputUsage = buildWhamInputUsageMetrics({
        source: motionSource,
        selectedVideos: processedSources.map((source) => ({
          deviceIndex: source.video.deviceIndex,
          storageKey: source.video.videoStorageKey,
        })),
        primaryDeviceIndex: primarySource.video.deviceIndex,
        multiViewReconstructionAvailable,
        multiViewConstraintsUsed: false,
        primaryWhamFallbackUsed,
        primaryWhamFallbackReason,
      });
      let poseArtifact = whamMetadataPoseArtifact({
        takeId: job.takeId,
        jobId: job.id,
        sourceVideo: {
          storageKey: primarySource.video.videoStorageKey,
          normalizedStorageKey: primarySource.normalizedKey,
          fps: primarySource.normalizedProbe.fps,
          width: primarySource.normalizedProbe.width,
          height: primarySource.normalizedProbe.height,
          durationMs: primarySource.normalizedProbe.durationMs,
        },
      });

      await this.jobs.updateState({
        jobId: job.id,
        state: "solving_motion",
        progress: 68,
        message: "Running WHAM/SMPL solve from normalized source video.",
        metrics: {
          source: motionSource,
          normalizedVideos: processedSources.map((source) => source.normalizedKey),
          whamInputUsage,
          pipelineSelection,
          ...(multiViewDiagnostic ? { multiView: multiViewDiagnostic } : {}),
          ...(captureMetadataDiagnostics ? { captureMetadataDiagnostics } : {}),
          ...(persistedMultiViewArtifacts.length
            ? { multiViewArtifacts: persistedMultiViewArtifacts }
            : {}),
        },
      });

      const primaryWhamStartedAt = Date.now();
      const premiumAttempt = await trySolvePremiumMotion({
        takeId: job.takeId,
        jobId: job.id,
        poseArtifact,
        source: motionSource,
        presetId: job.preset,
        outputDir: path.join(dir, "premium_solver"),
        normalizedVideoPaths: processedSources.map((source) => source.normalizedPath),
        whamInputUsage,
      });

      const rawSolved = premiumAttempt.motion;
      const rawSolvedValidation = validateSolvedMotion(rawSolved);
      if (!rawSolvedValidation.ok) {
        throw new WorkerProcessingError(
          "Solved motion failed validation.",
          "solved_motion_invalid",
          rawSolvedValidation,
        );
      }
      if (!rawSolved.smpl) {
        throw new WorkerProcessingError(
          "WHAM did not return required SMPL body pose and global orientation parameters.",
          "smpl_parameters_missing",
        );
      }
      poseArtifact = whamSolvedPoseArtifact({
        takeId: job.takeId,
        jobId: job.id,
        sourceVideo: poseArtifact.sourceVideo,
        solved: rawSolved,
      });

      const smplParametersKey = artifactStorageKey(job.takeId, job.id, "smpl_parameters.json");
      const smplParametersFile = await this.storage.putJson(smplParametersKey, rawSolved.smpl);
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "smpl_parameters_json",
        storageKey: smplParametersFile.storageKey,
        fileSizeBytes: smplParametersFile.sizeBytes,
      });

      let overlayPreviewKey: string | undefined;
      if (premiumAttempt.overlayPreviewPath) {
        overlayPreviewKey = artifactStorageKey(
          job.takeId,
          job.id,
          "wham_overlay_preview.mp4",
        );
        const overlayPreviewFile = await this.storage.putFile({
          storageKey: overlayPreviewKey,
          filePath: premiumAttempt.overlayPreviewPath,
          contentType: "video/mp4",
        });
        await this.exports.create({
          userId: job.userId,
          projectId: job.projectId,
          takeId: job.takeId,
          jobId: job.id,
          preset: job.preset,
          format: "wham_overlay_preview_mp4",
          storageKey: overlayPreviewFile.storageKey,
          fileSizeBytes: overlayPreviewFile.sizeBytes,
        });
      }
      const rawSolvedKey = artifactStorageKey(job.takeId, job.id, "raw_solved_motion.json");
      const rawSolvedFile = await this.storage.putJson(rawSolvedKey, {
        ...rawSolved,
        validation: rawSolvedValidation,
      });
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "raw_solved_motion_json",
        storageKey: rawSolvedFile.storageKey,
        fileSizeBytes: rawSolvedFile.sizeBytes,
      });

      pipelineStages.push(
        buildMotionPipelineStage({
          stageName: "primary_wham",
          status: "completed",
          reason: primaryWhamFallbackUsed
            ? "WHAM produced the final animation from the primary selected video; multi-view reconstruction remained diagnostic."
            : "WHAM produced the final animation from the primary selected video.",
          startedAtMs: primaryWhamStartedAt,
          completedAtMs: Date.now(),
          artifactRefs: {
            smpl_parameters_json: smplParametersKey,
            raw_solved_motion_json: rawSolvedKey,
            ...(overlayPreviewKey
              ? { wham_overlay_preview_mp4: overlayPreviewKey }
              : {}),
          },
          warnings:
            primaryWhamFallbackReason === "none"
              ? []
              : ["single_camera_solver_fallback_used", primaryWhamFallbackReason],
        }),
      );

      let optimizedSolvedMotionForFinal: SolvedMotionArtifact | undefined;
      let optimizedSolvedMotionKey: string | undefined;
      let optimizedBvhKey: string | undefined;
      let optimizedBvhText: string | undefined;
      let acceptedDualCameraFinal = false;

      if (pipelineBranch.kind === "multi_view_reconstruction" && motionSource !== "single_camera") {
        const fittingStartedAt = Date.now();
        try {
          const fittingResult = runDualCameraFittingOptimization({
            takeId: job.takeId,
            jobId: job.id,
            whamInitialization: rawSolved,
            smplInitialization: rawSolved.smpl,
            jointTrack: qualityReportMultiViewDiagnostic?.jointTrack,
            poseArtifacts: qualityReportMultiViewDiagnostic?.poseArtifacts,
            cameraCalibration: qualityReportMultiViewDiagnostic?.cameraCalibration,
            artifactRefs: artifactRefsFromPersistedMultiViewArtifacts(
              persistedMultiViewArtifacts,
            ),
          });
          let dualFitReport = fittingResult.report;
          const optimizedArtifactRefs: Record<string, string> = {};

          if (fittingResult.optimizedMotion) {
            const optimizedValidation = validateSolvedMotion(
              fittingResult.optimizedMotion,
            );
            if (!optimizedValidation.ok) {
              dualFitReport = rejectDualFitReport(
                dualFitReport,
                `Optimized solved motion failed validation: ${optimizedValidation.errors.join("; ")}`,
                {},
                "optimized_motion_invalid",
              );
            } else {
              const candidateBvh = writeBvh(fittingResult.optimizedMotion);
              const optimizedBvhValidation = validateBvhText(
                candidateBvh,
                fittingResult.optimizedMotion.frameCount,
              );
              const optimizedBvhPath = path.join(dir, "optimized_result.bvh");
              const optimizedBlenderResultPath = path.join(
                dir,
                "optimized_blender_smoke_test.json",
              );
              await writeFile(optimizedBvhPath, candidateBvh, "utf8");
              const optimizedBlender = await runBlenderSmokeTest(
                optimizedBvhPath,
                optimizedBlenderResultPath,
              );
              const optimizedErrors = [
                ...optimizedValidation.errors,
                ...optimizedBvhValidation.errors,
                ...optimizedBlender.errors,
              ];
              const optimizedWarnings = [
                ...optimizedValidation.warnings,
                ...optimizedBvhValidation.warnings,
                ...optimizedBlender.warnings,
              ];

              if (!optimizedBvhValidation.ok || !optimizedBlender.ok) {
                dualFitReport = rejectDualFitReport(
                  dualFitReport,
                  `Optimized BVH export was rejected: ${optimizedErrors.join("; ")}`,
                  {},
                  "optimized_bvh_invalid",
                );
              } else {
                try {
                  const acceptedOptimizedMotion: SolvedMotionArtifact = {
                    ...fittingResult.optimizedMotion,
                    validation: {
                      ok: true,
                      warnings: Array.from(
                        new Set([
                          ...fittingResult.optimizedMotion.validation.warnings,
                          ...optimizedWarnings,
                        ]),
                      ),
                      errors: [],
                    },
                    optimizedFrom: fittingResult.optimizedMotion.optimizedFrom
                      ? {
                          ...fittingResult.optimizedMotion.optimizedFrom,
                          acceptedAsFinalAnimation: true,
                        }
                      : undefined,
                  };
                  const candidateOptimizedBvhKey = artifactStorageKey(
                    job.takeId,
                    job.id,
                    "optimized_result.bvh",
                  );
                  const optimizedBvhFile = await this.storage.putText(
                    candidateOptimizedBvhKey,
                    candidateBvh,
                    "application/octet-stream",
                  );
                  await this.exports.create({
                    userId: job.userId,
                    projectId: job.projectId,
                    takeId: job.takeId,
                    jobId: job.id,
                    preset: job.preset,
                    format: "optimized_bvh",
                    storageKey: optimizedBvhFile.storageKey,
                    artifactName: "optimized_bvh",
                    fileSizeBytes: optimizedBvhFile.sizeBytes,
                  });

                  const candidateOptimizedSolvedMotionKey = artifactStorageKey(
                    job.takeId,
                    job.id,
                    "optimized_solved_motion.json",
                  );
                  const optimizedSolvedMotionFile = await this.storage.putJson(
                    candidateOptimizedSolvedMotionKey,
                    acceptedOptimizedMotion,
                  );
                  await this.exports.create({
                    userId: job.userId,
                    projectId: job.projectId,
                    takeId: job.takeId,
                    jobId: job.id,
                    preset: job.preset,
                    format: "optimized_solved_motion_json",
                    storageKey: optimizedSolvedMotionFile.storageKey,
                    artifactName: "optimized_solved_motion_json",
                    fileSizeBytes: optimizedSolvedMotionFile.sizeBytes,
                  });

                  optimizedBvhKey = candidateOptimizedBvhKey;
                  optimizedSolvedMotionKey = candidateOptimizedSolvedMotionKey;
                  optimizedArtifactRefs.optimized_bvh = optimizedBvhKey;
                  optimizedArtifactRefs.optimized_solved_motion_json =
                    optimizedSolvedMotionKey;
                  optimizedSolvedMotionForFinal = acceptedOptimizedMotion;
                  optimizedBvhText = candidateBvh;
                  acceptedDualCameraFinal = true;
                  primaryWhamFallbackUsed = false;
                  primaryWhamFallbackReason = "none";
                  whamInputUsage = buildWhamInputUsageMetrics({
                    source: motionSource,
                    selectedVideos: processedSources.map((source) => ({
                      deviceIndex: source.video.deviceIndex,
                      storageKey: source.video.videoStorageKey,
                    })),
                    primaryDeviceIndex: primarySource.video.deviceIndex,
                    multiViewReconstructionAvailable,
                    multiViewConstraintsUsed: true,
                    primaryWhamFallbackUsed: false,
                    primaryWhamFallbackReason: "none",
                  });
                  replaceMotionPipelineStage(
                    pipelineStages,
                    buildMotionPipelineStage({
                      stageName: "primary_wham",
                      status: "completed",
                      reason:
                        "WHAM produced the primary initialization; accepted dual-camera fitting supplies the final animation.",
                      startedAtMs: primaryWhamStartedAt,
                      completedAtMs: Date.now(),
                      artifactRefs: {
                        smpl_parameters_json: smplParametersKey,
                        raw_solved_motion_json: rawSolvedKey,
                        ...(overlayPreviewKey
                          ? { wham_overlay_preview_mp4: overlayPreviewKey }
                          : {}),
                      },
                      warnings: [],
                    }),
                  );
                  dualFitReport = acceptDualFitReport(
                    dualFitReport,
                    optimizedArtifactRefs,
                  );
                } catch (error) {
                  optimizedSolvedMotionKey = undefined;
                  optimizedBvhKey = undefined;
                  optimizedSolvedMotionForFinal = undefined;
                  optimizedBvhText = undefined;
                  acceptedDualCameraFinal = false;
                  const message =
                    error instanceof Error
                      ? error.message
                      : "Optimized artifact persistence failed.";
                  dualFitReport = rejectDualFitReport(
                    dualFitReport,
                    `Optimized artifact persistence failed: ${message}`,
                    {},
                    "optimized_artifacts_missing",
                  );
                }
              }
            }
          }

          if (
            dualFitReport.acceptedAsFinalAnimation &&
            (!optimizedSolvedMotionForFinal || !optimizedBvhKey)
          ) {
            dualFitReport = rejectDualFitReport(
              dualFitReport,
              "Optimized output was not fully persisted; primary WHAM remains final.",
              optimizedArtifactRefs,
              "optimized_artifacts_missing",
            );
            acceptedDualCameraFinal = false;
            optimizedSolvedMotionForFinal = undefined;
            optimizedBvhText = undefined;
            optimizedSolvedMotionKey = undefined;
            optimizedBvhKey = undefined;
          }
          const dualFitValidation =
            validateDualFitReportArtifact(dualFitReport);
          if (!dualFitValidation.ok) {
            throw new WorkerProcessingError(
              "Dual fitting report failed validation.",
              "dual_fit_report_invalid",
              dualFitValidation,
            );
          }

          const fittingPersistenceResult = await persistMultiViewArtifacts({
            takeId: job.takeId,
            jobId: job.id,
            source:
              take.captureMode === "pro_4_camera"
                ? "pro_4_camera"
                : motionSource === "multi_view"
                  ? "multi_view"
                  : "dual_camera",
            dualFitReport,
            storage: {
              uploadJson: (key, value) => this.storage.putJson(key, value),
            },
            exportsRepository: {
              createExportFile: ({ format, artifactName, storageKey, sizeBytes }) =>
                this.exports.create({
                  userId: job.userId,
                  projectId: job.projectId,
                  takeId: job.takeId,
                  jobId: job.id,
                  preset: job.preset,
                  format,
                  artifactName,
                  storageKey,
                  fileSizeBytes: sizeBytes,
                }),
            },
          });
          persistedMultiViewArtifacts = [
            ...persistedMultiViewArtifacts,
            ...fittingPersistenceResult.artifacts,
          ];
          multiViewArtifactPersistenceWarnings = Array.from(
            new Set([
              ...multiViewArtifactPersistenceWarnings,
              ...fittingPersistenceResult.warnings,
            ]),
          );
          qualityReportMultiViewDiagnostic = {
            ...(qualityReportMultiViewDiagnostic ?? {
              pipelineBranch: pipelineBranch.kind,
              reconstructionBranchEntered,
              workerRuntime,
              reconstructionAvailable: multiViewReconstructionAvailable,
              captureMetadataDiagnostics,
            }),
            dualFitReport,
            warnings: Array.from(
              new Set([
                ...(qualityReportMultiViewDiagnostic?.warnings ?? []),
                ...dualFitReport.warnings,
                ...fittingPersistenceResult.warnings,
              ]),
            ),
          };
          const fittingArtifactRefs =
            artifactRefsFromPersistedMultiViewArtifacts(
              persistedMultiViewArtifacts,
            );
          const reconstructionArtifactStage = pipelineStages.find(
            (stage) => stage.stageName === "dual_reconstruction_artifacts",
          );
          if (
            reconstructionArtifactStage &&
            fittingArtifactRefs.dual_fit_report_json
          ) {
            reconstructionArtifactStage.artifactRefs = {
              ...reconstructionArtifactStage.artifactRefs,
              dual_fit_report_json: fittingArtifactRefs.dual_fit_report_json,
              ...optimizedArtifactRefs,
            };
          }
          replaceMotionPipelineStage(
            pipelineStages,
            buildMotionPipelineStage({
              stageName: "dual_camera_fitting",
              status: dualFitStageStatusForWorker(dualFitReport.status),
              reason: dualFitReport.acceptedAsFinalAnimation
                ? `${dualFitReport.reason ?? "Dual-camera fitting accepted optimized output."} Final animation source can switch to true_dual_solve.`
                : `${dualFitReport.reason ?? "Dual-camera fitting completed."} Final animation remains primary WHAM.`,
              startedAtMs: fittingStartedAt,
              completedAtMs: Date.now(),
              artifactRefs: {
                ...(fittingArtifactRefs.dual_fit_report_json
                  ? {
                      dual_fit_report_json:
                        fittingArtifactRefs.dual_fit_report_json,
                    }
                  : {}),
                ...optimizedArtifactRefs,
              },
              artifactRef: fittingArtifactRefs.dual_fit_report_json,
              dualFitStatus: dualFitReport.status,
              acceptedAsFinalAnimation: dualFitReport.acceptedAsFinalAnimation,
              finalAnimationSource: dualFitReport.finalAnimationSourceCandidate,
              qualityGateSummary: dualFitQualityGateSummary(dualFitReport),
              warnings: dualFitReport.warnings,
            }),
          );
        } catch (error) {
          acceptedDualCameraFinal = false;
          optimizedSolvedMotionForFinal = undefined;
          optimizedSolvedMotionKey = undefined;
          optimizedBvhKey = undefined;
          optimizedBvhText = undefined;
          primaryWhamFallbackUsed = true;
          primaryWhamFallbackReason = "multi_view_reconstruction_diagnostic_only";
          whamInputUsage = buildWhamInputUsageMetrics({
            source: motionSource,
            selectedVideos: processedSources.map((source) => ({
              deviceIndex: source.video.deviceIndex,
              storageKey: source.video.videoStorageKey,
            })),
            primaryDeviceIndex: primarySource.video.deviceIndex,
            multiViewReconstructionAvailable,
            multiViewConstraintsUsed: false,
            primaryWhamFallbackUsed,
            primaryWhamFallbackReason,
          });
          const message =
            error instanceof Error
              ? error.message
              : "Dual fitting foundation failed.";
          qualityReportMultiViewDiagnostic = {
            ...(qualityReportMultiViewDiagnostic ?? {
              pipelineBranch: pipelineBranch.kind,
              reconstructionBranchEntered,
              workerRuntime,
              reconstructionAvailable: multiViewReconstructionAvailable,
              captureMetadataDiagnostics,
            }),
            warnings: Array.from(
              new Set([
                ...(qualityReportMultiViewDiagnostic?.warnings ?? []),
                "dual_camera_fitting_failed",
                message,
              ]),
            ),
          };
          replaceMotionPipelineStage(
            pipelineStages,
            buildMotionPipelineStage({
              stageName: "dual_camera_fitting",
              status: "failed",
              reason:
                "Dual-camera fitting foundation failed; primary WHAM fallback remains the final animation path.",
              startedAtMs: fittingStartedAt,
              completedAtMs: Date.now(),
              warnings: ["dual_camera_fitting_failed", message],
            }),
          );
        }
      }

      await this.jobs.updateState({
        jobId: job.id,
        state: "cleaning",
        progress: 76,
        message: "Cleaning motion and applying foot locking.",
        metrics: {
          solvedFrameCount: rawSolved.frameCount,
          warnings: rawSolvedValidation.warnings,
        },
      });

      const { cleaned: solved, report: cleanup } = cleanupSolvedMotion(poseArtifact, rawSolved);
      const solvedValidation = validateSolvedMotion(solved);
      if (!solvedValidation.ok) {
        throw new WorkerProcessingError(
          "Cleaned motion failed validation.",
          "cleaned_motion_invalid",
          solvedValidation,
        );
      }
      const solvedKey = artifactStorageKey(job.takeId, job.id, "solved_motion.json");
      const solvedFile = await this.storage.putJson(solvedKey, {
        ...solved,
        validation: solvedValidation,
        cleanup,
      });
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "solved_motion_json",
        storageKey: solvedFile.storageKey,
        fileSizeBytes: solvedFile.sizeBytes,
      });

      const cleanupKey = artifactStorageKey(job.takeId, job.id, "cleanup_report.json");
      const cleanupFile = await this.storage.putJson(cleanupKey, cleanup);
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "cleanup_report_json",
        storageKey: cleanupFile.storageKey,
        fileSizeBytes: cleanupFile.sizeBytes,
      });

      await this.jobs.updateState({
        jobId: job.id,
        state: "exporting",
        progress: 86,
        message: "Writing validated export artifacts.",
        metrics: {
          solvedFrameCount: solved.frameCount,
          cleanup: cleanup.metrics,
          warnings: solvedValidation.warnings,
        },
      });

      const finalAnimationStartedAt = Date.now();
      const finalSolved =
        acceptedDualCameraFinal && optimizedSolvedMotionForFinal
          ? optimizedSolvedMotionForFinal
          : solved;
      const finalSolvedValidation =
        finalSolved === solved ? solvedValidation : validateSolvedMotion(finalSolved);
      if (!finalSolvedValidation.ok) {
        throw new WorkerProcessingError(
          "Final motion failed validation.",
          "final_motion_invalid",
          finalSolvedValidation,
        );
      }
      const bvh =
        acceptedDualCameraFinal && optimizedBvhText
          ? optimizedBvhText
          : writeBvh(finalSolved);
      const bvhValidation = validateBvhText(bvh, finalSolved.frameCount);
      const bvhPath = path.join(dir, "result.bvh");
      const blenderResultPath = path.join(dir, "blender_smoke_test.json");
      await writeFile(bvhPath, bvh, "utf8");
      const blender = await runBlenderSmokeTest(bvhPath, blenderResultPath);
      const allWarnings = [
        ...finalSolvedValidation.warnings,
        ...bvhValidation.warnings,
        ...blender.warnings,
      ];
      const allErrors = [
        ...finalSolvedValidation.errors,
        ...bvhValidation.errors,
        ...blender.errors,
      ];
      if (!bvhValidation.ok) {
        throw new WorkerProcessingError("BVH export failed validation.", "bvh_invalid", {
          errors: allErrors,
          warnings: allWarnings,
        });
      }
      if (!blender.ok) {
        throw new WorkerProcessingError(
          "Blender smoke test failed.",
          "blender_smoke_test_failed",
          {
            errors: allErrors,
            warnings: allWarnings,
            metrics: blender.metrics,
          },
        );
      }

      const bvhKey = artifactStorageKey(job.takeId, job.id, "result.bvh");
      const bvhFile = await this.storage.putText(bvhKey, bvh, "application/octet-stream");
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "bvh",
        storageKey: bvhFile.storageKey,
        fileSizeBytes: bvhFile.sizeBytes,
      });

      pipelineStages.push(
        buildMotionPipelineStage({
          stageName: "final_animation_export",
          status: "completed",
          reason: acceptedDualCameraFinal
            ? "Final BVH export was generated from the accepted optimized dual-camera solve."
            : primaryWhamFallbackUsed
              ? "Final BVH export was generated from the primary WHAM motion path."
              : "Final BVH export was generated from the WHAM motion path.",
          startedAtMs: finalAnimationStartedAt,
          completedAtMs: Date.now(),
          artifactRefs: {
            bvh: bvhKey,
            solved_motion_json: solvedKey,
            ...(optimizedSolvedMotionKey
              ? { optimized_solved_motion_json: optimizedSolvedMotionKey }
              : {}),
            ...(optimizedBvhKey ? { optimized_bvh: optimizedBvhKey } : {}),
          },
          finalAnimationSource: acceptedDualCameraFinal
            ? "true_dual_solve"
            : "primary_wham",
          warnings: allWarnings,
        }),
      );

      const quality = buildQualityReport(
        poseArtifact,
        finalSolved,
        cleanup,
        {
          ok: allErrors.length === 0,
          errors: allErrors,
          warnings: allWarnings,
          blenderOk: blender.ok,
          blenderSkipped: blender.skipped,
        },
        motionSource,
        {
          whamInputUsage,
          multiViewDiagnostic: qualityReportMultiViewDiagnostic,
        },
      );
      const qualityKey = artifactStorageKey(job.takeId, job.id, "quality_report.json");
      const qualityFile = await this.storage.putJson(qualityKey, quality);
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "quality_report_json",
        storageKey: qualityFile.storageKey,
        fileSizeBytes: qualityFile.sizeBytes,
      });

      pipelineStages.push(
        buildMotionPipelineStage({
          stageName: "quality_report",
          status: "completed",
          reason: "Quality report was generated with additive multi-view diagnostics when available.",
          artifactRefs: {
            quality_report_json: qualityKey,
          },
          warnings: quality.warnings,
        }),
      );

      const preview = buildPreviewSummary(finalSolved, quality, cleanup);
      const previewKey = artifactStorageKey(job.takeId, job.id, "preview_summary.json");
      const previewFile = await this.storage.putJson(previewKey, preview);
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "preview_summary_json",
        storageKey: previewFile.storageKey,
        fileSizeBytes: previewFile.sizeBytes,
      });

      const pipelineReport: MotionPipelineReport = {
        schema: "mocap.motion_pipeline_report.v1",
        takeId: job.takeId,
        jobId: job.id,
        profile: "wham_smpl_smplify_only",
        engines: {
          backendMotion: solved.solver
            ? `${solved.solver.name}@${solved.solver.version}`
            : `wham@${config.worker.whamSolverVersion}`,
          mobileCapture: "video_upload",
          smpl: "SMPL",
          smplify: solved.smpl?.smplify.enabled
            ? `enabled:${solved.smpl.smplify.status}`
            : "not_run",
          inputSource: motionSource,
          cleanup: "cleanup_quality_v1_5",
        },
        fallback: {
          motionFallbackUsed: acceptedDualCameraFinal
            ? false
            : primaryWhamFallbackUsed,
          reasons:
            acceptedDualCameraFinal || primaryWhamFallbackReason === "none"
              ? []
              : [primaryWhamFallbackReason],
        },
        runtime: {
          nodeEnv: config.nodeEnv,
          captureMode: take.captureMode,
          selectedVideoCount: sources.length,
          selectedPipelineBranch: pipelineBranch.kind,
          reconstructionBranchEntered,
          enableMultiViewReconstruction:
            config.worker.enableMultiViewReconstruction,
          allowPrimaryWhamFallback: config.worker.allowPrimaryWhamFallback,
        },
        finalAnimationSource: acceptedDualCameraFinal
          ? "true_dual_solve"
          : "primary_wham",
        artifacts: {
          smplParameters: smplParametersKey,
          rawSolvedMotion: rawSolvedKey,
          solvedMotion: solvedKey,
          cleanupReport: cleanupKey,
          qualityReport: qualityKey,
          previewSummary: previewKey,
          overlayPreview: overlayPreviewKey,
          bvh: bvhKey,
          optimizedSolvedMotion: optimizedSolvedMotionKey,
          optimizedBvh: optimizedBvhKey,
        },
        quality: {
          score: quality.score,
          grade: quality.grade,
          warnings: quality.warnings.slice(0, 12),
          errors: quality.errors,
        },
        stages: sortMotionPipelineStages(pipelineStages),
        whamInputUsage,
        createdAt: new Date().toISOString(),
      };
      const pipelineKey = artifactStorageKey(
        job.takeId,
        job.id,
        "motion_pipeline_report.json",
      );
      const pipelineFile = await this.storage.putJson(pipelineKey, pipelineReport);
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "motion_pipeline_report_json",
        storageKey: pipelineFile.storageKey,
        fileSizeBytes: pipelineFile.sizeBytes,
      });

      await this.jobs.updateState({
        jobId: job.id,
        state: "succeeded",
        progress: 100,
        message: "Backend motion export is ready.",
        metrics: {
          qualityScore: quality.score,
          blender,
          whamInputUsage,
          pipelineSelection,
          ...(captureMetadataDiagnostics ? { captureMetadataDiagnostics } : {}),
          ...(persistedMultiViewArtifacts.length
            ? { multiViewArtifacts: persistedMultiViewArtifacts }
            : {}),
          artifacts: {
            smplParameters: smplParametersKey,
            rawSolvedMotion: rawSolvedKey,
            solvedMotion: solvedKey,
            cleanupReport: cleanupKey,
            bvh: bvhKey,
            optimizedSolvedMotion: optimizedSolvedMotionKey,
            optimizedBvh: optimizedBvhKey,
            qualityReport: qualityKey,
            previewSummary: previewKey,
            overlayPreview: overlayPreviewKey,
            motionPipelineReport: pipelineKey,
          },
        },
      });
      await this.takes.updateStatus(job.userId, job.takeId, "processed");
      await Promise.all(
        captureSessionIds.map((captureSessionId) =>
          this.captureSessions.updateStatus(job.userId, captureSessionId, "completed"),
        ),
      );
    } catch (error) {
      const workerError =
        error instanceof WorkerProcessingError
          ? error
          : new WorkerProcessingError(
              error instanceof Error ? error.message : "Worker processing failed.",
            );
      await this.jobs.updateState({
        jobId: job.id,
        state: "failed",
        progress: 100,
        message: workerError.message,
        errorCode: workerError.code,
        metrics: workerError.details ?? null,
      });
      await this.takes.updateStatus(job.userId, job.takeId, "failed").catch(() => undefined);
      await Promise.all(
        captureSessionIds.map((captureSessionId) =>
          this.captureSessions
            .updateStatus(job.userId, captureSessionId, "failed")
            .catch(() => undefined),
        ),
      );
      throw workerError;
    } finally {
      await safeRm(dir);
    }
  }
}
