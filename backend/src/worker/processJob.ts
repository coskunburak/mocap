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
import { trySolvePremiumMotion } from "./export/premiumMotionSolver";
import { normalizeVideo, probeVideo } from "./video/videoPipeline";
import type {
  MotionPipelineReport,
  PoseFramesArtifact,
  SolvedMotionArtifact,
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
      const processedSources: ProcessedSource[] = [];

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
        const normalizedProbe = await normalizeVideo(inputPath, normalizedPath);
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

      const primarySource = processedSources[0];
      if (!primarySource) {
        throw new WorkerProcessingError("No source video was prepared.", "source_video_missing");
      }
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
        },
      });

      const premiumAttempt = await trySolvePremiumMotion({
        takeId: job.takeId,
        jobId: job.id,
        poseArtifact,
        source: motionSource,
        presetId: job.preset,
        outputDir: path.join(dir, "premium_solver"),
        normalizedVideoPaths: processedSources.map((source) => source.normalizedPath),
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
        motionSource,
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
          motionFallbackUsed: false,
          reasons: [],
        },
        artifacts: {
          smplParameters: smplParametersKey,
          rawSolvedMotion: rawSolvedKey,
          solvedMotion: solvedKey,
          cleanupReport: cleanupKey,
          qualityReport: qualityKey,
          previewSummary: previewKey,
          overlayPreview: overlayPreviewKey,
          bvh: bvhKey,
        },
        quality: {
          score: quality.score,
          grade: quality.grade,
          warnings: quality.warnings.slice(0, 12),
          errors: quality.errors,
        },
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
          artifacts: {
            smplParameters: smplParametersKey,
            rawSolvedMotion: rawSolvedKey,
            solvedMotion: solvedKey,
            cleanupReport: cleanupKey,
            bvh: bvhKey,
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
