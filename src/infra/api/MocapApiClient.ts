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
  | "detecting_pose"
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

export type ApiExportFile = Readonly<{
  id: string;
  takeId: string;
  preset: string;
  format: string;
  fileSizeBytes: number | null;
  createdAt: string;
}>;

export type CreateTakeInput = Readonly<{
  name: string;
  captureMode?: "solo" | "dual" | "pro_4_camera";
  expectedVideoCount?: number;
}>;

export type InitUploadInput = Readonly<{
  deviceIndex: number;
  deviceRole: "primary" | "secondary" | "calibration";
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
