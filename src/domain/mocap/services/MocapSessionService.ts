import type {
  ApiProcessingJob,
  ApiCaptureDevice,
  ApiCaptureSession,
  ApiTake,
  CompleteUploadInput,
  CreateTakeInput,
  InitUploadInput,
  MocapApiClient,
} from "../../../infra/api/MocapApiClient";

export interface MocapSessionService {
  createTake(projectId: string, input: CreateTakeInput): Promise<ApiTake>;
  createCaptureSession(
    projectId: string,
    input: Parameters<MocapApiClient["createCaptureSession"]>[1],
  ): Promise<{
    captureSession: ApiCaptureSession;
    take: ApiTake;
    devices: readonly ApiCaptureDevice[];
  }>;
  getCaptureSession(captureSessionId: string): ReturnType<MocapApiClient["getCaptureSession"]>;
  joinCaptureSession(
    input: Parameters<MocapApiClient["joinCaptureSession"]>[0],
  ): ReturnType<MocapApiClient["joinCaptureSession"]>;
  registerCaptureDevice(
    captureSessionId: string,
    input: Parameters<MocapApiClient["registerCaptureDevice"]>[1],
  ): ReturnType<MocapApiClient["registerCaptureDevice"]>;
  initUpload(
    takeId: string,
    input: InitUploadInput,
  ): ReturnType<MocapApiClient["initUpload"]>;
  completeUpload(
    takeId: string,
    input: CompleteUploadInput,
  ): ReturnType<MocapApiClient["completeUpload"]>;
  createProcessingJob(takeId: string, preset?: string): Promise<ApiProcessingJob>;
  getJob(jobId: string): Promise<ApiProcessingJob>;
  retryJob(jobId: string): Promise<ApiProcessingJob>;
  cancelJob(jobId: string): Promise<ApiProcessingJob>;
}

export class ApiMocapSessionService implements MocapSessionService {
  constructor(private readonly api: MocapApiClient) {}

  createTake(projectId: string, input: CreateTakeInput) {
    return this.api.createTake(projectId, input);
  }

  createCaptureSession(
    projectId: string,
    input: Parameters<MocapApiClient["createCaptureSession"]>[1],
  ) {
    return this.api.createCaptureSession(projectId, input);
  }

  getCaptureSession(captureSessionId: string) {
    return this.api.getCaptureSession(captureSessionId);
  }

  joinCaptureSession(input: Parameters<MocapApiClient["joinCaptureSession"]>[0]) {
    return this.api.joinCaptureSession(input);
  }

  registerCaptureDevice(
    captureSessionId: string,
    input: Parameters<MocapApiClient["registerCaptureDevice"]>[1],
  ) {
    return this.api.registerCaptureDevice(captureSessionId, input);
  }

  initUpload(takeId: string, input: InitUploadInput) {
    return this.api.initUpload(takeId, input);
  }

  completeUpload(takeId: string, input: CompleteUploadInput) {
    return this.api.completeUpload(takeId, input);
  }

  createProcessingJob(takeId: string, preset?: string) {
    return this.api.createProcessingJob(takeId, preset);
  }

  getJob(jobId: string) {
    return this.api.getJob(jobId);
  }

  retryJob(jobId: string) {
    return this.api.retryJob(jobId);
  }

  cancelJob(jobId: string) {
    return this.api.cancelJob(jobId);
  }
}
