import type {
  CameraCalibrationArtifact,
  CalibrationObservationsArtifact,
  CaptureVolumeArtifact,
  DualFitReportArtifact,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
  PoseFramesArtifact,
  SmplParametersArtifact,
  SolvedMotionArtifact,
  TriangulatedJointTrackArtifact,
} from "../types";
import type {
  DualReconstructionArtifact,
  MultiViewReconstructionSummaryArtifact,
} from "./dualReconstructionArtifacts";

export type PersistMultiViewArtifactSource =
  | "dual_camera"
  | "multi_view"
  | "pro_4_camera";

export type MultiViewArtifactFormat =
  | "pose_frames_device_json"
  | "pose_frames_json"
  | "calibration_observations_json"
  | "capture_volume_json"
  | "camera_calibration_json"
  | "multi_view_sync_json"
  | "triangulated_joint_track_json"
  | "dual_fit_report_json"
  | "optimized_solved_motion_json"
  | "optimized_smpl_parameters_json"
  | "dual_reconstruction_json"
  | "multi_view_reconstruction_json";

export interface PersistedMultiViewArtifact {
  format: MultiViewArtifactFormat;
  artifactName: string;
  storageKey: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface PersistMultiViewArtifactsInput {
  takeId: string;
  jobId: string;
  source: PersistMultiViewArtifactSource;
  poseArtifacts?: readonly PerCameraPoseArtifact[];
  syncReport?: MultiViewSyncReport;
  calibrationObservations?: CalibrationObservationsArtifact;
  cameraCalibration?: CameraCalibrationArtifact;
  captureVolume?: CaptureVolumeArtifact;
  reconstruction?: MultiViewReconstructionArtifact;
  triangulatedJointTrack?: TriangulatedJointTrackArtifact;
  dualFitReport?: DualFitReportArtifact;
  optimizedSolvedMotion?: SolvedMotionArtifact;
  optimizedSmplParameters?: SmplParametersArtifact;
  dualReconstruction?: DualReconstructionArtifact;
  multiViewReconstruction?: MultiViewReconstructionSummaryArtifact;
  diagnosticPoseFrames?: PoseFramesArtifact;
  storage: {
    uploadJson: (
      key: string,
      value: unknown,
    ) => Promise<{ storageKey?: string; sizeBytes?: number | null } | void>;
  };
  exportsRepository: {
    createExportFile: (input: {
      jobId: string;
      format: MultiViewArtifactFormat;
      artifactName: string;
      storageKey: string;
      sizeBytes: number;
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

export interface PersistMultiViewArtifactsResult {
  artifacts: PersistedMultiViewArtifact[];
  warnings: string[];
}

type ArtifactCandidate = {
  format: MultiViewArtifactFormat;
  artifactName: string;
  storageKey: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
};

export async function persistMultiViewArtifacts(
  input: PersistMultiViewArtifactsInput,
): Promise<PersistMultiViewArtifactsResult> {
  const candidates = buildMultiViewArtifactCandidates(input);
  const artifacts: PersistedMultiViewArtifact[] = [];

  for (const candidate of candidates) {
    const uploadResult = await input.storage.uploadJson(
      candidate.storageKey,
      candidate.payload,
    );
    const storageKey = uploadResult?.storageKey ?? candidate.storageKey;
    const sizeBytes =
      typeof uploadResult?.sizeBytes === "number" &&
      Number.isFinite(uploadResult.sizeBytes)
        ? uploadResult.sizeBytes
        : jsonSizeBytes(candidate.payload);
    const persisted: PersistedMultiViewArtifact = {
      format: candidate.format,
      artifactName: candidate.artifactName,
      storageKey,
      sizeBytes,
      ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
    };

    await input.exportsRepository.createExportFile({
      jobId: input.jobId,
      format: persisted.format,
      artifactName: persisted.artifactName,
      storageKey: persisted.storageKey,
      sizeBytes: persisted.sizeBytes,
      ...(persisted.metadata ? { metadata: persisted.metadata } : {}),
    });
    artifacts.push(persisted);
  }

  return {
    artifacts,
    warnings:
      artifacts.length === 0
        ? ["No multi-view artifacts were provided for persistence."]
        : [],
  };
}

export function buildMultiViewArtifactCandidates(input: {
  takeId: string;
  jobId: string;
  source: PersistMultiViewArtifactSource;
  poseArtifacts?: readonly PerCameraPoseArtifact[];
  syncReport?: MultiViewSyncReport;
  calibrationObservations?: CalibrationObservationsArtifact;
  cameraCalibration?: CameraCalibrationArtifact;
  captureVolume?: CaptureVolumeArtifact;
  reconstruction?: MultiViewReconstructionArtifact;
  triangulatedJointTrack?: TriangulatedJointTrackArtifact;
  dualFitReport?: DualFitReportArtifact;
  optimizedSolvedMotion?: SolvedMotionArtifact;
  optimizedSmplParameters?: SmplParametersArtifact;
  dualReconstruction?: DualReconstructionArtifact;
  multiViewReconstruction?: MultiViewReconstructionSummaryArtifact;
  diagnosticPoseFrames?: PoseFramesArtifact;
}): ArtifactCandidate[] {
  const candidates: ArtifactCandidate[] = [];

  for (const artifact of input.poseArtifacts ?? []) {
    candidates.push({
      format: "pose_frames_device_json",
      artifactName: poseArtifactName(artifact.deviceIndex),
      storageKey: poseArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        deviceIndex: artifact.deviceIndex,
      }),
      payload: artifact,
      metadata: {
        deviceIndex: artifact.deviceIndex,
        deviceRole: artifact.deviceRole,
        detectorName: artifact.detector.name,
        detectorSource: artifact.detectorSource,
        status: artifact.status,
        reason: artifact.reason,
        frameCount: artifact.quality.frameCount,
        detectedFrameCount: artifact.quality.detectedFrameCount,
        averageConfidence: artifact.averageConfidence,
      },
    });
  }

  if (input.syncReport) {
    candidates.push({
      format: "multi_view_sync_json",
      artifactName: "multi_view_sync_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "multi_view_sync.json",
      }),
      payload: input.syncReport,
      metadata: {
        syncMethod: input.syncReport.syncMethod,
        status: input.syncReport.status,
        matchedFrameCount: input.syncReport.metrics.matchedFrameCount,
        droppedFrameCount: input.syncReport.metrics.droppedFrameCount,
        averageTimeDeltaMs: input.syncReport.metrics.averageTimeDeltaMs,
        p95TimeDeltaMs: input.syncReport.metrics.p95TimeDeltaMs,
        syncConfidence: input.syncReport.metrics.syncConfidence,
      },
    });
  }

  if (input.calibrationObservations) {
    candidates.push({
      format: "calibration_observations_json",
      artifactName: "calibration_observations_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "calibration_observations.json",
      }),
      payload: input.calibrationObservations,
      metadata: {
        targetType: input.calibrationObservations.targetType,
        detectorSource: input.calibrationObservations.detectorSource,
        status: input.calibrationObservations.status,
        observationCount: input.calibrationObservations.frames.reduce(
          (sum, frame) => sum + frame.observations.length,
          0,
        ),
        averageConfidence: averageConfidence(input.calibrationObservations),
      },
    });
  }

  if (input.cameraCalibration) {
    candidates.push({
      format: "camera_calibration_json",
      artifactName: "camera_calibration_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "camera_calibration.json",
      }),
      payload: input.cameraCalibration,
      metadata: {
        calibrationQualityScore: input.cameraCalibration.quality.score,
        intrinsicsFallbackUsed: input.cameraCalibration.devices.some(
          (device) => device.intrinsicsSource === "fov_fallback",
        )
          ? 1
          : 0,
      },
    });
  }

  if (input.captureVolume) {
    candidates.push({
      format: "capture_volume_json",
      artifactName: "capture_volume_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "capture_volume.json",
      }),
      payload: input.captureVolume,
      metadata: {
        status: input.captureVolume.status,
        validCameraCount: input.captureVolume.validCameraCount,
        baselineEstimate: input.captureVolume.baselineEstimate,
      },
    });
  }

  if (input.triangulatedJointTrack) {
    candidates.push({
      format: "triangulated_joint_track_json",
      artifactName: "triangulated_joint_track_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "triangulated_joint_track.json",
      }),
      payload: input.triangulatedJointTrack,
      metadata: {
        status: input.triangulatedJointTrack.status,
        frameCount: input.triangulatedJointTrack.frameCount,
        trackedFrameCount: input.triangulatedJointTrack.trackedFrameCount,
        matchedFrameCount:
          input.triangulatedJointTrack.metrics.matchedFrameCount,
        triangulatedJointRatio:
          input.triangulatedJointTrack.metrics.triangulatedJointRatio,
        averageReprojectionErrorPx:
          input.triangulatedJointTrack.metrics.averageReprojectionErrorPx,
        reprojectionP95Px:
          input.triangulatedJointTrack.metrics.reprojectionP95Px,
        temporalJitterAfter:
          input.triangulatedJointTrack.metrics.temporalJitterAfter,
      },
    });
  }

  if (input.dualFitReport) {
    candidates.push({
      format: "dual_fit_report_json",
      artifactName: "dual_fit_report_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "dual_fit_report.json",
      }),
      payload: input.dualFitReport,
      metadata: {
        status: input.dualFitReport.status,
        acceptedAsFinalAnimation: input.dualFitReport.acceptedAsFinalAnimation,
        finalAnimationSourceCandidate:
          input.dualFitReport.finalAnimationSourceCandidate,
        failedGateCount: input.dualFitReport.qualityGates.filter(
          (gate) => !gate.passed,
        ).length,
        blockingFailedGateCount: input.dualFitReport.qualityGates.filter(
          (gate) => !gate.passed && gate.severity === "blocking",
        ).length,
        triangulatedJointRatio:
          input.dualFitReport.metrics.triangulatedJointRatio,
        reprojectionErrorPx:
          input.dualFitReport.metrics.averageReprojectionErrorPxBefore,
        temporalJitterAfter:
          input.dualFitReport.metrics.temporalJitterAfter,
      },
    });
  }

  if (input.optimizedSolvedMotion) {
    candidates.push({
      format: "optimized_solved_motion_json",
      artifactName: "optimized_solved_motion_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "optimized_solved_motion.json",
      }),
      payload: input.optimizedSolvedMotion,
      metadata: {
        frameCount: input.optimizedSolvedMotion.frameCount,
        fps: input.optimizedSolvedMotion.fps,
        optimizedFrom: input.optimizedSolvedMotion.optimizedFrom?.source,
        method: input.optimizedSolvedMotion.optimizedFrom?.method,
        acceptedAsFinalAnimation:
          input.optimizedSolvedMotion.optimizedFrom?.acceptedAsFinalAnimation,
      },
    });
  }

  if (input.optimizedSmplParameters) {
    candidates.push({
      format: "optimized_smpl_parameters_json",
      artifactName: "optimized_smpl_parameters_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "optimized_smpl_parameters.json",
      }),
      payload: input.optimizedSmplParameters,
      metadata: {
        frameCount: input.optimizedSmplParameters.frameCount,
        source: input.optimizedSmplParameters.source,
      },
    });
  }

  if (input.dualReconstruction) {
    candidates.push({
      format: "dual_reconstruction_json",
      artifactName: "dual_reconstruction_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "dual_reconstruction.json",
      }),
      payload: input.dualReconstruction,
      metadata: {
        status: input.dualReconstruction.status,
        matchedFrameCount: input.dualReconstruction.matchedFrameCount,
        triangulatedFrameCount: input.dualReconstruction.triangulatedFrameCount,
        reprojectionErrorPx:
          input.dualReconstruction.averageReprojectionErrorPx,
        reprojectionP95Px: input.dualReconstruction.reprojectionP95Px,
        triangulatedLandmarkRatio:
          input.dualReconstruction.triangulatedLandmarkRatio,
        fallbackLandmarkRatio: input.dualReconstruction.fallbackLandmarkRatio,
        calibrationQualityScore:
          input.dualReconstruction.calibrationQualityScore,
        syncConfidence: input.dualReconstruction.syncConfidence,
      },
    });
  }

  if (input.multiViewReconstruction) {
    candidates.push({
      format: "multi_view_reconstruction_json",
      artifactName: "multi_view_reconstruction_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "multi_view_reconstruction.json",
      }),
      payload: input.multiViewReconstruction,
      metadata: {
        status: input.multiViewReconstruction.status,
        reconstructionMode: input.multiViewReconstruction.reconstructionMode,
        reconstructionSource:
          input.multiViewReconstruction.reconstructionSource,
        matchedFrameCount:
          input.multiViewReconstruction.syncSummary.matchedFrameCount,
        triangulatedLandmarkRatio:
          input.multiViewReconstruction.triangulationSummary
            .triangulatedLandmarkRatio,
        calibrationQualityScore:
          input.multiViewReconstruction.calibrationSummary
            .calibrationQualityScore,
      },
    });
  }

  if (input.diagnosticPoseFrames) {
    candidates.push({
      format: "pose_frames_json",
      artifactName: "pose_frames_json",
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName: "pose_frames.json",
      }),
      payload: input.diagnosticPoseFrames,
      metadata: {
        detectorName: input.diagnosticPoseFrames.detector.name,
        detectorVersion: input.diagnosticPoseFrames.detector.version,
        frameCount: input.diagnosticPoseFrames.quality.frameCount,
        detectedFrameCount: input.diagnosticPoseFrames.quality.detectedFrameCount,
        averagePoseConfidence:
          input.diagnosticPoseFrames.quality.averagePoseConfidence,
        diagnosticOnly: true,
      },
    });
  }

  if (
    input.reconstruction &&
    !input.dualReconstruction &&
    !input.multiViewReconstruction
  ) {
    const reconstructionFormat = reconstructionArtifactFormat(input.source);
    candidates.push({
      format: reconstructionFormat,
      artifactName: reconstructionFormat,
      storageKey: multiViewArtifactStorageKey({
        takeId: input.takeId,
        jobId: input.jobId,
        fileName:
          reconstructionFormat === "dual_reconstruction_json"
            ? "dual_reconstruction.json"
            : "multi_view_reconstruction.json",
      }),
      payload: input.reconstruction,
      metadata: {
        matchedFrameCount: input.reconstruction.metrics.matchedFrameCount,
        reprojectionErrorPx: input.reconstruction.metrics.reprojectionErrorPx,
        reprojectionP95Px: input.reconstruction.metrics.reprojectionP95Px,
        triangulatedLandmarkRatio:
          input.reconstruction.metrics.triangulatedLandmarkRatio,
        fallbackLandmarkRatio: input.reconstruction.metrics.fallbackLandmarkRatio,
        calibrationQualityScore:
          input.reconstruction.metrics.calibrationQualityScore,
      },
    });
  }

  return candidates;
}

export function poseArtifactStorageKey(input: {
  takeId: string;
  jobId: string;
  deviceIndex: number;
}) {
  return multiViewArtifactStorageKey({
    takeId: input.takeId,
    jobId: input.jobId,
    fileName: `pose_frames_device_${input.deviceIndex}.json`,
  });
}

export function multiViewArtifactStorageKey(input: {
  takeId: string;
  jobId: string;
  fileName: string;
}) {
  return `takes/${input.takeId}/jobs/${input.jobId}/${input.fileName}`;
}

function poseArtifactName(deviceIndex: number) {
  return `pose_frames_device_${deviceIndex}_json`;
}

function reconstructionArtifactFormat(
  source: PersistMultiViewArtifactSource,
): Extract<
  MultiViewArtifactFormat,
  "dual_reconstruction_json" | "multi_view_reconstruction_json"
> {
  return source === "dual_camera"
    ? "dual_reconstruction_json"
    : "multi_view_reconstruction_json";
}

function jsonSizeBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

function averageConfidence(artifact: CalibrationObservationsArtifact) {
  const confidences = artifact.frames.flatMap((frame) =>
    frame.observations.map((observation) => observation.confidence),
  );
  return confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
}
