import { randomUUID } from "crypto";
import { pool, rowToIso } from "./postgres";
import { conflict, notFound } from "../../domain/errors";
import type {
  CaptureDevice,
  CaptureSession,
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

function nullableNumber(value: unknown) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToExportFile(row: Record<string, unknown>): ExportFile {
  const item = rowToIso(row) as ExportFile;
  return {
    ...item,
    fileSizeBytes: nullableNumber(item.fileSizeBytes),
  };
}

function rowToCaptureVideo(row: Record<string, unknown>): CaptureVideo {
  const item = rowToIso(row) as CaptureVideo;
  return {
    ...item,
    fileSizeBytes: nullableNumber(item.fileSizeBytes),
    metadataSizeBytes: nullableNumber(item.metadataSizeBytes),
  };
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

export class CaptureSessionRepository {
  async create(input: {
    userId: string;
    projectId: string;
    takeId: string;
    captureMode: string;
    expectedDeviceCount: number;
    joinToken: string;
    expiresAt: Date;
    syncMetadata?: unknown | null;
  }): Promise<CaptureSession> {
    const result = await pool.query(
      `
        insert into capture_sessions
          (id, user_id, project_id, take_id, capture_mode, expected_device_count,
           join_token, status, sync_metadata, expires_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'pairing', $8, $9)
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          capture_mode as "captureMode", expected_device_count as "expectedDeviceCount",
          join_token as "joinToken", status, sync_metadata as "syncMetadata",
          expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
      `,
      [
        id("cs"),
        input.userId,
        input.projectId,
        input.takeId,
        input.captureMode,
        input.expectedDeviceCount,
        input.joinToken,
        input.syncMetadata ?? null,
        input.expiresAt,
      ],
    );
    return rowToIso(result.rows[0]);
  }

  async get(userId: string, captureSessionId: string): Promise<CaptureSession> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          capture_mode as "captureMode", expected_device_count as "expectedDeviceCount",
          join_token as "joinToken", status, sync_metadata as "syncMetadata",
          expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
        from capture_sessions
        where user_id = $1 and id = $2
      `,
      [userId, captureSessionId],
    );
    if (!result.rowCount) throw notFound("Capture session not found");
    return rowToIso(result.rows[0]);
  }

  async getByJoinToken(userId: string, joinToken: string): Promise<CaptureSession> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          capture_mode as "captureMode", expected_device_count as "expectedDeviceCount",
          join_token as "joinToken", status, sync_metadata as "syncMetadata",
          expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
        from capture_sessions
        where user_id = $1 and join_token = $2
      `,
      [userId, joinToken],
    );
    if (!result.rowCount) throw notFound("Capture session not found");
    return rowToIso(result.rows[0]);
  }

  async registerDevice(input: {
    userId: string;
    captureSessionId: string;
    deviceId: string;
    deviceRole: string;
    platform?: string | null;
    appVersion?: string | null;
    requestedDeviceIndex?: number | null;
    metadata?: unknown | null;
  }): Promise<CaptureDevice> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const sessionResult = await client.query(
        `
          select id, user_id, project_id, take_id, expected_device_count, status, expires_at
          from capture_sessions
          where user_id = $1 and id = $2
          for update
        `,
        [input.userId, input.captureSessionId],
      );
      if (!sessionResult.rowCount) throw notFound("Capture session not found");
      const session = sessionResult.rows[0] as {
        id: string;
        project_id: string;
        take_id: string;
        expected_device_count: number;
        expires_at: Date;
      };

      const existing = await client.query(
        `
          select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            capture_session_id as "captureSessionId", device_id as "deviceId",
            device_role as "deviceRole", device_index as "deviceIndex", platform,
            app_version as "appVersion", metadata, paired_at as "pairedAt",
            last_seen_at as "lastSeenAt"
          from capture_devices
          where user_id = $1 and capture_session_id = $2 and device_id = $3
        `,
        [input.userId, input.captureSessionId, input.deviceId],
      );
      if (existing.rowCount) {
        const updated = await client.query(
          `
            update capture_devices
            set device_role = $4,
              platform = $5,
              app_version = $6,
              metadata = $7,
              last_seen_at = now(),
              updated_at = now()
            where user_id = $1 and capture_session_id = $2 and device_id = $3
            returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
              capture_session_id as "captureSessionId", device_id as "deviceId",
              device_role as "deviceRole", device_index as "deviceIndex", platform,
              app_version as "appVersion", metadata, paired_at as "pairedAt",
              last_seen_at as "lastSeenAt"
          `,
          [
            input.userId,
            input.captureSessionId,
            input.deviceId,
            input.deviceRole,
            input.platform ?? null,
            input.appVersion ?? null,
            input.metadata ?? null,
          ],
        );
        await client.query("commit");
        return rowToIso(updated.rows[0]);
      }

      const requested = input.requestedDeviceIndex;
      let deviceIndex: number | null =
        requested != null && requested >= 0 && requested < session.expected_device_count
          ? requested
          : null;
      if (deviceIndex != null) {
        const occupied = await client.query(
          `
            select device_id
            from capture_devices
            where capture_session_id = $1 and device_index = $2
            limit 1
          `,
          [input.captureSessionId, deviceIndex],
        );
        if (occupied.rowCount && occupied.rows[0].device_id !== input.deviceId) {
          throw conflict("Device slot is already registered", {
            captureSessionId: input.captureSessionId,
            deviceIndex,
          });
        }
      }
      if (deviceIndex == null) {
        const nextIndex = await client.query(
          `
            with slots as (
              select generate_series(0, $3::integer - 1) as device_index
            )
            select slots.device_index
            from slots
            left join capture_devices d
              on d.capture_session_id = $2 and d.device_index = slots.device_index
            where d.id is null
            order by slots.device_index asc
            limit 1
          `,
          [input.userId, input.captureSessionId, session.expected_device_count],
        );
        if (!nextIndex.rowCount) {
          throw conflict("No free device slot is available for this capture session", {
            captureSessionId: input.captureSessionId,
          });
        }
        deviceIndex = Number(nextIndex.rows[0].device_index);
      }

      const inserted = await client.query(
        `
          insert into capture_devices
            (id, user_id, project_id, take_id, capture_session_id, device_id,
             device_role, device_index, platform, app_version, metadata)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            capture_session_id as "captureSessionId", device_id as "deviceId",
            device_role as "deviceRole", device_index as "deviceIndex", platform,
            app_version as "appVersion", metadata, paired_at as "pairedAt",
            last_seen_at as "lastSeenAt"
        `,
        [
          id("dev"),
          input.userId,
          session.project_id,
          session.take_id,
          input.captureSessionId,
          input.deviceId,
          input.deviceRole,
          deviceIndex,
          input.platform ?? null,
          input.appVersion ?? null,
          input.metadata ?? null,
        ],
      );

      await client.query(
        `
          update capture_sessions s
          set status = case
              when (
                select count(*)
                from capture_devices d
                where d.capture_session_id = s.id
              ) >= s.expected_device_count then 'ready'
              else 'pairing'
            end,
            updated_at = now()
          where s.id = $1
        `,
        [input.captureSessionId],
      );

      await client.query("commit");
      return rowToIso(inserted.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDevices(userId: string, captureSessionId: string): Promise<CaptureDevice[]> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          capture_session_id as "captureSessionId", device_id as "deviceId",
          device_role as "deviceRole", device_index as "deviceIndex", platform,
          app_version as "appVersion", metadata, paired_at as "pairedAt",
          last_seen_at as "lastSeenAt"
        from capture_devices
        where user_id = $1 and capture_session_id = $2
        order by device_index asc
      `,
      [userId, captureSessionId],
    );
    return result.rows.map(rowToIso);
  }

  async markUploadProgress(userId: string, captureSessionId: string): Promise<CaptureSession> {
    const result = await pool.query(
      `
        update capture_sessions s
        set status = case
            when (
              select count(*)
              from capture_videos v
              where v.capture_session_id = s.id and v.status = 'uploaded'
            ) >= s.expected_device_count then 'uploaded'
            else 'uploading'
          end,
          updated_at = now()
        where s.user_id = $1 and s.id = $2
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          capture_mode as "captureMode", expected_device_count as "expectedDeviceCount",
          join_token as "joinToken", status, sync_metadata as "syncMetadata",
          expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
      `,
      [userId, captureSessionId],
    );
    if (!result.rowCount) throw notFound("Capture session not found");
    return rowToIso(result.rows[0]);
  }

  async updateStatus(
    userId: string,
    captureSessionId: string,
    status: string,
  ): Promise<CaptureSession> {
    const result = await pool.query(
      `
        update capture_sessions
        set status = $3, updated_at = now()
        where user_id = $1 and id = $2
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          capture_mode as "captureMode", expected_device_count as "expectedDeviceCount",
          join_token as "joinToken", status, sync_metadata as "syncMetadata",
          expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
      `,
      [userId, captureSessionId, status],
    );
    if (!result.rowCount) throw notFound("Capture session not found");
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
    captureSessionId?: string | null;
    deviceIndex: number;
    deviceId?: string | null;
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
            (id, user_id, project_id, take_id, capture_session_id, device_index, device_id,
             status, video_storage_key, metadata_storage_key, expires_at)
          values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            capture_session_id as "captureSessionId",
            device_index as "deviceIndex", status, video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", device_id as "deviceId",
            expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
        `,
        [
          uploadId,
          input.userId,
          input.projectId,
          input.takeId,
          input.captureSessionId ?? null,
          input.deviceIndex,
          input.deviceId ?? null,
          input.videoStorageKey,
          input.metadataStorageKey,
          input.expiresAt,
        ],
      );
      const video = await client.query(
        `
          insert into capture_videos
            (id, user_id, project_id, take_id, capture_session_id, upload_session_id,
             device_index, device_id, device_role,
             video_storage_key, metadata_storage_key, status)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'uploading')
          on conflict (take_id, device_index)
          do update set
            capture_session_id = excluded.capture_session_id,
            upload_session_id = excluded.upload_session_id,
            device_id = excluded.device_id,
            device_role = excluded.device_role,
            video_storage_key = excluded.video_storage_key,
            metadata_storage_key = excluded.metadata_storage_key,
            status = 'uploading',
            file_size_bytes = null,
            metadata_size_bytes = null,
            capture_metadata = null,
            sync_metadata = null,
            updated_at = now()
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            capture_session_id as "captureSessionId",
            upload_session_id as "uploadSessionId", device_index as "deviceIndex",
            device_id as "deviceId", device_role as "deviceRole", video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", status,
            file_size_bytes as "fileSizeBytes", metadata_size_bytes as "metadataSizeBytes",
            capture_metadata as "captureMetadata", sync_metadata as "syncMetadata",
            created_at as "createdAt", updated_at as "updatedAt"
        `,
        [
          videoId,
          input.userId,
          input.projectId,
          input.takeId,
          input.captureSessionId ?? null,
          uploadId,
          input.deviceIndex,
          input.deviceId ?? null,
          input.deviceRole,
          input.videoStorageKey,
          input.metadataStorageKey,
        ],
      );
      await client.query("commit");
      return {
        uploadSession: rowToIso(upload.rows[0]),
        captureVideo: rowToCaptureVideo(video.rows[0]),
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
          capture_session_id as "captureSessionId",
          device_index as "deviceIndex", status, video_storage_key as "videoStorageKey",
          metadata_storage_key as "metadataStorageKey", device_id as "deviceId",
          expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
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
          capture_session_id as "captureSessionId",
          upload_session_id as "uploadSessionId", device_index as "deviceIndex",
          device_id as "deviceId", device_role as "deviceRole", video_storage_key as "videoStorageKey",
          metadata_storage_key as "metadataStorageKey", status,
          file_size_bytes as "fileSizeBytes", metadata_size_bytes as "metadataSizeBytes",
          capture_metadata as "captureMetadata", sync_metadata as "syncMetadata",
          created_at as "createdAt", updated_at as "updatedAt"
        from capture_videos
        where user_id = $1 and take_id = $2
        order by device_index asc
      `,
      [userId, takeId],
    );
    return result.rows.map(rowToCaptureVideo);
  }

  async complete(input: {
    userId: string;
    uploadSessionId: string;
    videoSizeBytes: number;
    metadataSizeBytes: number;
    captureMetadata: unknown;
    syncMetadata?: unknown | null;
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
            capture_session_id as "captureSessionId",
            device_index as "deviceIndex", status, video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", device_id as "deviceId",
            expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
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
            sync_metadata = $6,
            updated_at = now()
          where user_id = $1 and upload_session_id = $2
          returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
            capture_session_id as "captureSessionId",
            upload_session_id as "uploadSessionId", device_index as "deviceIndex",
            device_id as "deviceId", device_role as "deviceRole", video_storage_key as "videoStorageKey",
            metadata_storage_key as "metadataStorageKey", status,
            file_size_bytes as "fileSizeBytes", metadata_size_bytes as "metadataSizeBytes",
            capture_metadata as "captureMetadata", sync_metadata as "syncMetadata",
            created_at as "createdAt", updated_at as "updatedAt"
        `,
        [
          input.userId,
          input.uploadSessionId,
          input.videoSizeBytes,
          input.metadataSizeBytes,
          input.captureMetadata,
          input.syncMetadata ?? null,
        ],
      );
      await client.query("commit");
      return {
        uploadSession: rowToIso(upload.rows[0]),
        captureVideo: rowToCaptureVideo(video.rows[0]),
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

  async claimQueuedById(jobId: string): Promise<ProcessingJob | null> {
    const result = await pool.query(
      `
        with target_job as (
          select id
          from processing_jobs
          where id = $1 and state = 'queued'
          for update skip locked
        )
        update processing_jobs j
        set state = 'ingesting',
          progress = 5,
          message = 'RunPod worker claimed job.',
          error_code = null,
          updated_at = now()
        from target_job
        where j.id = target_job.id
        returning j.id, j.user_id as "userId", j.project_id as "projectId", j.take_id as "takeId",
          j.state, j.preset, j.progress, j.message, j.error_code as "errorCode",
          j.retry_of_job_id as "retryOfJobId", j.created_at as "createdAt", j.updated_at as "updatedAt"
      `,
      [jobId],
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
    artifactName?: string;
    storageKey: string;
    fileSizeBytes: number;
  }): Promise<ExportFile> {
    const artifactName = input.artifactName ?? input.format;
    const result = await pool.query(
      `
        insert into export_files
          (id, user_id, project_id, take_id, job_id, preset, format, artifact_name,
           storage_key, file_size_bytes)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (job_id, artifact_name)
        do update set
          storage_key = excluded.storage_key,
          file_size_bytes = excluded.file_size_bytes,
          preset = excluded.preset,
          format = excluded.format
        returning id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          job_id as "jobId", preset, format, artifact_name as "artifactName",
          storage_key as "storageKey",
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
        artifactName,
        input.storageKey,
        input.fileSizeBytes,
      ],
    );
    return rowToExportFile(result.rows[0]);
  }

  async listByTake(userId: string, takeId: string): Promise<ExportFile[]> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          job_id as "jobId", preset, format, artifact_name as "artifactName",
          storage_key as "storageKey",
          file_size_bytes as "fileSizeBytes", created_at as "createdAt"
        from export_files
        where user_id = $1 and take_id = $2
        order by created_at desc
      `,
      [userId, takeId],
    );
    return result.rows.map(rowToExportFile);
  }

  async get(userId: string, exportId: string): Promise<ExportFile> {
    const result = await pool.query(
      `
        select id, user_id as "userId", project_id as "projectId", take_id as "takeId",
          job_id as "jobId", preset, format, artifact_name as "artifactName",
          storage_key as "storageKey",
          file_size_bytes as "fileSizeBytes", created_at as "createdAt"
        from export_files
        where user_id = $1 and id = $2
      `,
      [userId, exportId],
    );
    if (!result.rowCount) throw notFound("Export not found");
    return rowToExportFile(result.rows[0]);
  }
}
