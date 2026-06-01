import type {
  CameraCalibrationArtifact,
  CalibrationObservationsArtifact,
  CaptureVolumeArtifact,
  MultiViewReconstructionArtifact,
  MultiViewSource,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  TriangulatedJointTrackArtifact,
  WorkerMultiViewErrorCode,
} from "../types";
import {
  type BuildCameraCalibrationInput,
  type CameraCalibrationDeviceInput,
  type CameraExtrinsicsInput,
  CameraCalibrationError,
  type CameraIntrinsicsInput,
  buildCameraCalibrationArtifact,
} from "./cameraCalibration";
import { buildCaptureVolumeArtifact } from "./captureVolume";
import {
  type DualReconstructionArtifact,
  type MultiViewReconstructionSummaryArtifact,
  buildDualReconstructionArtifacts,
} from "./dualReconstructionArtifacts";
import {
  type FrameSyncOptions,
  FrameSyncError,
  buildMultiViewSyncReport,
} from "./frameSync";
import {
  type MultiViewReconstructionOptions,
  MultiViewReconstructionError as MultiViewReconstructionBuilderError,
  buildMultiViewReconstructionArtifact,
  validateMultiViewReconstructionArtifact,
} from "./multiViewReconstruction";
import { buildTriangulatedJointTrackArtifact } from "./triangulatedJointTrack";
import {
  buildMissingPoseFramesArtifact,
  validatePerCameraPoseArtifact,
} from "../pose/poseExtraction";

export type WorkerPipelineBranch =
  | {
      kind: "single_camera_wham";
      primaryVideoUsed: true;
      additionalVideosProvided: 0;
      multiViewConstraintsUsed: false;
      reason: "solo_capture" | "single_selected_video";
    }
  | {
      kind: "primary_wham_fallback";
      primaryVideoUsed: true;
      additionalVideosProvided: number;
      multiViewConstraintsUsed: false;
      reason: "multi_view_feature_disabled";
    }
  | {
      kind: "multi_view_reconstruction";
      primaryVideoUsed: true;
      additionalVideosProvided: number;
      multiViewConstraintsUsed: false;
      reason: "multi_view_feature_enabled";
    }
  | {
      kind: "multi_view_disabled";
      primaryVideoUsed: false;
      additionalVideosProvided: number;
      multiViewConstraintsUsed: false;
      reason: "multi_view_feature_disabled_and_fallback_disallowed";
    };

export type ResolveWorkerPipelineBranchInput = {
  captureMode: "solo" | "dual" | "pro_4_camera";
  selectedVideoCount: number;
  enableMultiViewReconstruction: boolean;
  allowPrimaryWhamFallback: boolean;
};

export type MultiViewOrchestratorSource = {
  cameraId?: string;
  deviceId?: string;
  deviceIndex: number;
  deviceRole: string;
  videoStorageKey: string;
  normalizedStorageKey: string;
  normalizedPath: string;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  intrinsics?: CameraIntrinsicsInput | null;
  extrinsics?: CameraExtrinsicsInput | null;
  fovDegrees?: number;
  approxCameraAngleDegrees?: number;
};

export interface MultiViewPoseAdapter {
  name: string;
  version: string;
  extractPoseArtifacts(input: {
    takeId: string;
    jobId: string;
    processedSources: readonly MultiViewOrchestratorSource[];
    outputDir?: string;
  }): Promise<PerCameraPoseArtifact[]>;
}

export type RunMultiViewReconstructionInput = {
  takeId: string;
  jobId: string;
  source: MultiViewSource;
  processedSources: readonly MultiViewOrchestratorSource[];
  poseAdapter?: MultiViewPoseAdapter;
  outputDir?: string;
  syncOptions?: FrameSyncOptions;
  calibrationOptions?: Pick<
    BuildCameraCalibrationInput,
    "defaultFovDegrees" | "baselineMeters" | "qualityWarningThreshold"
  >;
  calibrationObservations?: CalibrationObservationsArtifact;
  calibrationArtifact?: CameraCalibrationArtifact;
  captureVolumeArtifact?: CaptureVolumeArtifact;
  reconstructionOptions?: MultiViewReconstructionOptions;
};

export type RunMultiViewReconstructionResult = {
  status: "succeeded";
  source: MultiViewSource;
  adapter: {
    name: string;
    version: string;
  };
  poseArtifacts: PerCameraPoseArtifact[];
  syncReport: MultiViewSyncReport;
  calibrationObservations?: CalibrationObservationsArtifact;
  calibrationArtifact: CameraCalibrationArtifact;
  captureVolumeArtifact: CaptureVolumeArtifact;
  reconstructionArtifact: MultiViewReconstructionArtifact;
  triangulatedJointTrackArtifact?: TriangulatedJointTrackArtifact;
  dualReconstructionArtifact?: DualReconstructionArtifact;
  multiViewReconstructionSummaryArtifact?: MultiViewReconstructionSummaryArtifact;
  diagnosticPoseFramesArtifact?: PoseFramesArtifact;
};

export type MultiViewStageFailureAction =
  | {
      action: "fallback_to_primary_wham";
      shouldContinueWithPrimaryWham: true;
      errorCode: WorkerMultiViewErrorCode;
      errorMessage: string;
    }
  | {
      action: "fail_job";
      shouldContinueWithPrimaryWham: false;
      errorCode: WorkerMultiViewErrorCode;
      errorMessage: string;
    };

export type RunMultiViewOrchestratorShellInput = {
  takeId: string;
  jobId: string;
  source: MultiViewSource;
  sources: readonly MultiViewOrchestratorSource[];
};

export type MultiViewOrchestratorShellResult = {
  status: "blocked";
  reason: "pose_detector_adapter_missing";
  source: MultiViewSource;
  sourceCount: number;
  primaryVideoUsed: false;
  additionalVideosProvided: number;
  multiViewConstraintsUsed: false;
};

export class MultiViewOrchestratorError extends Error {
  constructor(
    readonly code: Extract<
      WorkerMultiViewErrorCode,
      | "multi_view_pose_extraction_failed"
      | "multi_view_sync_failed"
      | "camera_calibration_failed"
      | "camera_projection_invalid"
      | "metadata_intrinsics_required"
      | "triangulation_failed"
      | "multi_view_reconstruction_invalid"
    >,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "MultiViewOrchestratorError";
  }
}

export function resolveWorkerPipelineBranch(
  input: ResolveWorkerPipelineBranchInput,
): WorkerPipelineBranch {
  if (input.captureMode === "solo") {
    return {
      kind: "single_camera_wham",
      primaryVideoUsed: true,
      additionalVideosProvided: 0,
      multiViewConstraintsUsed: false,
      reason: "solo_capture",
    };
  }
  if (input.selectedVideoCount <= 1) {
    return {
      kind: "single_camera_wham",
      primaryVideoUsed: true,
      additionalVideosProvided: 0,
      multiViewConstraintsUsed: false,
      reason: "single_selected_video",
    };
  }

  const additionalVideosProvided = input.selectedVideoCount - 1;
  if (input.enableMultiViewReconstruction) {
    return {
      kind: "multi_view_reconstruction",
      primaryVideoUsed: true,
      additionalVideosProvided,
      multiViewConstraintsUsed: false,
      reason: "multi_view_feature_enabled",
    };
  }
  if (input.allowPrimaryWhamFallback) {
    return {
      kind: "primary_wham_fallback",
      primaryVideoUsed: true,
      additionalVideosProvided,
      multiViewConstraintsUsed: false,
      reason: "multi_view_feature_disabled",
    };
  }
  return {
    kind: "multi_view_disabled",
    primaryVideoUsed: false,
    additionalVideosProvided,
    multiViewConstraintsUsed: false,
    reason: "multi_view_feature_disabled_and_fallback_disallowed",
  };
}

export function runMultiViewOrchestratorShell(
  input: RunMultiViewOrchestratorShellInput,
): MultiViewOrchestratorShellResult {
  if (input.sources.length < 2) {
    throw new Error("Multi-view reconstruction requires at least two sources.");
  }
  return {
    status: "blocked",
    reason: "pose_detector_adapter_missing",
    source: input.source,
    sourceCount: input.sources.length,
    primaryVideoUsed: false,
    additionalVideosProvided: input.sources.length - 1,
    multiViewConstraintsUsed: false,
  };
}

export async function runMultiViewReconstruction(
  input: RunMultiViewReconstructionInput,
): Promise<RunMultiViewReconstructionResult> {
  validateRunInput(input);
  if (!input.poseAdapter) {
    const poseArtifacts = buildMissingPoseArtifacts({
      input,
      reason: "Multi-view pose detector adapter is not configured.",
    });
    throw new MultiViewOrchestratorError(
      "multi_view_pose_extraction_failed",
      "Multi-view pose detector adapter is not configured.",
      { source: input.source, sourceCount: input.processedSources.length, poseArtifacts },
    );
  }

  const poseArtifacts = await extractPoseArtifacts(input);
  const syncReport = buildSyncReport({ input, poseArtifacts });
  const calibrationArtifact =
    input.calibrationArtifact ?? buildCalibrationArtifact(input);
  const captureVolumeArtifact =
    input.captureVolumeArtifact ??
    buildCaptureVolumeArtifact({
      takeId: input.takeId,
      jobId: input.jobId,
      calibrationArtifact,
    });
  const reconstructionArtifact = buildReconstructionArtifact({
    input,
    poseArtifacts,
    syncReport,
    calibrationArtifact,
  });
  const triangulatedJointTrackArtifact =
    input.source === "dual_camera"
      ? buildTriangulatedJointTrackArtifact({
          takeId: input.takeId,
          jobId: input.jobId,
          source: input.source,
          poseArtifacts,
          syncReport,
          cameraCalibration: calibrationArtifact,
          options: input.reconstructionOptions,
        })
      : undefined;
  const diagnosticArtifacts =
    input.source === "dual_camera"
      ? buildDualReconstructionArtifacts({
          takeId: input.takeId,
          jobId: input.jobId,
          poseArtifacts,
          syncReport,
          calibrationArtifact,
          artifactRefs: {
            dual_reconstruction_json: `takes/${input.takeId}/jobs/${input.jobId}/dual_reconstruction.json`,
            multi_view_reconstruction_json: `takes/${input.takeId}/jobs/${input.jobId}/multi_view_reconstruction.json`,
            pose_frames_json: `takes/${input.takeId}/jobs/${input.jobId}/pose_frames.json`,
          },
        })
      : undefined;
  const validation =
    validateMultiViewReconstructionArtifact(reconstructionArtifact);
  if (!validation.ok) {
    throw new MultiViewOrchestratorError(
      "multi_view_reconstruction_invalid",
      "Multi-view reconstruction artifact failed validation.",
      validation,
    );
  }

  return {
    status: "succeeded",
    source: input.source,
    adapter: {
      name: input.poseAdapter.name,
      version: input.poseAdapter.version,
    },
    poseArtifacts,
    syncReport,
    ...(input.calibrationObservations
      ? { calibrationObservations: input.calibrationObservations }
      : {}),
    calibrationArtifact,
    captureVolumeArtifact,
    reconstructionArtifact,
    ...(triangulatedJointTrackArtifact
      ? { triangulatedJointTrackArtifact }
      : {}),
    ...(diagnosticArtifacts
      ? {
          dualReconstructionArtifact: diagnosticArtifacts.dualReconstruction,
          multiViewReconstructionSummaryArtifact:
            diagnosticArtifacts.multiViewReconstruction,
          diagnosticPoseFramesArtifact: diagnosticArtifacts.diagnosticPoseFrames,
        }
      : {}),
  };
}

export function resolveMultiViewStageFailure(input: {
  error: unknown;
  allowPrimaryWhamFallback: boolean;
}): MultiViewStageFailureAction {
  const errorCode =
    input.error instanceof MultiViewOrchestratorError
      ? input.error.code
      : "multi_view_reconstruction_invalid";
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : "Multi-view reconstruction failed.";

  if (input.allowPrimaryWhamFallback) {
    return {
      action: "fallback_to_primary_wham",
      shouldContinueWithPrimaryWham: true,
      errorCode,
      errorMessage,
    };
  }
  return {
    action: "fail_job",
    shouldContinueWithPrimaryWham: false,
    errorCode,
    errorMessage,
  };
}

function validateRunInput(input: RunMultiViewReconstructionInput) {
  if (!input.takeId) {
    throw new MultiViewOrchestratorError(
      "multi_view_reconstruction_invalid",
      "takeId is required for multi-view reconstruction.",
    );
  }
  if (!input.jobId) {
    throw new MultiViewOrchestratorError(
      "multi_view_reconstruction_invalid",
      "jobId is required for multi-view reconstruction.",
    );
  }
  if (!["dual_camera", "multi_view"].includes(input.source)) {
    throw new MultiViewOrchestratorError(
      "multi_view_reconstruction_invalid",
      "source must be dual_camera or multi_view.",
    );
  }
  if (input.processedSources.length < 2) {
    throw new MultiViewOrchestratorError(
      "multi_view_reconstruction_invalid",
      "Multi-view reconstruction requires at least two processed sources.",
    );
  }
}

async function extractPoseArtifacts(
  input: RunMultiViewReconstructionInput,
): Promise<PerCameraPoseArtifact[]> {
  if (!input.poseAdapter) {
    const poseArtifacts = buildMissingPoseArtifacts({
      input,
      reason: "Multi-view pose detector adapter is not configured.",
    });
    throw new MultiViewOrchestratorError(
      "multi_view_pose_extraction_failed",
      "Multi-view pose detector adapter is not configured.",
      { source: input.source, sourceCount: input.processedSources.length, poseArtifacts },
    );
  }
  let poseArtifacts: PerCameraPoseArtifact[];
  try {
    poseArtifacts = await input.poseAdapter.extractPoseArtifacts({
      takeId: input.takeId,
      jobId: input.jobId,
      processedSources: input.processedSources,
      outputDir: input.outputDir,
    });
  } catch (error) {
    const poseArtifacts = buildMissingPoseArtifacts({
      input,
      reason:
        error instanceof Error
          ? error.message
          : "Multi-view pose detector adapter failed.",
    });
    throw new MultiViewOrchestratorError(
      "multi_view_pose_extraction_failed",
      error instanceof Error
        ? error.message
        : "Multi-view pose detector adapter failed.",
      { source: input.source, sourceCount: input.processedSources.length, poseArtifacts, cause: error },
    );
  }

  validateAdapterPoseArtifacts({ input, poseArtifacts });
  return poseArtifacts;
}

function validateAdapterPoseArtifacts(input: {
  input: RunMultiViewReconstructionInput;
  poseArtifacts: readonly PerCameraPoseArtifact[];
}) {
  if (input.poseArtifacts.length < 2) {
    throw new MultiViewOrchestratorError(
      "multi_view_pose_extraction_failed",
      "Pose adapter must return at least two per-camera pose artifacts.",
    );
  }
  const sourceDeviceIndexes = new Set(
    input.input.processedSources.map((source) => source.deviceIndex),
  );
  const seenDeviceIndexes = new Set<number>();
  for (const artifact of input.poseArtifacts) {
    const validation = validatePerCameraPoseArtifact(artifact);
    if (!validation.ok) {
      throw new MultiViewOrchestratorError(
        "multi_view_pose_extraction_failed",
        "Pose adapter returned an invalid per-camera pose artifact.",
        validation,
      );
    }
    if (artifact.takeId !== input.input.takeId || artifact.jobId !== input.input.jobId) {
      throw new MultiViewOrchestratorError(
        "multi_view_pose_extraction_failed",
        "Pose adapter returned an artifact for a different take or job.",
      );
    }
    if (seenDeviceIndexes.has(artifact.deviceIndex)) {
      throw new MultiViewOrchestratorError(
        "multi_view_pose_extraction_failed",
        `Pose adapter returned duplicate deviceIndex ${artifact.deviceIndex}.`,
      );
    }
    seenDeviceIndexes.add(artifact.deviceIndex);
    if (!sourceDeviceIndexes.has(artifact.deviceIndex)) {
      throw new MultiViewOrchestratorError(
        "multi_view_pose_extraction_failed",
        `Pose adapter returned unselected deviceIndex ${artifact.deviceIndex}.`,
      );
    }
  }
  for (const source of input.input.processedSources) {
    if (!seenDeviceIndexes.has(source.deviceIndex)) {
      throw new MultiViewOrchestratorError(
        "multi_view_pose_extraction_failed",
        `Pose adapter did not return deviceIndex ${source.deviceIndex}.`,
      );
    }
  }
  const missingPoseArtifacts = input.poseArtifacts.filter(
    (artifact) =>
      artifact.status === "missing_pose_frames" ||
      artifact.quality.detectedFrameCount === 0,
  );
  if (missingPoseArtifacts.length > 0) {
    const missingReasons = Array.from(
      new Set(
        missingPoseArtifacts
          .map((artifact) => artifact.reason)
          .filter((reason): reason is string => Boolean(reason)),
      ),
    );
    throw new MultiViewOrchestratorError(
      "multi_view_pose_extraction_failed",
      missingReasons.length
        ? `Multi-view pose extraction produced no usable 2D keypoints for at least one selected camera: ${missingReasons.join("; ")}`
        : "Multi-view pose extraction produced no usable 2D keypoints for at least one selected camera.",
      {
        source: input.input.source,
        sourceCount: input.input.processedSources.length,
        missingDeviceIndexes: missingPoseArtifacts.map(
          (artifact) => artifact.deviceIndex,
        ),
        poseArtifacts: input.poseArtifacts,
      },
    );
  }
}

function buildMissingPoseArtifacts(input: {
  input: RunMultiViewReconstructionInput;
  reason: string;
}): PerCameraPoseArtifact[] {
  return input.input.processedSources.map((source) =>
    buildMissingPoseFramesArtifact({
      takeId: input.input.takeId,
      jobId: input.input.jobId,
      cameraId: source.cameraId ?? `device_${source.deviceIndex}`,
      deviceIndex: source.deviceIndex,
      deviceRole: source.deviceRole,
      sourceVideo: {
        storageKey: source.videoStorageKey,
        normalizedStorageKey: source.normalizedStorageKey,
        fps: source.fps,
        width: source.width,
        height: source.height,
        durationMs: source.durationMs,
      },
      detectorSource: "unavailable",
      reason: input.reason,
    }),
  );
}

function buildSyncReport(input: {
  input: RunMultiViewReconstructionInput;
  poseArtifacts: readonly PerCameraPoseArtifact[];
}) {
  try {
    const report = buildMultiViewSyncReport({
      poseArtifacts: input.poseArtifacts,
      options: input.input.syncOptions,
    });
    if (report.status === "failed") {
      throw new FrameSyncError(
        "multi_view_sync_failed",
        "Multi-view frame sync failed.",
      );
    }
    return report;
  } catch (error) {
    if (error instanceof FrameSyncError) {
      throw new MultiViewOrchestratorError(
        "multi_view_sync_failed",
        error.message,
      );
    }
    throw error;
  }
}

function buildCalibrationArtifact(
  input: RunMultiViewReconstructionInput,
): CameraCalibrationArtifact {
  try {
    return buildCameraCalibrationArtifact({
      takeId: input.takeId,
      jobId: input.jobId,
      devices: input.processedSources.map(sourceToCalibrationDevice),
      calibrationObservations: input.calibrationObservations,
      ...input.calibrationOptions,
    });
  } catch (error) {
    if (error instanceof CameraCalibrationError) {
      throw new MultiViewOrchestratorError(error.code, error.message);
    }
    throw error;
  }
}

function sourceToCalibrationDevice(
  source: MultiViewOrchestratorSource,
): CameraCalibrationDeviceInput {
  return {
    cameraId: source.cameraId,
    deviceId: source.deviceId,
    deviceIndex: source.deviceIndex,
    deviceRole: source.deviceRole,
    imageWidth: source.width,
    imageHeight: source.height,
    intrinsics: source.intrinsics,
    extrinsics: source.extrinsics,
    fovDegrees: source.fovDegrees,
    approxCameraAngleDegrees: source.approxCameraAngleDegrees,
  };
}

function buildReconstructionArtifact(input: {
  input: RunMultiViewReconstructionInput;
  poseArtifacts: readonly PerCameraPoseArtifact[];
  syncReport: MultiViewSyncReport;
  calibrationArtifact: CameraCalibrationArtifact;
}) {
  try {
    return buildMultiViewReconstructionArtifact({
      poseArtifacts: input.poseArtifacts,
      syncReport: input.syncReport,
      calibrationArtifact: input.calibrationArtifact,
      source: input.input.source,
      options: input.input.reconstructionOptions,
    });
  } catch (error) {
    if (error instanceof MultiViewReconstructionBuilderError) {
      throw new MultiViewOrchestratorError(error.code, error.message);
    }
    throw error;
  }
}
