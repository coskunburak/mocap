export const RECONSTRUCTION_STATUSES = [
  "ready",
  "diagnostic_only",
  "missing_pose_frames",
  "missing_sync",
  "missing_calibration",
  "invalid_calibration",
  "insufficient_views",
  "triangulation_failed",
  "fallback_primary_wham",
  "failed",
] as const;

export type ReconstructionStatus = (typeof RECONSTRUCTION_STATUSES)[number];

export const RECONSTRUCTION_ARTIFACT_FILES = {
  poseFramesDevice0: "pose_frames_device_0.json",
  poseFramesDevice1: "pose_frames_device_1.json",
  multiViewSync: "multi_view_sync.json",
  cameraCalibration: "camera_calibration.json",
  captureVolume: "capture_volume.json",
  triangulatedJointTrack: "triangulated_joint_track.json",
  dualFitReport: "dual_fit_report.json",
  optimizedSolvedMotion: "optimized_solved_motion.json",
  optimizedSmplParameters: "optimized_smpl_parameters.json",
  optimizedBvh: "optimized_result.bvh",
  dualReconstruction: "dual_reconstruction.json",
  multiViewReconstruction: "multi_view_reconstruction.json",
  poseFrames: "pose_frames.json",
} as const;

export type ReconstructionArtifactFile =
  (typeof RECONSTRUCTION_ARTIFACT_FILES)[keyof typeof RECONSTRUCTION_ARTIFACT_FILES];

export const RECONSTRUCTION_ARTIFACT_EXPORT_NAMES = {
  poseFramesDevice0: "pose_frames_device_0_json",
  poseFramesDevice1: "pose_frames_device_1_json",
  multiViewSync: "multi_view_sync_json",
  cameraCalibration: "camera_calibration_json",
  captureVolume: "capture_volume_json",
  triangulatedJointTrack: "triangulated_joint_track_json",
  dualFitReport: "dual_fit_report_json",
  optimizedSolvedMotion: "optimized_solved_motion_json",
  optimizedSmplParameters: "optimized_smpl_parameters_json",
  optimizedBvh: "optimized_bvh",
  dualReconstruction: "dual_reconstruction_json",
  multiViewReconstruction: "multi_view_reconstruction_json",
  poseFrames: "pose_frames_json",
} as const;

export type ReconstructionArtifactExportName =
  (typeof RECONSTRUCTION_ARTIFACT_EXPORT_NAMES)[keyof typeof RECONSTRUCTION_ARTIFACT_EXPORT_NAMES];

export type CameraRole =
  | "primary"
  | "secondary"
  | "reference"
  | "front"
  | "right"
  | "back"
  | "left"
  | (string & {});

export type CameraInput = {
  cameraId: string;
  deviceId?: string;
  deviceIndex?: number;
  role?: CameraRole;
  videoUri?: string;
  videoPath?: string;
  fps?: number;
  resolution?: {
    width: number;
    height: number;
  };
  durationMs?: number;
  frameCount?: number;
  recordingStartTimeMs?: number;
  metadata?: Record<string, unknown>;
};

export type Keypoint2D = {
  jointId: string;
  x: number;
  y: number;
  confidence: number;
  visibility?: number;
  presence?: number;
};

export type PoseFrame2D = {
  cameraId: string;
  frameIndex: number;
  timestampMs: number;
  keypoints: readonly Keypoint2D[];
  status: ReconstructionStatus;
  reason?: string;
};

export type CameraSyncMethod =
  | "metadata_clock_offset"
  | "video_timestamps"
  | "audio_marker"
  | "manual"
  | "fallback"
  | (string & {});

export type SyncedFramePair = {
  referenceCameraId: string;
  secondaryCameraId: string;
  device0FrameIndex: number;
  device1FrameIndex: number;
  timestampMs: number;
  device0TimestampMs?: number;
  device1TimestampMs?: number;
  timeDeltaMs: number;
  confidence: number;
  syncMethod?: CameraSyncMethod;
  status: ReconstructionStatus;
  reason?: string;
};

export type Matrix3x3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type Vector3 = readonly [number, number, number];

export type ProjectionMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type CameraIntrinsics = {
  matrix?: Matrix3x3;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  source?: "capture_metadata" | "calibration_clip" | "fov_fallback";
};

export type CameraExtrinsics = {
  rotation: Matrix3x3;
  translation: Vector3;
  source?: "capture_metadata" | "calibration_clip" | "estimated";
};

export type CameraCalibration = {
  cameraId: string;
  deviceIndex?: number;
  intrinsics?: CameraIntrinsics;
  extrinsics?: CameraExtrinsics;
  distortion?: readonly number[];
  imageSize?: {
    width: number;
    height: number;
  };
  projectionMatrix?: ProjectionMatrix;
  reprojectionError?: number;
  status: ReconstructionStatus;
  reason?: string;
};

export type TriangulatedLandmark = {
  jointId: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
  sourceCameraIds: readonly string[];
  reprojectionError?: number;
  status: ReconstructionStatus;
  reason?: string;
};

export type DualReconstructionFrame = {
  frameIndex: number;
  timestampMs: number;
  landmarks: readonly TriangulatedLandmark[];
  triangulatedJointRatio: number;
  averageReprojectionError?: number;
  status: ReconstructionStatus;
  reason?: string;
};

export type ReconstructionWarning = {
  status?: ReconstructionStatus;
  code?: string;
  message: string;
  cameraId?: string;
  frameIndex?: number;
  stage?: "pose_extraction" | "frame_sync" | "calibration" | "triangulation";
  metadata?: Record<string, unknown>;
};

export type DualReconstructionResult = {
  schema: "mocap.dual_reconstruction.v1";
  takeId: string;
  jobId: string;
  source: "dual_camera";
  status: ReconstructionStatus;
  reason?: string;
  cameras: readonly CameraInput[];
  poseFramesByCamera?: Record<string, readonly PoseFrame2D[]>;
  syncedFramePairs?: readonly SyncedFramePair[];
  calibrations?: readonly CameraCalibration[];
  frames: readonly DualReconstructionFrame[];
  metrics?: {
    synchronizedFrameRatio?: number;
    triangulatedJointRatio?: number;
    averageReprojectionError?: number;
    validCameraCount?: number;
  };
  fallbackUsed: boolean;
  fallbackReason?: ReconstructionStatus | string;
  artifactRefs: Partial<
    Record<ReconstructionArtifactFile | ReconstructionArtifactExportName, string>
  >;
  warnings: readonly ReconstructionWarning[];
};
