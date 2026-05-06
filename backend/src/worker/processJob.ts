import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { config } from "../config";
import type { CaptureVideo, ProcessingJob } from "../domain/types";
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
  validateBvhText,
  validateSolvedMotion,
} from "./export/exportValidation";
import { solveMotion } from "./export/solveMotion";
import { detectPoseFrames } from "./pose/poseDetector";
import { reconstructDualCameraPose } from "./reconstruction/dualCameraReconstruction";
import { reconstructMultiViewPose } from "./reconstruction/multiViewReconstruction";
import { normalizeVideo, probeVideo } from "./video/videoPipeline";
import type {
  DualCameraReconstructionArtifact,
  MultiViewReconstructionArtifact,
  PoseFramesArtifact,
} from "./types";

type Deps = {
  jobs?: JobRepository;
  takes?: TakeRepository;
  captureSessions?: CaptureSessionRepository;
  uploads?: UploadRepository;
  exports?: ExportRepository;
  storage?: ObjectStorage;
};

type ProcessedSource = {
  video: CaptureVideo;
  inputPath: string;
  normalizedPath: string;
  normalizedKey: string;
  normalizedProbe: Awaited<ReturnType<typeof probeVideo>>;
  poseArtifact: PoseFramesArtifact;
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

async function safeRm(dir: string) {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export class WorkerJobProcessor {
  private readonly jobs: JobRepository;
  private readonly takes: TakeRepository;
  private readonly captureSessions: CaptureSessionRepository;
  private readonly uploads: UploadRepository;
  private readonly exports: ExportRepository;
  private readonly storage: ObjectStorage;

  constructor(deps: Deps = {}) {
    this.jobs = deps.jobs ?? new JobRepository();
    this.takes = deps.takes ?? new TakeRepository();
    this.captureSessions = deps.captureSessions ?? new CaptureSessionRepository();
    this.uploads = deps.uploads ?? new UploadRepository();
    this.exports = deps.exports ?? new ExportRepository();
    this.storage = deps.storage ?? new ObjectStorage();
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
      const useDualReconstruction = take.captureMode === "dual" && uploadedSources.length >= 2;
      const useMultiViewReconstruction =
        take.captureMode === "pro_4_camera" && uploadedSources.length >= 4;
      const usesMultiSourceReconstruction = useDualReconstruction || useMultiViewReconstruction;
      const sources = useMultiViewReconstruction
        ? uploadedSources.slice(0, 4)
        : useDualReconstruction
          ? uploadedSources.slice(0, 2)
          : uploadedSources.slice(0, 1);
      const processedSources: ProcessedSource[] = [];

      await this.jobs.updateState({
        jobId: job.id,
        state: "ingesting",
        progress: 10,
        message: useMultiViewReconstruction
          ? "Downloading pro multi-view source videos."
          : useDualReconstruction
            ? "Downloading dual-camera source videos."
            : "Downloading source video.",
        metrics: {
          captureMode: take.captureMode,
          sourceCount: sources.length,
          videoStorageKeys: sources.map((source) => source.videoStorageKey),
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
          progress: usesMultiSourceReconstruction ? 18 + source.deviceIndex * 4 : 25,
          message: `Normalizing device ${source.deviceIndex} video.`,
          metrics: {
            deviceIndex: source.deviceIndex,
            probe: originalProbe,
          },
        });

        const normalizedPath = path.join(deviceDir, "normalized.mp4");
        const normalizedProbe = await normalizeVideo(inputPath, normalizedPath);
        const normalizedKey = artifactStorageKey(
          job.takeId,
          job.id,
          usesMultiSourceReconstruction
            ? `normalized/device_${source.deviceIndex}.mp4`
            : "normalized.mp4",
        );
        await this.storage.putFile({
          storageKey: normalizedKey,
          filePath: normalizedPath,
          contentType: "video/mp4",
        });

        await this.jobs.updateState({
          jobId: job.id,
          state: "detecting_pose",
          progress: usesMultiSourceReconstruction ? 34 + source.deviceIndex * 6 : 45,
          message: `Detecting body landmarks for device ${source.deviceIndex}.`,
          metrics: {
            deviceIndex: source.deviceIndex,
            probe: normalizedProbe,
          },
        });

        const cameraPoseArtifact = await detectPoseFrames({
          takeId: job.takeId,
          jobId: job.id,
          normalizedVideoPath: normalizedPath,
          sourceStorageKey: source.videoStorageKey,
          normalizedStorageKey: normalizedKey,
          outputDir: deviceDir,
          sourceVideo: {
            storageKey: source.videoStorageKey,
            normalizedStorageKey: normalizedKey,
            fps: normalizedProbe.fps,
            width: normalizedProbe.width,
            height: normalizedProbe.height,
            durationMs: normalizedProbe.durationMs,
          },
        });
        if (cameraPoseArtifact.quality.detectedFrameCount === 0) {
          throw new WorkerProcessingError(
            `No body was detected in device ${source.deviceIndex} video.`,
            "pose_not_detected",
            {
              deviceIndex: source.deviceIndex,
              quality: cameraPoseArtifact.quality,
            },
          );
        }
        const cameraPoseKey = artifactStorageKey(
          job.takeId,
          job.id,
          usesMultiSourceReconstruction
            ? `pose_frames_device_${source.deviceIndex}.json`
            : "pose_frames.json",
        );
        const cameraPoseFile = await this.storage.putJson(cameraPoseKey, cameraPoseArtifact);
        await this.exports.create({
          userId: job.userId,
          projectId: job.projectId,
          takeId: job.takeId,
          jobId: job.id,
          preset: job.preset,
          format: usesMultiSourceReconstruction
            ? `pose_frames_device_${source.deviceIndex}_json`
            : "pose_frames_json",
          storageKey: cameraPoseFile.storageKey,
          fileSizeBytes: cameraPoseFile.sizeBytes,
        });
        processedSources.push({
          video: source,
          inputPath,
          normalizedPath,
          normalizedKey,
          normalizedProbe,
          poseArtifact: cameraPoseArtifact,
        });
      }

      let poseArtifact = processedSources[0].poseArtifact;
      let poseKey = artifactStorageKey(job.takeId, job.id, "pose_frames.json");
      let reconstruction:
        | DualCameraReconstructionArtifact
        | MultiViewReconstructionArtifact
        | undefined;
      let reconstructionKey: string | undefined;
      if (useMultiViewReconstruction) {
        await this.jobs.updateState({
          jobId: job.id,
          state: "solving_motion",
          progress: 60,
          message: "Synchronizing and reconstructing pro multi-view pose.",
          metrics: {
            sourceDeviceIndices: processedSources.map((source) => source.video.deviceIndex),
          },
        });
        const multiView = await reconstructMultiViewPose({
          takeId: job.takeId,
          jobId: job.id,
          cameras: processedSources.map((source) => ({
            video: source.video,
            inputPath: source.inputPath,
            normalizedStorageKey: source.normalizedKey,
            probe: source.normalizedProbe,
            pose: source.poseArtifact,
          })),
          outputDir: path.join(dir, "multi_view_sync"),
        });
        poseArtifact = multiView.poseArtifact;
        reconstruction = multiView.reconstruction;
        const multiPoseFile = await this.storage.putJson(poseKey, poseArtifact);
        await this.exports.create({
          userId: job.userId,
          projectId: job.projectId,
          takeId: job.takeId,
          jobId: job.id,
          preset: job.preset,
          format: "pose_frames_json",
          storageKey: multiPoseFile.storageKey,
          fileSizeBytes: multiPoseFile.sizeBytes,
        });
        reconstructionKey = artifactStorageKey(
          job.takeId,
          job.id,
          "multi_view_reconstruction.json",
        );
        const reconstructionFile = await this.storage.putJson(
          reconstructionKey,
          reconstruction,
        );
        await this.exports.create({
          userId: job.userId,
          projectId: job.projectId,
          takeId: job.takeId,
          jobId: job.id,
          preset: job.preset,
          format: "multi_view_reconstruction_json",
          storageKey: reconstructionFile.storageKey,
          fileSizeBytes: reconstructionFile.sizeBytes,
        });
      } else if (useDualReconstruction) {
        await this.jobs.updateState({
          jobId: job.id,
          state: "solving_motion",
          progress: 60,
          message: "Synchronizing and triangulating dual-camera pose.",
          metrics: {
            primaryDeviceIndex: processedSources[0].video.deviceIndex,
            secondaryDeviceIndex: processedSources[1].video.deviceIndex,
          },
        });
        const dual = await reconstructDualCameraPose({
          takeId: job.takeId,
          jobId: job.id,
          primary: {
            video: processedSources[0].video,
            inputPath: processedSources[0].inputPath,
            normalizedStorageKey: processedSources[0].normalizedKey,
            probe: processedSources[0].normalizedProbe,
            pose: processedSources[0].poseArtifact,
          },
          secondary: {
            video: processedSources[1].video,
            inputPath: processedSources[1].inputPath,
            normalizedStorageKey: processedSources[1].normalizedKey,
            probe: processedSources[1].normalizedProbe,
            pose: processedSources[1].poseArtifact,
          },
          outputDir: path.join(dir, "dual_sync"),
        });
        poseArtifact = dual.poseArtifact;
        reconstruction = dual.reconstruction;
        const dualPoseFile = await this.storage.putJson(poseKey, poseArtifact);
        await this.exports.create({
          userId: job.userId,
          projectId: job.projectId,
          takeId: job.takeId,
          jobId: job.id,
          preset: job.preset,
          format: "pose_frames_json",
          storageKey: dualPoseFile.storageKey,
          fileSizeBytes: dualPoseFile.sizeBytes,
        });
        reconstructionKey = artifactStorageKey(
          job.takeId,
          job.id,
          "dual_reconstruction.json",
        );
        const reconstructionFile = await this.storage.putJson(
          reconstructionKey,
          reconstruction,
        );
        await this.exports.create({
          userId: job.userId,
          projectId: job.projectId,
          takeId: job.takeId,
          jobId: job.id,
          preset: job.preset,
          format: "dual_reconstruction_json",
          storageKey: reconstructionFile.storageKey,
          fileSizeBytes: reconstructionFile.sizeBytes,
        });
      }

      if (poseArtifact.quality.detectedFrameCount === 0) {
        throw new WorkerProcessingError(
          "No body was detected in the uploaded video.",
          "pose_not_detected",
          poseArtifact.quality,
        );
      }

      await this.jobs.updateState({
        jobId: job.id,
        state: "solving_motion",
        progress: 68,
        message: useMultiViewReconstruction
          ? "Solving humanoid skeleton from pro multi-view landmarks."
          : useDualReconstruction
          ? "Solving humanoid skeleton from triangulated landmarks."
          : "Solving humanoid skeleton.",
        metrics: {
          ...poseArtifact.quality,
          reconstruction: reconstruction?.quality,
        },
      });

      const rawSolved = solveMotion(poseArtifact, {
        presetId: job.preset,
        source:
          reconstruction?.schema === "mocap.multi_view_reconstruction.v1"
            ? "multi_view"
            : reconstruction?.schema === "mocap.dual_reconstruction.v1"
              ? "dual_camera"
              : "single_camera",
      });
      const rawSolvedValidation = validateSolvedMotion(rawSolved);
      if (!rawSolvedValidation.ok) {
        throw new WorkerProcessingError(
          "Solved motion failed validation.",
          "solved_motion_invalid",
          rawSolvedValidation,
        );
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

      const bvh = writeBvh(solved);
      const bvhValidation = validateBvhText(bvh, solved.frameCount);
      const bvhPath = path.join(dir, "result.bvh");
      const blenderResultPath = path.join(dir, "blender_smoke_test.json");
      await writeFile(bvhPath, bvh, "utf8");
      const blender = await runBlenderSmokeTest(bvhPath, blenderResultPath);
      const allWarnings = [
        ...solvedValidation.warnings,
        ...bvhValidation.warnings,
        ...blender.warnings,
      ];
      const allErrors = [
        ...solvedValidation.errors,
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

      const quality = buildQualityReport(
        poseArtifact,
        solved,
        cleanup,
        {
          ok: allErrors.length === 0,
          errors: allErrors,
          warnings: allWarnings,
          blenderOk: blender.ok,
          blenderSkipped: blender.skipped,
        },
        reconstruction,
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

      const preview = buildPreviewSummary(solved, quality, cleanup);
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

      await this.jobs.updateState({
        jobId: job.id,
        state: "succeeded",
        progress: 100,
        message: "Backend motion export is ready.",
        metrics: {
          qualityScore: quality.score,
          blender,
          artifacts: {
            poseFrames: poseKey,
            rawSolvedMotion: rawSolvedKey,
            solvedMotion: solvedKey,
            cleanupReport: cleanupKey,
            reconstruction: reconstructionKey,
            bvh: bvhKey,
            qualityReport: qualityKey,
            previewSummary: previewKey,
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
