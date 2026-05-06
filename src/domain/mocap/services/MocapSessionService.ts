import type {
  ApiProcessingJob,
  ApiTake,
  CompleteUploadInput,
  CreateTakeInput,
  InitUploadInput,
  MocapApiClient,
} from "../../../infra/api/MocapApiClient";

export interface MocapSessionService {
  createTake(projectId: string, input: CreateTakeInput): Promise<ApiTake>;
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
