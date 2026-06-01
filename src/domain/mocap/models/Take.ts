import type { StereoCalibrationResult, CaptureMode } from "./MultiViewPoseFrame";
import type { CaptureMetadata } from "./CaptureMetadata";

export type TakeId = string;

export type CalibrationPose = "t-pose" | "a-pose";

export type TakeCalibration = Readonly<{
  status: "pending" | "ready";
  readinessScore: number;
  targetPose: CalibrationPose;
  issues: string[];
  measuredDistance: number;
  stepScores: Readonly<Record<"camera" | "distance" | "pose" | "ground", number>>;
  calibratedAt: number;
}>;

export type TakePostProcess = Readonly<{
  status: "raw" | "cleaned";
  trimmedStartFrames: number;
  trimmedEndFrames: number;
  gapFillCount: number;
  outlierFixCount: number;
  contactLockCount: number;
  trajectoryFixCount: number;
  rootStabilized: boolean;
  qualityScore: number;
  processedAt: number;
}>;

export type TakeRetarget = Readonly<{
  ready: boolean;
  preset: string;
  targetSkeleton: string;
  mappedBones: number;
  totalSourceBones: number;
  unmappedSourceBones: string[];
  generatedAt: number;
}>;

export type TakeReview = Readonly<{
  status: "pending" | "approved" | "needs-work";
  trimStartFrame: number;
  trimEndFrame: number;
  selectedMode: "raw" | "cleaned";
  issueCount: number;
  qualityScore: number;
  note?: string;
  reviewedAt: number;
}>;

export type TakeMotionArtifact = Readonly<{
  status: "ready" | "needs-review" | "failed";
  solverVersion: string;
  sourceSpace: "normalized" | "world" | "triangulated";
  raw2dFrameCount: number;
  rawWorldFrameCount: number;
  triangulatedFrameCount: number;
  cleaned3dFrameCount: number;
  bakedAvatarFrameCount: number;
  calibrationFrameCount: number;
  targetPose: CalibrationPose;
  avatarPreset: string;
  qualityScore: number;
  issues: string[];
  generatedAt: number;
}>;

export type TakeCaptureVideo = Readonly<{
  localUri: string;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  frameCount?: number;
  firstFrameTimestampMs?: number;
  framePresentationTimestampsMs?: readonly number[];
  hasAudioTrack?: boolean;
  audioSampleRate?: number;
  fileSizeBytes: number;
  codec: string;
  container: "mov" | "mp4";
  recordedAt: number;
}>;

export type TakeRemoteProcessing = Readonly<{
  projectId: string;
  takeId: string;
  uploadSessionId?: string;
  jobId?: string;
  status:
    | "pending_upload"
    | "uploading"
    | "uploaded"
    | "processing"
    | "completed"
    | "failed"
    | "canceled";
  progress: number;
  errorMessage?: string;
  updatedAt: number;
}>;

export type Take = Readonly<{
  id: TakeId;

  projectId?: string;

  name: string;

  createdAt: number; // ms
  updatedAt: number; // ms

  // stats (filled progressively, finalized on stop)
  frameCount: number;
  durationMs: number;
  avgFps: number;

  // persistence
  chunkCount: number;
  schemaVersion: number; // bump if you change storage format

  trackingProfile?: "pose" | "holistic";
  calibration?: TakeCalibration;
  postProcess?: TakePostProcess;
  retarget?: TakeRetarget;
  review?: TakeReview;
  motion?: TakeMotionArtifact;
  qualityScore?: number;
  video?: TakeCaptureVideo;
  captureMetadata?: CaptureMetadata;
  remote?: TakeRemoteProcessing;

  // dual-camera fields
  captureMode?: CaptureMode;
  stereoCalibration?: StereoCalibrationResult;
  viewCount?: number;
}>;

export const TAKE_SCHEMA_VERSION = 6;

export type NewTakeMeta = Readonly<{
  trackingProfile?: "pose" | "holistic";
  calibration?: TakeCalibration;
  postProcess?: TakePostProcess;
  retarget?: TakeRetarget;
  review?: TakeReview;
  motion?: TakeMotionArtifact;
  qualityScore?: number;
  video?: TakeCaptureVideo;
  captureMetadata?: CaptureMetadata;
  remote?: TakeRemoteProcessing;
  captureMode?: CaptureMode;
  stereoCalibration?: StereoCalibrationResult;
  viewCount?: number;
}>;

export function newTake(name = "Take", projectId?: string, meta?: NewTakeMeta): Take {
  const now = Date.now();
  return {
    id: `${now}-${Math.random().toString(16).slice(2)}`,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    frameCount: 0,
    durationMs: 0,
    avgFps: 0,
    chunkCount: 0,
    schemaVersion: TAKE_SCHEMA_VERSION,
    trackingProfile: meta?.trackingProfile,
    calibration: meta?.calibration,
    postProcess: meta?.postProcess,
    retarget: meta?.retarget,
    review: meta?.review,
    motion: meta?.motion,
    qualityScore: meta?.qualityScore,
    video: meta?.video,
    captureMetadata: meta?.captureMetadata,
    remote: meta?.remote,
    captureMode: meta?.captureMode ?? "solo",
    stereoCalibration: meta?.stereoCalibration,
    viewCount: meta?.viewCount ?? 1,
  };
}
