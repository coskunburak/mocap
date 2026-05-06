import { randomUUID } from "crypto";
import { pool, rowToIso } from "./postgres";
import { notFound } from "../../domain/errors";
import type {
  CaptureVideo,
  ExportFile,
  JobTimelineEvent,
  ProcessingJob,
  Project,
  Take,
  UploadSession,
} from "../../domain/types";

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export class ProjectRepository {
  async create(userId: string, name: string): Promise<Project> {
    const result = await pool.query(
      `
        insert into projects (id, user_id, name)
        values ($1, $2, $3)
        returning id, user_id as "userId", name, created_at as "createdAt", updated_at as "updatedAt"
      `,
      [id("prj"), userId, name],
    );
    return rowToIso(result.rows[0]);
  }

  async list(userId: string): Promise<Project[]> {
    const result = await pool.query(
      `
        select id, user_id as "userId", name, created_at as "createdAt", updated_at as "updatedAt"
        from projects
        where user_id = $1
        order by created_at desc
      `,
      [userId],
    );
    return result.rows.map(rowToIso);
  }

  async get(userId: string, projectId: string): Promise<Project> {
    const result = await pool.query(
      `
        select id, user_id as "userId", name, created_at as "createdAt", updated_at as "updatedAt"
        from projects
        where user_id = $1 and id = $2
      `,
      [userId, projectId],
    );
    if (!result.rowCount) throw notFound("Project not found");
    return rowToIso(result.rows[0]);
  }
}

export class TakeRepository {
  async create(input: {
    userId: string;
    projectId: string;
    name: string;
    captureMode: string;
    expectedVideoCount: number;
  }): Promise<Take> {
    const result = await pool.query(
      `
        insert into takes (id, user_id, project_id, name, capture_mode, expected_video_count)
        values ($1, $2, $3, $4, $5, $6)
        returning id, user_id as "userId", project_id as "projectId", name, status,
          capture_mode as "captureMode", expected_video_count as "expectedVideoCount",
          created_at as "createdAt", updated_at as "updatedAt"
      `,
      [
        id("take"),
        input.userId,
        input.projectId,
        input.name,
        input.captureMode,
        input.expectedVideoCount,
      ],
    );
    return rowToIso(result.rows[0]);
  }

  async get(userId: string, takeId: string): Promise<Take> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", name, status,
          capture_mode as "captureMode", expected_video_count as "expectedVideoCount",
          created_at as "createdAt", updated_at as "updatedAt"
        from takes
        where user_id = $1 and id = $2
      `,
      [userId, takeId],
    );
    if (!result.rowCount) throw notFound("Take not found");
    return rowToIso(result.rows[0]);
  }

  async markUploading(userId: string, takeId: string): Promise<Take> {
    return this.updateStatus(userId, takeId, "uploading");
  }

  async markUploadedIfComplete(userId: string, takeId: string): Promise<Take> {
    const result = await pool.query(
      `
        update takes t
        set status = 'uploaded', updated_at = now()
        where t.user_id = $1
          and t.id = $2
          and (
            select count(*)
            from capture_videos cv
            where cv.take_id = t.id and cv.status = 'uploaded'
          ) >= t.expected_video_count
        returning id, user_id as "userId", project_id as "projectId", name, status,
          capture_mode as "captureMode", expected_video_count as "expectedVideoCount",
          created_at as "createdAt", updated_at as "updatedAt"
      `,
      [userId, takeId],
    );
    if (result.rowCount) return rowToIso(result.rows[0]);
    return this.get(userId, takeId);
  }

  async updateStatus(userId: string, takeId: string, status: string): Promise<Take> {
    const result = await pool.query(
      `
        update takes
        set status = $3, updated_at = now()
        where user_id = $1 and id = $2
        returning id, user_id as "userId", project_id as "projectId", name, status,
          capture_mode as "captureMode", expected_video_count as "expectedVideoCount",
          created_at as "createdAt", updated_at as "updatedAt"
      `,
      [userId, takeId, status],
    );
    if (!result.rowCount) throw notFound("Take not found");
    return rowToIso(result.rows[0]);
  }
}

export class UploadRepository {
  async failPendingForDevice(input: {
    userId: string;
    takeId: string;
    deviceIndex: number;
  }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `
          update upload_sessions
          set status = 'failed', updated_at = now()
          where user_id = $1
            and take_id = $2
            and device_index = $3
            and status = 'pending'
        `,
        [input.userId, input.takeId, input.deviceIndex],
      );
      await client.query(
        `
          update capture_videos
          set status = 'failed', updated_at = now()
          where user_id = $1
            and take_id = $2
            and device_index = $3
            and status = 'uploading'
        `,
        [input.userId, input.takeId, input.deviceIndex],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async create(input: {
    userId: string;
    projectId: string;
    takeId: string;
    deviceIndex: number;
    deviceRole: string;
    videoStorageKey: string;
    metadataStorageKey: string;
    expiresAt: Date;
  }): Promise<{ uploadSession: UploadSession; captureVideo: CaptureVideo }> {
    const uploadId = id("upl");
    const videoId = id("vid");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const upload = await client.query(
        `
          insert into upload_sessions
            (id, user_id, project_id, take_id, device_index, status, video_storage_key, metadata_storage_key, expires_at)
          values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            device_index as "deviceIndex", status, video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", expires_at as "expiresAt",
            created_at as "createdAt", updated_at as "updatedAt"
        `,
        [
          uploadId,
          input.userId,
          input.projectId,
          input.takeId,
          input.deviceIndex,
          input.videoStorageKey,
          input.metadataStorageKey,
          input.expiresAt,
        ],
      );
      const video = await client.query(
        `
          insert into capture_videos
            (id, user_id, project_id, take_id, upload_session_id, device_index, device_role,
             video_storage_key, metadata_storage_key, status)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'uploading')
          on conflict (take_id, device_index)
          do update set
            upload_session_id = excluded.upload_session_id,
            device_role = excluded.device_role,
            video_storage_key = excluded.video_storage_key,
            metadata_storage_key = excluded.metadata_storage_key,
            status = 'uploading',
            file_size_bytes = null,
            metadata_size_bytes = null,
            capture_metadata = null,
            updated_at = now()
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            upload_session_id as "uploadSessionId", device_index as "deviceIndex",
            device_role as "deviceRole", video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", status,
            file_size_bytes as "fileSizeBytes", metadata_size_bytes as "metadataSizeBytes",
            capture_metadata as "captureMetadata", created_at as "createdAt", updated_at as "updatedAt"
        `,
        [
          videoId,
          input.userId,
          input.projectId,
          input.takeId,
          uploadId,
          input.deviceIndex,
          input.deviceRole,
          input.videoStorageKey,
          input.metadataStorageKey,
        ],
      );
      await client.query("commit");
      return {
        uploadSession: rowToIso(upload.rows[0]),
        captureVideo: rowToIso(video.rows[0]),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(userId: string, uploadSessionId: string): Promise<UploadSession> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          device_index as "deviceIndex", status, video_storage_key as "videoStorageKey",
          metadata_storage_key as "metadataStorageKey", expires_at as "expiresAt",
          created_at as "createdAt", updated_at as "updatedAt"
        from upload_sessions
        where user_id = $1 and id = $2
      `,
      [userId, uploadSessionId],
    );
    if (!result.rowCount) throw notFound("Upload session not found");
    return rowToIso(result.rows[0]);
  }

  async listVideosByTake(userId: string, takeId: string): Promise<CaptureVideo[]> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          upload_session_id as "uploadSessionId", device_index as "deviceIndex",
          device_role as "deviceRole", video_storage_key as "videoStorageKey",
          metadata_storage_key as "metadataStorageKey", status,
          file_size_bytes as "fileSizeBytes", metadata_size_bytes as "metadataSizeBytes",
          capture_metadata as "captureMetadata", created_at as "createdAt", updated_at as "updatedAt"
        from capture_videos
        where user_id = $1 and take_id = $2
        order by device_index asc
      `,
      [userId, takeId],
    );
    return result.rows.map(rowToIso);
  }

  async complete(input: {
    userId: string;
    uploadSessionId: string;
    videoSizeBytes: number;
    metadataSizeBytes: number;
    captureMetadata: unknown;
  }): Promise<{ uploadSession: UploadSession; captureVideo: CaptureVideo }> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const upload = await client.query(
        `
          update upload_sessions
          set status = 'completed', updated_at = now()
          where user_id = $1 and id = $2 and status = 'pending'
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            device_index as "deviceIndex", status, video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", expires_at as "expiresAt",
            created_at as "createdAt", updated_at as "updatedAt"
        `,
        [input.userId, input.uploadSessionId],
      );
      if (!upload.rowCount) throw notFound("Pending upload session not found");

      const video = await client.query(
        `
          update capture_videos
          set status = 'uploaded',
            file_size_bytes = $3,
            metadata_size_bytes = $4,
            capture_metadata = $5,
            updated_at = now()
          where user_id = $1 and upload_session_id = $2
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            upload_session_id as "uploadSessionId", device_index as "deviceIndex",
            device_role as "deviceRole", video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", status,
            file_size_bytes as "fileSizeBytes", metadata_size_bytes as "metadataSizeBytes",
            capture_metadata as "captureMetadata", created_at as "createdAt", updated_at as "updatedAt"
        `,
        [
          input.userId,
          input.uploadSessionId,
          input.videoSizeBytes,
          input.metadataSizeBytes,
          input.captureMetadata,
        ],
      );
      await client.query("commit");
      return {
        uploadSession: rowToIso(upload.rows[0]),
        captureVideo: rowToIso(video.rows[0]),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class JobRepository {
  async create(input: {
    userId: string;
    projectId: string;
    takeId: string;
    preset: string;
    retryOfJobId?: string;
  }): Promise<ProcessingJob> {
    const jobId = id("job");
    const result = await pool.query(
      `
        insert into processing_jobs
          (id, user_id, project_id, take_id, state, preset, progress, retry_of_job_id)
        values ($1, $2, $3, $4, 'queued', $5, 0, $6)
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          state, preset, progress, message, error_code as "errorCode",
          retry_of_job_id as "retryOfJobId", created_at as "createdAt", updated_at as "updatedAt"
      `,
      [jobId, input.userId, input.projectId, input.takeId, input.preset, input.retryOfJobId ?? null],
    );
    await this.appendTimeline(jobId, "queued", "Job queued.", null);
    return rowToIso(result.rows[0]);
  }

  async get(userId: string, jobId: string): Promise<ProcessingJob> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          state, preset, progress, message, error_code as "errorCode",
          retry_of_job_id as "retryOfJobId", created_at as "createdAt", updated_at as "updatedAt"
        from processing_jobs
        where user_id = $1 and id = $2
      `,
      [userId, jobId],
    );
    if (!result.rowCount) throw notFound("Job not found");
    return rowToIso(result.rows[0]);
  }

  async claimNextQueued(): Promise<ProcessingJob | null> {
    const result = await pool.query(
      `
        with next_job as (
          select id
          from processing_jobs
          where state = 'queued'
          order by created_at asc
          for update skip locked
          limit 1
        )
        update processing_jobs j
        set state = 'ingesting',
          progress = 5,
          message = 'Worker claimed job.',
          error_code = null,
          updated_at = now()
        from next_job
        where j.id = next_job.id
        returning j.id, j.user_id as "userId", j.project_id as "projectId", j.take_id as "takeId",
          j.state, j.preset, j.progress, j.message, j.error_code as "errorCode",
          j.retry_of_job_id as "retryOfJobId", j.created_at as "createdAt", j.updated_at as "updatedAt"
      `,
    );
    if (!result.rowCount) return null;
    const job = rowToIso(result.rows[0]);
    await this.appendTimeline(job.id, job.state, job.message, null);
    return job;
  }

  async updateState(input: {
    jobId: string;
    state: string;
    progress: number;
    message?: string | null;
    errorCode?: string | null;
    metrics?: unknown | null;
  }): Promise<ProcessingJob> {
    const result = await pool.query(
      `
        update processing_jobs
        set state = $2,
          progress = $3,
          message = $4,
          error_code = $5,
          updated_at = now()
        where id = $1
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          state, preset, progress, message, error_code as "errorCode",
          retry_of_job_id as "retryOfJobId", created_at as "createdAt", updated_at as "updatedAt"
      `,
      [
        input.jobId,
        input.state,
        input.progress,
        input.message ?? null,
        input.errorCode ?? null,
      ],
    );
    if (!result.rowCount) throw notFound("Job not found");
    const job = rowToIso(result.rows[0]);
    await this.appendTimeline(job.id, job.state, job.message, input.metrics ?? null);
    return job;
  }

  async timeline(jobId: string): Promise<JobTimelineEvent[]> {
    const result = await pool.query(
      `
        select id, job_id as "jobId", state, message, metrics, created_at as "createdAt"
        from job_timeline_events
        where job_id = $1
        order by created_at asc
      `,
      [jobId],
    );
    return result.rows.map(rowToIso);
  }

  async appendTimeline(
    jobId: string,
    state: string,
    message: string | null,
    metrics: unknown | null,
  ) {
    await pool.query(
      `
        insert into job_timeline_events (id, job_id, state, message, metrics)
        values ($1, $2, $3, $4, $5)
      `,
      [id("evt"), jobId, state, message, metrics],
    );
  }
}

export class ExportRepository {
  async create(input: {
    userId: string;
    projectId: string;
    takeId: string;
    jobId: string;
    preset: string;
    format: string;
    storageKey: string;
    fileSizeBytes: number;
  }): Promise<ExportFile> {
    const result = await pool.query(
      `
        insert into export_files
          (id, user_id, project_id, take_id, job_id, preset, format, storage_key, file_size_bytes)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (job_id, format)
        do update set
          storage_key = excluded.storage_key,
          file_size_bytes = excluded.file_size_bytes,
          preset = excluded.preset
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          job_id as "jobId", preset, format, storage_key as "storageKey",
          file_size_bytes as "fileSizeBytes", created_at as "createdAt"
      `,
      [
        id("exp"),
        input.userId,
        input.projectId,
        input.takeId,
        input.jobId,
        input.preset,
        input.format,
        input.storageKey,
        input.fileSizeBytes,
      ],
    );
    return rowToIso(result.rows[0]);
  }

  async listByTake(userId: string, takeId: string): Promise<ExportFile[]> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          job_id as "jobId", preset, format, storage_key as "storageKey",
          file_size_bytes as "fileSizeBytes", created_at as "createdAt"
        from export_files
        where user_id = $1 and take_id = $2
        order by created_at desc
      `,
      [userId, takeId],
    );
    return result.rows.map(rowToIso);
  }

  async get(userId: string, exportId: string): Promise<ExportFile> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          job_id as "jobId", preset, format, storage_key as "storageKey",
          file_size_bytes as "fileSizeBytes", created_at as "createdAt"
        from export_files
        where user_id = $1 and id = $2
      `,
      [userId, exportId],
    );
    if (!result.rowCount) throw notFound("Export not found");
    return rowToIso(result.rows[0]);
  }
}
