export type PoseLandmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence?: number;
};

export type LandmarkSchema = "body_33" | "wham_internal" | "custom";
export type MultiViewSource = "dual_camera" | "multi_view";
export type WorkerInputSource = "single_camera" | MultiViewSource;
export type WhamInputUsageSource = WorkerInputSource | "pro_4_camera";

export type WhamFallbackReason =
  | "none"
  | "multi_view_reconstruction_disabled"
  | "multi_view_reconstruction_diagnostic_only"
  | "multi_view_pose_extraction_failed"
  | "multi_view_reconstruction_failed"
  | "multi_view_constraints_not_supported"
  | "primary_wham_fallback_allowed";

export type WhamInputUsageMetrics = {
  source: WhamInputUsageSource;
  primaryVideoUsed: boolean;
  primaryDeviceIndex?: number;
  primaryVideoStorageKey?: string;
  additionalVideosProvided: number;
  additionalDeviceIndexes?: number[];
  multiViewReconstructionAvailable: boolean;
  multiViewConstraintsUsed: boolean;
  primaryWhamFallbackUsed: boolean;
  primaryWhamFallbackReason: WhamFallbackReason;
};

export type Point2D = {
  x: number;
  y: number;
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

export type ProjectionMatrix3x4 = readonly [
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

export type Vector3 = readonly [number, number, number];

export type MultiViewWarningCode =
  | "camera_intrinsics_missing"
  | "camera_intrinsics_fov_fallback_used"
  | "calibration_quality_low"
  | "sync_confidence_low"
  | "sync_offset_high"
  | "triangulation_coverage_low"
  | "reprojection_error_high"
  | "single_camera_solver_fallback_used";

export type WorkerMultiViewErrorCode =
  | "multi_view_pose_extraction_failed"
  | "multi_view_sync_failed"
  | "camera_calibration_failed"
  | "camera_projection_invalid"
  | "triangulation_failed"
  | "triangulation_coverage_low"
  | "reprojection_error_high"
  | "multi_view_reconstruction_invalid"
  | "metadata_intrinsics_required";

export type PerCameraPoseFrame = {
  frameIndex: number;
  timestampMs: number;
  keypoints2d: Point2D[];
  confidence: number[];
  poseConfidence: number;
  detectorVersion: string;
};

export type PerCameraPoseQuality = {
  frameCount: number;
  detectedFrameCount: number;
  missingFrameCount: number;
  lowConfidenceFrameCount: number;
  averagePoseConfidence: number;
};

export type PerCameraPoseArtifact = {
  schema: "mocap.pose_frames_device.v1";
  takeId: string;
  jobId: string;
  cameraId: string;
  deviceIndex: number;
  deviceRole: string;
  sourceVideo: {
    storageKey: string;
    normalizedStorageKey: string;
    fps: number;
    width: number;
    height: number;
    durationMs: number;
  };
  detector: {
    name: string;
    version: string;
    landmarkSchema: LandmarkSchema;
  };
  frames: PerCameraPoseFrame[];
  quality: PerCameraPoseQuality;
  warnings: MultiViewWarningCode[];
};

export type MultiViewSyncDeviceReport = {
  deviceIndex: number;
  offsetMs: number;
  confidence: number;
  method: "audio_marker" | "metadata_clock_offset" | "video_timestamps" | "manual" | "fallback";
  matchedFrameCount: number;
  droppedFrameCount: number;
  averageTimeDeltaMs: number;
  maxTimeDeltaMs: number;
};

export type MultiViewSyncReport = {
  schema: "mocap.multiview_sync.v1";
  takeId: string;
  jobId: string;
  referenceDeviceIndex: number;
  devices: MultiViewSyncDeviceReport[];
  matchedFrames: MultiViewMatchedFrameSet[];
  metrics: {
    matchedFrameCount: number;
    droppedFrameCount: number;
    averageTimeDeltaMs: number;
    maxTimeDeltaMs: number;
    syncConfidence: number;
  };
  warnings: MultiViewWarningCode[];
};

export type MultiViewMatchedFrameObservation = {
  deviceIndex: number;
  frameIndex: number;
  timestampMs: number;
  timeDeltaMs: number;
  poseConfidence: number;
};

export type MultiViewMatchedFrameSet = {
  referenceFrameIndex: number;
  timestampMs: number;
  observations: MultiViewMatchedFrameObservation[];
  averageTimeDeltaMs: number;
};

export type CameraProjection = {
  deviceIndex: number;
  deviceRole: string;
  intrinsic: Matrix3x3;
  rotation: Matrix3x3;
  translation: Vector3;
  projection: ProjectionMatrix3x4;
  intrinsicsSource: "capture_metadata" | "fov_fallback";
};

export type CameraCalibrationQuality = {
  score: number;
  averageReprojectionErrorPx: number;
  baseline: number;
  convergenceAngle: number;
};

export type CameraCalibrationArtifact = {
  schema: "mocap.camera_calibration.v1";
  takeId: string;
  jobId: string;
  source: "capture_metadata" | "metadata_and_fov_fallback" | "calibration_clip";
  intrinsicsSource: "capture_metadata" | "capture_metadata_or_fov" | "fov_fallback";
  devices: CameraProjection[];
  quality: CameraCalibrationQuality;
  warnings: MultiViewWarningCode[];
};

export type MultiViewLandmark3D = {
  x: number;
  y: number;
  z: number;
  visibility: number;
  source: "triangulated" | "fallback";
  views: number[];
  reprojectionErrorPx: number;
};

export type MultiViewQualityMetrics = {
  syncOffsetMs: number;
  syncConfidence: number;
  matchedFrameCount: number;
  droppedFrameCount: number;
  averageTimeDeltaMs: number;
  reprojectionErrorPx: number;
  reprojectionP95Px: number;
  triangulatedLandmarkRatio: number;
  fallbackLandmarkRatio: number;
  calibrationQualityScore: number;
  intrinsicsFallbackUsed: number;
  multiViewQualityGain: number;
};

export interface QualityReportMultiViewSection {
  enabled: boolean;
  source: WhamInputUsageSource;
  reconstructionAvailable: boolean;
  reconstructionUsedForConstraints: boolean;
  primaryWhamFallbackUsed: boolean;
  primaryWhamFallbackReason?: WhamFallbackReason;
  whamInputUsage?: WhamInputUsageMetrics;
  metrics?: {
    syncOffsetMs?: number;
    syncConfidence?: number;
    matchedFrameCount?: number;
    droppedFrameCount?: number;
    averageTimeDeltaMs?: number;
    reprojectionErrorPx?: number;
    reprojectionP95Px?: number;
    triangulatedLandmarkRatio?: number;
    fallbackLandmarkRatio?: number;
    calibrationQualityScore?: number;
    intrinsicsFallbackUsed?: number;
    multiViewQualityGain?: number;
  };
  warnings?: string[];
}

export type MultiViewReconstructionFrame = {
  frameIndex: number;
  timestampMs: number;
  matchedDevices: number[];
  averageTimeDeltaMs: number;
  landmarks3D: MultiViewLandmark3D[];
  metrics: Pick<
    MultiViewQualityMetrics,
    "triangulatedLandmarkRatio" | "fallbackLandmarkRatio" | "reprojectionErrorPx"
  >;
};

export type MultiViewReconstructionArtifact = {
  schema: "mocap.multiview_reconstruction.v1";
  takeId: string;
  jobId: string;
  source: MultiViewSource;
  frameCount: number;
  landmarkSchema: LandmarkSchema;
  frames: MultiViewReconstructionFrame[];
  metrics: MultiViewQualityMetrics;
  warnings: MultiViewWarningCode[];
};

export type PoseFrameArtifactFrame = {
  frameIndex: number;
  timestampMs: number;
  landmarks: PoseLandmark[];
  worldLandmarks?: PoseLandmark[];
  landmarkSchema?: LandmarkSchema;
  poseConfidence: number;
  detectorVersion: string;
};

export type PoseFramesArtifact = {
  schema: "mocap.pose_frames.v1";
  takeId: string;
  jobId: string;
  sourceVideo: {
    storageKey: string;
    normalizedStorageKey?: string;
    fps: number;
    width: number;
    height: number;
    durationMs: number;
  };
  detector: {
    name: string;
    version: string;
    landmarkSchema?: LandmarkSchema;
  };
  frames: PoseFrameArtifactFrame[];
  quality: {
    frameCount: number;
    detectedFrameCount: number;
    lowConfidenceFrameCount: number;
    averagePoseConfidence: number;
  };
};

export type SolvedMotionFrame = {
  frameIndex: number;
  timestampMs: number;
  rootTranslation: [number, number, number];
  joints: Record<string, [number, number, number]>;
};

export type SmplFrameParameters = {
  frameIndex: number;
  timestampMs: number;
  bodyPose: number[][];
  globalOrient: number[];
  translation: [number, number, number];
  joints3d?: number[][];
  camera?: Record<string, unknown>;
  mesh?: {
    vertexCount?: number;
    faceCount?: number;
    vertices?: number[][];
    faces?: number[][];
    verticesStorageKey?: string;
    facesStorageKey?: string;
  };
};

export type SmplParametersArtifact = {
  schema: "mocap.smpl_parameters.v1";
  takeId: string;
  jobId: string;
  source: "wham";
  model: {
    family: "SMPL";
    gender?: string;
    assetPath?: string;
  };
  fps: number;
  frameCount: number;
  bodyPose: number[][][];
  globalOrient: number[][];
  betas: number[];
  translation: Array<[number, number, number]>;
  camera?: Record<string, unknown>;
  joints3d?: number[][][];
  mesh?: {
    vertexCount?: number;
    faceCount?: number;
    vertices?: number[][][];
    faces?: number[][];
    verticesStorageKey?: string;
    facesStorageKey?: string;
  };
  smplify: {
    enabled: boolean;
    status: "not_run" | "completed" | "failed" | "unknown";
    iterations?: number;
    finalLoss?: number;
    reason?: string;
  };
  frames: SmplFrameParameters[];
  metrics?: Record<string, number | string | boolean>;
  whamInputUsage?: WhamInputUsageMetrics;
};

export type SolvedMotionArtifact = {
  schema: "mocap.solved_motion.v1";
  takeId: string;
  jobId: string;
  solver?: {
    name: "wham";
    version: string;
    source: WorkerInputSource;
    premium: boolean;
    metrics?: Record<string, number | string | boolean>;
    whamInputUsage?: WhamInputUsageMetrics;
  };
  preset?: {
    id: string;
    label: string;
    exportFormat: "bvh";
    targetSkeleton: string;
    scaleMode: string;
    rootMotion: "hips";
    footLocking: string;
  };
  ik?: {
    enabled: boolean;
    profile: string;
    appliedConstraintCount: number;
    adjustedJointRotationCount: number;
    warnings: string[];
  };
  skeleton: {
    name: "mocap_humanoid_v1";
    rotationOrder: "XYZ";
    coordinateSystem: "right_handed_y_up";
  };
  fps: number;
  frameCount: number;
  durationMs: number;
  frames: SolvedMotionFrame[];
  validation: {
    ok: boolean;
    warnings: string[];
    errors: string[];
  };
  smpl?: SmplParametersArtifact;
};

export type CleanupAction = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type CleanupReport = {
  schema: "mocap.cleanup_report.v1";
  takeId: string;
  jobId: string;
  algorithm: {
    name: "cleanup_quality_v1_5";
    smoothing: "confidence_aware_exponential";
    interpolation: "nearest_linear";
    footLocking: "basic_contact_anchor";
  };
  metrics: {
    sourceFrameCount: number;
    solvedFrameCount: number;
    cleanedFrameCount: number;
    interpolatedFrameCount: number;
    outlierFrameCount: number;
    missingLandmarkRatio: number;
    jitterScore: number;
    jitterRms: number;
    rootStability: number;
    rootVerticalJitter: number;
    footSlidingScore: number;
    footSlidingDistance: number;
    footContactFrameCount: number;
    footLockFrameCount: number;
    boneLengthConsistency: number;
    boneLengthVariation: number;
    leftRightSwapCount: number;
    smoothingStrength: number;
  };
  warnings: string[];
  actions: CleanupAction[];
};

export type PreviewSummary = {
  schema: "mocap.preview_summary.v1";
  takeId: string;
  jobId: string;
  fps: number;
  durationMs: number;
  frameCount: number;
  qualityScore: number;
  rootTravel: number;
  rootBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  contactFrames: number;
  warnings: string[];
};

export type MotionPipelineReport = {
  schema: "mocap.motion_pipeline_report.v1";
  takeId: string;
  jobId: string;
  profile: "wham_smpl_smplify_only";
  engines: {
    mobileCapture: "video_upload";
    backendMotion: string;
    smpl: "SMPL";
    smplify: string;
    inputSource: WorkerInputSource;
    cleanup: "cleanup_quality_v1_5";
  };
  fallback: {
    motionFallbackUsed: false;
    reasons: string[];
  };
  artifacts: {
    smplParameters: string;
    rawSolvedMotion: string;
    solvedMotion: string;
    cleanupReport: string;
    qualityReport: string;
    previewSummary: string;
    overlayPreview?: string;
    bvh: string;
  };
  quality: {
    score: number;
    grade: QualityReport["grade"];
    warnings: string[];
    errors: string[];
  };
  whamInputUsage?: WhamInputUsageMetrics;
  createdAt: string;
};

export type QualityReport = {
  schema: "mocap.quality_report.v1";
  takeId: string;
  jobId: string;
  score: number;
  grade: "excellent" | "good" | "usable" | "poor" | "failed";
  summary: string;
  metrics: Record<string, number>;
  warnings: string[];
  errors: string[];
  actions: CleanupAction[];
  validation: {
    exportOk: boolean;
    blenderOk: boolean;
    blenderSkipped: boolean;
  };
  inputSource: {
    source: WorkerInputSource;
  };
  multiView?: QualityReportMultiViewSection;
};
