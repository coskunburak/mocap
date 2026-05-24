export type Project = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type CaptureMode = "solo" | "dual" | "pro_4_camera";
export type TakeStatus = "created" | "uploading" | "uploaded" | "processing" | "processed" | "failed";
export type CaptureSessionStatus =
  | "pairing"
  | "ready"
  | "recording"
  | "uploading"
  | "uploaded"
  | "processing"
  | "completed"
  | "failed"
  | "expired";
export type CaptureDeviceRole =
  | "host"
  | "guest"
  | "primary"
  | "secondary"
  | "front"
  | "back"
  | "left"
  | "right"
  | "calibration";
export type UploadSessionStatus = "pending" | "completed" | "expired" | "failed";
export type CaptureVideoStatus = "uploading" | "uploaded" | "failed";
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

export type Take = {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  status: TakeStatus;
  captureMode: CaptureMode;
  expectedVideoCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CaptureSession = {
  id: string;
  userId: string;
  projectId: string;
  takeId: string;
  captureMode: CaptureMode;
  expectedDeviceCount: number;
  joinToken: string;
  status: CaptureSessionStatus;
  syncMetadata: unknown | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CaptureDevice = {
  id: string;
  userId: string;
  projectId: string;
  takeId: string;
  captureSessionId: string;
  deviceId: string;
  deviceRole: CaptureDeviceRole;
  deviceIndex: number;
  platform: string | null;
  appVersion: string | null;
  metadata: unknown | null;
  pairedAt: string;
  lastSeenAt: string;
};

export type CaptureVideo = {
  id: string;
  userId: string;
  projectId: string;
  takeId: string;
  captureSessionId: string | null;
  uploadSessionId: string;
  deviceIndex: number;
  deviceId: string | null;
  deviceRole: string;
  videoStorageKey: string;
  metadataStorageKey: string;
  status: CaptureVideoStatus;
  fileSizeBytes: number | null;
  metadataSizeBytes: number | null;
  captureMetadata: unknown | null;
  syncMetadata: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadSession = {
  id: string;
  userId: string;
  projectId: string;
  takeId: string;
  captureSessionId: string | null;
  deviceIndex: number;
  deviceId: string | null;
  status: UploadSessionStatus;
  videoStorageKey: string;
  metadataStorageKey: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProcessingJob = {
  id: string;
  userId: string;
  projectId: string;
  takeId: string;
  state: ProcessingJobState;
  preset: string;
  progress: number;
  message: string | null;
  errorCode: string | null;
  retryOfJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobTimelineEvent = {
  id: string;
  jobId: string;
  state: ProcessingJobState;
  message: string | null;
  metrics: unknown | null;
  createdAt: string;
};

export type ExportFile = {
  id: string;
  userId: string;
  projectId: string;
  takeId: string;
  jobId: string | null;
  preset: string;
  format: string;
  artifactName?: string;
  storageKey: string;
  fileSizeBytes: number | null;
  createdAt: string;
};
