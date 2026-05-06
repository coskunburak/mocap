import type { ApiProcessingJob } from "../../../infra/api/MocapApiClient";
import type { Take } from "../../../domain/mocap/models/Take";

export type UploadStage =
  | "idle"
  | "preparing"
  | "uploading_metadata"
  | "uploading_video"
  | "completing"
  | "starting_processing"
  | "completed"
  | "failed"
  | "cancelled";

export type UploadProgressSnapshot = Readonly<{
  stage: UploadStage;
  progress: number;
  attempt: number;
  message: string;
  remoteTakeId?: string;
  uploadSessionId?: string;
  jobId?: string;
}>;

export type UploadResult = Readonly<{
  localTake: Take;
  remoteTakeId: string;
  uploadSessionId: string;
  job: ApiProcessingJob;
}>;

export type UploadManagerInput = Readonly<{
  take: Take;
  projectName?: string;
  preset?: string;
  onProgress?: (snapshot: UploadProgressSnapshot) => void;
}>;

export interface UploadManager {
  uploadTake(input: UploadManagerInput): Promise<UploadResult>;
  cancel(): void;
}

export class UploadManagerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = "upload_failed", retryable = true) {
    super(message);
    this.name = "UploadManagerError";
    this.code = code;
    this.retryable = retryable;
  }
}
