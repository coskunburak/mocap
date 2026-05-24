import type {
  CameraCalibrationArtifact,
  MultiViewReconstructionArtifact,
  MultiViewSyncReport,
  PerCameraPoseArtifact,
} from "../types";

export type PersistMultiViewArtifactSource =
  | "dual_camera"
  | "multi_view"
  | "pro_4_camera";

export type MultiViewArtifactFormat =
  | "pose_frames_device_json"
  | "camera_calibration_json"
  | "multi_view_sync_json"
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
  cameraCalibration?: CameraCalibrationArtifact;
  reconstruction?: MultiViewReconstructionArtifact;
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
  cameraCalibration?: CameraCalibrationArtifact;
  reconstruction?: MultiViewReconstructionArtifact;
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
        frameCount: artifact.quality.frameCount,
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
        matchedFrameCount: input.syncReport.metrics.matchedFrameCount,
        droppedFrameCount: input.syncReport.metrics.droppedFrameCount,
        averageTimeDeltaMs: input.syncReport.metrics.averageTimeDeltaMs,
        syncConfidence: input.syncReport.metrics.syncConfidence,
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

  if (input.reconstruction) {
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
