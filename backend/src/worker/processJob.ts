import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { config } from "../config";
import type { ProcessingJob } from "../domain/types";
import {
  ExportRepository,
  JobRepository,
  TakeRepository,
  UploadRepository,
} from "../infra/db/repositories";
import { artifactStorageKey, ObjectStorage } from "../infra/storage/objectStorage";
import { writeBvh } from "./export/bvhWriter";
import { runBlenderSmokeTest } from "./export/blenderSmokeTest";
import {
  buildQualityReport,
  validateBvhText,
  validateSolvedMotion,
} from "./export/exportValidation";
import { solveMotion } from "./export/solveMotion";
import { detectPoseFrames } from "./pose/poseDetector";
import { normalizeVideo, probeVideo } from "./video/videoPipeline";

type Deps = {
  jobs?: JobRepository;
  takes?: TakeRepository;
  uploads?: UploadRepository;
  exports?: ExportRepository;
  storage?: ObjectStorage;
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
  private readonly uploads: UploadRepository;
  private readonly exports: ExportRepository;
  private readonly storage: ObjectStorage;

  constructor(deps: Deps = {}) {
    this.jobs = deps.jobs ?? new JobRepository();
    this.takes = deps.takes ?? new TakeRepository();
    this.uploads = deps.uploads ?? new UploadRepository();
    this.exports = deps.exports ?? new ExportRepository();
    this.storage = deps.storage ?? new ObjectStorage();
  }

  async process(job: ProcessingJob) {
    const dir = workerDir(job.id);
    await safeRm(dir);
    await mkdir(dir, { recursive: true });

    try {
      const videos = await this.uploads.listVideosByTake(job.userId, job.takeId);
      const source = videos.find((video) => video.status === "uploaded");
      if (!source) {
        throw new WorkerProcessingError(
          "No uploaded source video found for take.",
          "source_video_missing",
          { takeId: job.takeId },
        );
      }

      await this.jobs.updateState({
        jobId: job.id,
        state: "ingesting",
        progress: 10,
        message: "Downloading source video.",
        metrics: {
          videoStorageKey: source.videoStorageKey,
          metadataStorageKey: source.metadataStorageKey,
        },
      });

      const inputPath = path.join(dir, "source_video");
      await this.storage.downloadToFile(source.videoStorageKey, inputPath);
      const originalProbe = await probeVideo(inputPath);

      await this.jobs.updateState({
        jobId: job.id,
        state: "extracting_frames",
        progress: 25,
        message: "Normalizing source video.",
        metrics: originalProbe,
      });

      const normalizedPath = path.join(dir, "normalized.mp4");
      const normalizedProbe = await normalizeVideo(inputPath, normalizedPath);
      const normalizedKey = artifactStorageKey(job.takeId, job.id, "normalized.mp4");
      await this.storage.putFile({
        storageKey: normalizedKey,
        filePath: normalizedPath,
        contentType: "video/mp4",
      });

      await this.jobs.updateState({
        jobId: job.id,
        state: "detecting_pose",
        progress: 45,
        message: "Detecting body landmarks.",
        metrics: normalizedProbe,
      });

      const poseArtifact = await detectPoseFrames({
        takeId: job.takeId,
        jobId: job.id,
        normalizedVideoPath: normalizedPath,
        sourceStorageKey: source.videoStorageKey,
        normalizedStorageKey: normalizedKey,
        outputDir: dir,
        sourceVideo: {
          storageKey: source.videoStorageKey,
          normalizedStorageKey: normalizedKey,
          fps: normalizedProbe.fps,
          width: normalizedProbe.width,
          height: normalizedProbe.height,
          durationMs: normalizedProbe.durationMs,
        },
      });
      if (poseArtifact.quality.detectedFrameCount === 0) {
        throw new WorkerProcessingError(
          "No body was detected in the uploaded video.",
          "pose_not_detected",
          poseArtifact.quality,
        );
      }
      const poseKey = artifactStorageKey(job.takeId, job.id, "pose_frames.json");
      const poseFile = await this.storage.putJson(poseKey, poseArtifact);
      await this.exports.create({
        userId: job.userId,
        projectId: job.projectId,
        takeId: job.takeId,
        jobId: job.id,
        preset: job.preset,
        format: "pose_frames_json",
        storageKey: poseFile.storageKey,
        fileSizeBytes: poseFile.sizeBytes,
      });

      await this.jobs.updateState({
        jobId: job.id,
        state: "solving_motion",
        progress: 68,
        message: "Solving humanoid skeleton.",
        metrics: poseArtifact.quality,
      });

      const solved = solveMotion(poseArtifact);
      const solvedValidation = validateSolvedMotion(solved);
      if (!solvedValidation.ok) {
        throw new WorkerProcessingError(
          "Solved motion failed validation.",
          "solved_motion_invalid",
          solvedValidation,
        );
      }
      const solvedKey = artifactStorageKey(job.takeId, job.id, "solved_motion.json");
      const solvedFile = await this.storage.putJson(solvedKey, {
        ...solved,
        validation: solvedValidation,
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

      await this.jobs.updateState({
        jobId: job.id,
        state: "exporting",
        progress: 84,
        message: "Writing BVH export.",
        metrics: {
          solvedFrameCount: solved.frameCount,
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

      const quality = buildQualityReport(poseArtifact, solved, {
        ok: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings,
      });
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
            solvedMotion: solvedKey,
            bvh: bvhKey,
            qualityReport: qualityKey,
          },
        },
      });
      await this.takes.updateStatus(job.userId, job.takeId, "processed");
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
      throw workerError;
    } finally {
      await safeRm(dir);
    }
  }
}
