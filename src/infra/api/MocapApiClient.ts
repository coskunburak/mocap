import type { CaptureMetadata } from "../../domain/mocap/models/CaptureMetadata";
import { ApiClient } from "./ApiClient";

export type ApiProject = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ApiTake = Readonly<{
  id: string;
  projectId: string;
  name: string;
  status: "created" | "uploading" | "uploaded" | "processing" | "processed" | "failed";
  captureMode: "solo" | "dual" | "pro_4_camera";
  expectedVideoCount: number;
}>;

export type ApiCaptureSession = Readonly<{
  id: string;
  projectId: string;
  takeId: string;
  captureMode: "solo" | "dual" | "pro_4_camera";
  expectedDeviceCount: number;
  joinToken: string;
  status:
    | "pairing"
    | "ready"
    | "recording"
    | "uploading"
    | "uploaded"
    | "processing"
    | "completed"
    | "failed"
    | "expired";
  expiresAt: string;
}>;

export type ApiCaptureDevice = Readonly<{
  id: string;
  captureSessionId: string;
  takeId: string;
  deviceId: string;
  deviceRole:
    | "host"
    | "guest"
    | "primary"
    | "secondary"
    | "front"
    | "back"
    | "left"
    | "right"
    | "calibration";
  deviceIndex: number;
  platform: string | null;
  appVersion: string | null;
}>;

export type ApiUploadTarget = Readonly<{
  storageKey: string;
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
  maxSizeBytes?: number;
  expectedSizeBytes?: number;
}>;

export type ApiUploadSession = Readonly<{
  id: string;
  takeId: string;
  deviceIndex: number;
  expiresAt: string;
  status: "pending" | "completed" | "expired" | "failed";
}>;

export type ProcessingJobState =
  | "queued"
  | "ingesting"
  | "extracting_frames"
  | "solving_motion"
  | "cleaning"
  | "exporting"
  | "succeeded"
  | "failed"
  | "canceled";

export type ApiProcessingJob = Readonly<{
  id: string;
  takeId: string;
  state: ProcessingJobState;
  preset: string;
  progress: number;
  message?: string | null;
  errorCode?: string | null;
  timeline?: readonly unknown[];
}>;

export type KnownExportArtifactFormat =
  | "bvh"
  | "smpl_parameters_json"
  | "raw_solved_motion_json"
  | "solved_motion_json"
  | "cleanup_report_json"
  | "quality_report_json"
  | "preview_summary_json"
  | "motion_pipeline_report_json"
  | "wham_overlay_preview_mp4"
  | "pose_frames_device_json"
  | "pose_frames_json"
  | "calibration_observations_json"
  | "multi_view_sync_json"
  | "camera_calibration_json"
  | "capture_volume_json"
  | "triangulated_joint_track_json"
  | "dual_fit_report_json"
  | "optimized_solved_motion_json"
  | "optimized_smpl_parameters_json"
  | "optimized_bvh"
  | "dual_reconstruction_json"
  | "multi_view_reconstruction_json";

export type ExportArtifactFormat = KnownExportArtifactFormat | (string & {});

export type ApiExportFile = Readonly<{
  id: string;
  jobId?: string | null;
  takeId: string;
  preset: string;
  format: ExportArtifactFormat;
  artifactName?: string;
  storageKey?: string;
  fileSizeBytes: number | null;
  createdAt: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type CreateTakeInput = Readonly<{
  name: string;
  captureMode?: "solo" | "dual" | "pro_4_camera";
  expectedVideoCount?: number;
}>;

export type InitUploadInput = Readonly<{
  captureSessionId?: string;
  deviceId?: string;
  deviceIndex: number;
  deviceRole:
    | "host"
    | "guest"
    | "primary"
    | "secondary"
    | "front"
    | "back"
    | "left"
    | "right"
    | "calibration";
  video: {
    contentType: "video/quicktime" | "video/mp4";
    fileName: string;
    fileSizeBytes: number;
  };
  metadata: {
    contentType: "application/json";
    fileName: string;
    fileSizeBytes: number;
  };
}>;

export type CompleteUploadInput = Readonly<{
  uploadSessionId: string;
  videoUploaded: true;
  metadataUploaded: true;
  videoSizeBytes: number;
  metadataSizeBytes: number;
  captureMetadata: CaptureMetadata;
}>;

export interface MocapApiClient {
  createProject(name: string): Promise<ApiProject>;
  listProjects(): Promise<readonly ApiProject[]>;
  createTake(projectId: string, input: CreateTakeInput): Promise<ApiTake>;
  createCaptureSession(
    projectId: string,
    input: {
      name: string;
      captureMode?: "dual" | "pro_4_camera";
      expectedDeviceCount?: number;
      hostDevice?: {
        deviceId: string;
        deviceRole?: "host" | "primary" | "front" | "back" | "left" | "right";
        platform?: string;
        appVersion?: string;
      };
      syncMetadata?: unknown;
    },
  ): Promise<{
    captureSession: ApiCaptureSession;
    take: ApiTake;
    devices: readonly ApiCaptureDevice[];
  }>;
  getCaptureSession(captureSessionId: string): Promise<{
    captureSession: ApiCaptureSession;
    devices: readonly ApiCaptureDevice[];
  }>;
  joinCaptureSession(input: {
    joinToken: string;
    deviceId: string;
    deviceRole?: "guest" | "secondary" | "front" | "back" | "left" | "right";
    platform?: string;
    appVersion?: string;
    deviceIndex?: number;
  }): Promise<{
    captureSession: ApiCaptureSession;
    device: ApiCaptureDevice;
    devices: readonly ApiCaptureDevice[];
  }>;
  registerCaptureDevice(
    captureSessionId: string,
    input: {
      deviceId: string;
      deviceRole:
        | "host"
        | "guest"
        | "primary"
        | "secondary"
        | "front"
        | "back"
        | "left"
        | "right"
        | "calibration";
      platform?: string;
      appVersion?: string;
      deviceIndex?: number;
      metadata?: unknown;
    },
  ): Promise<{
    captureSession: ApiCaptureSession;
    device: ApiCaptureDevice;
    devices: readonly ApiCaptureDevice[];
  }>;
  getTake(takeId: string): Promise<ApiTake>;
  initUpload(
    takeId: string,
    input: InitUploadInput,
  ): Promise<{
    uploadSession: ApiUploadSession;
    video: ApiUploadTarget;
    metadata: ApiUploadTarget;
  }>;
  completeUpload(takeId: string, input: CompleteUploadInput): Promise<{
    uploadSession: ApiUploadSession;
    take: ApiTake;
  }>;
  createProcessingJob(takeId: string, preset?: string): Promise<ApiProcessingJob>;
  getJob(jobId: string): Promise<ApiProcessingJob>;
  retryJob(jobId: string): Promise<ApiProcessingJob>;
  cancelJob(jobId: string): Promise<ApiProcessingJob>;
  listExports(takeId: string): Promise<readonly ApiExportFile[]>;
  getExportDownloadUrl(exportId: string): Promise<{ downloadUrl: string; expiresAt: string }>;
}

type ClientOptions = Readonly<{
  baseUrl: string;
  timeoutMs?: number;
  tokenProvider?: () => string | undefined | Promise<string | undefined>;
}>;

export class HttpMocapApiClient implements MocapApiClient {
  private readonly client: ApiClient;

  constructor(options: ClientOptions) {
    this.client = new ApiClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      retryAttempts: 2,
      retryBackoffMs: 450,
      tokenProvider: options.tokenProvider,
    });
  }

  async createProject(name: string) {
    const response = await this.client.request<{ project: ApiProject }>("/api/projects", {
      method: "POST",
      body: { name },
    });
    return response.project;
  }

  async listProjects() {
    const response = await this.client.request<{ projects: ApiProject[] }>("/api/projects");
    return response.projects;
  }

  async createTake(projectId: string, input: CreateTakeInput) {
    const response = await this.client.request<{ take: ApiTake }>(
      `/api/projects/${encodeURIComponent(projectId)}/takes`,
      { method: "POST", body: input },
    );
    return response.take;
  }

  async createCaptureSession(
    projectId: string,
    input: Parameters<MocapApiClient["createCaptureSession"]>[1],
  ) {
    return this.client.request<{
      captureSession: ApiCaptureSession;
      take: ApiTake;
      devices: ApiCaptureDevice[];
    }>(`/api/projects/${encodeURIComponent(projectId)}/capture-sessions`, {
      method: "POST",
      body: input,
    });
  }

  async getCaptureSession(captureSessionId: string) {
    return this.client.request<{
      captureSession: ApiCaptureSession;
      devices: ApiCaptureDevice[];
    }>(`/api/capture-sessions/${encodeURIComponent(captureSessionId)}`);
  }

  async joinCaptureSession(input: Parameters<MocapApiClient["joinCaptureSession"]>[0]) {
    return this.client.request<{
      captureSession: ApiCaptureSession;
      device: ApiCaptureDevice;
      devices: ApiCaptureDevice[];
    }>("/api/capture-sessions/join", {
      method: "POST",
      body: input,
    });
  }

  async registerCaptureDevice(
    captureSessionId: string,
    input: Parameters<MocapApiClient["registerCaptureDevice"]>[1],
  ) {
    return this.client.request<{
      captureSession: ApiCaptureSession;
      device: ApiCaptureDevice;
      devices: ApiCaptureDevice[];
    }>(`/api/capture-sessions/${encodeURIComponent(captureSessionId)}/devices/register`, {
      method: "POST",
      body: input,
    });
  }

  async getTake(takeId: string) {
    const response = await this.client.request<{ take: ApiTake }>(
      `/api/takes/${encodeURIComponent(takeId)}`,
    );
    return response.take;
  }

  async initUpload(takeId: string, input: InitUploadInput) {
    return this.client.request<{
      uploadSession: ApiUploadSession;
      video: ApiUploadTarget;
      metadata: ApiUploadTarget;
    }>(`/api/takes/${encodeURIComponent(takeId)}/uploads/init`, {
      method: "POST",
      body: input,
    });
  }

  async completeUpload(takeId: string, input: CompleteUploadInput) {
    return this.client.request<{ uploadSession: ApiUploadSession; take: ApiTake }>(
      `/api/takes/${encodeURIComponent(takeId)}/uploads/complete`,
      { method: "POST", body: input },
    );
  }

  async createProcessingJob(takeId: string, preset = "humanoid_bvh_v1") {
    const response = await this.client.request<{ job: ApiProcessingJob }>(
      `/api/takes/${encodeURIComponent(takeId)}/process`,
      { method: "POST", body: { preset } },
    );
    return response.job;
  }

  async getJob(jobId: string) {
    const response = await this.client.request<{ job: ApiProcessingJob }>(
      `/api/jobs/${encodeURIComponent(jobId)}`,
    );
    return response.job;
  }

  async retryJob(jobId: string) {
    const response = await this.client.request<{ job: ApiProcessingJob }>(
      `/api/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: "POST" },
    );
    return response.job;
  }

  async cancelJob(jobId: string) {
    const response = await this.client.request<{ job: ApiProcessingJob }>(
      `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
    );
    return response.job;
  }

  async listExports(takeId: string) {
    const response = await this.client.request<{ exports: ApiExportFile[] }>(
      `/api/takes/${encodeURIComponent(takeId)}/exports`,
    );
    return response.exports;
  }

  async getExportDownloadUrl(exportId: string) {
    return this.client.request<{ downloadUrl: string; expiresAt: string }>(
      `/api/exports/${encodeURIComponent(exportId)}/download-url`,
    );
  }
}
