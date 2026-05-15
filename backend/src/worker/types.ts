export type PoseLandmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence?: number;
};

export type PoseFrameArtifactFrame = {
  frameIndex: number;
  timestampMs: number;
  landmarks: PoseLandmark[];
  worldLandmarks?: PoseLandmark[];
  landmarkSchema?: "mediapipe_pose_33" | "coco_wholebody_133" | "custom";
  wholeBodyLandmarks?: PoseLandmark[];
  faceLandmarks?: PoseLandmark[];
  leftHandLandmarks?: PoseLandmark[];
  rightHandLandmarks?: PoseLandmark[];
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
    landmarkSchema?: "mediapipe_pose_33" | "coco_wholebody_133" | "custom";
    fallbackReason?: string;
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

export type SolvedMotionArtifact = {
  schema: "mocap.solved_motion.v1";
  takeId: string;
  jobId: string;
  solver?: {
    name: "builtin_humanoid" | "wham" | "external_premium";
    version: string;
    source: "single_camera" | "dual_camera" | "multi_view";
    premium: boolean;
    fallbackReason?: string;
    metrics?: Record<string, number | string | boolean>;
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
  profile: "mobile_fast_backend_premium_hybrid";
  engines: {
    mobilePreview: "mediapipe_full_heavy";
    backendPose: string;
    backendMotion: string;
    reconstruction: "single_camera" | "dual_camera" | "multi_view";
    cleanup: "cleanup_quality_v1_5";
  };
  fallback: {
    poseFallbackUsed: boolean;
    motionFallbackUsed: boolean;
    reasons: string[];
  };
  artifacts: {
    poseFrames: string;
    rawSolvedMotion: string;
    solvedMotion: string;
    cleanupReport: string;
    reconstruction?: string;
    qualityReport: string;
    previewSummary: string;
    bvh: string;
  };
  quality: {
    score: number;
    grade: QualityReport["grade"];
    warnings: string[];
    errors: string[];
  };
  createdAt: string;
};

export type DualCameraReconstructionArtifact = {
  schema: "mocap.dual_reconstruction.v1";
  takeId: string;
  jobId: string;
  source: "dual_camera";
  cameras: Array<{
    deviceIndex: number;
    deviceRole: string;
    deviceId: string | null;
    captureSessionId: string | null;
    videoStorageKey: string;
    metadataStorageKey: string;
    normalizedStorageKey?: string;
    fps: number;
    width: number;
    height: number;
    durationMs: number;
    poseFrameCount: number;
  }>;
  sync: {
    method: "audio_waveform" | "metadata_clock" | "recording_timestamp" | "none";
    offsetMs: number;
    confidence: number;
    toleranceMs: number;
    matchedFrameCount: number;
    droppedFrameCount: number;
    averageTimeDeltaMs: number;
    warnings: string[];
  };
  calibration: {
    method: "metadata_intrinsics_stereo_v1";
    baseline: number;
    convergenceAngleDeg: number;
    projectionA: number[];
    projectionB: number[];
    qualityScore: number;
    warnings: string[];
  };
  quality: {
    singleCameraBaselineScore: number;
    dualQualityScore: number;
    qualityGain: number;
    averageReprojectionErrorPx: number;
    reprojectionP95Px: number;
    triangulatedLandmarkRatio: number;
    fallbackLandmarkRatio: number;
    triangulatedFrameCount: number;
    averageConfidence: number;
  };
  frames: Array<{
    frameIndex: number;
    timestampMs: number;
    sourceFrameA: number;
    sourceFrameB: number;
    timeDeltaMs: number;
    averageReprojectionErrorPx: number;
    triangulatedLandmarkCount: number;
    landmarks: PoseLandmark[];
  }>;
  warnings: string[];
};

export type MultiViewReconstructionArtifact = {
  schema: "mocap.multi_view_reconstruction.v1";
  takeId: string;
  jobId: string;
  source: "multi_view";
  cameraCount: number;
  cameras: Array<{
    deviceIndex: number;
    deviceRole: string;
    deviceId: string | null;
    captureSessionId: string | null;
    approxAngleDeg: number;
    calibrationClipId?: string | null;
    intrinsicsSource: "metadata" | "fallback_fov";
    placementScore: number;
    placementFeedback: string[];
    videoStorageKey: string;
    metadataStorageKey: string;
    normalizedStorageKey?: string;
    fps: number;
    width: number;
    height: number;
    durationMs: number;
    poseFrameCount: number;
  }>;
  sync: {
    method: "multi_audio_waveform_v1";
    referenceDeviceIndex: number;
    toleranceMs: number;
    offsets: Array<{
      deviceIndex: number;
      method: "audio_waveform" | "metadata_clock" | "recording_timestamp" | "none";
      offsetMs: number;
      confidence: number;
      warnings: string[];
    }>;
    matchedFrameCount: number;
    droppedFrameCount: number;
    averageTimeDeltaMs: number;
  };
  calibration: {
    method: "metadata_intrinsics_multiview_v1" | "metadata_intrinsics_calibration_clip_multiview_v1";
    calibrationReady: boolean;
    calibrationQualityScore: number;
    calibrationClipIds: string[];
    placementQualityScore: number;
    coverageScore: number;
    expectedAnglesDeg: number[];
    observedAnglesDeg: number[];
    warnings: string[];
  };
  occlusionRecovery: {
    strategy: "best_pair_triangulation_temporal_hold";
    recoveredLandmarkCount: number;
    temporalHoldCount: number;
    fallbackLandmarkCount: number;
    recoveryRatio: number;
  };
  quality: {
    singleCameraBaselineScore: number;
    multiViewQualityScore: number;
    qualityGain: number;
    averageReprojectionErrorPx: number;
    reprojectionP95Px: number;
    triangulatedLandmarkRatio: number;
    averageViewCount: number;
    matchedViewCoverage: number;
    placementQualityScore: number;
    occlusionRecoveryRatio: number;
    averageConfidence: number;
  };
  frames: Array<{
    frameIndex: number;
    timestampMs: number;
    sourceFrames: Array<{
      deviceIndex: number;
      frameIndex: number;
      timeDeltaMs: number;
    }>;
    averageReprojectionErrorPx: number;
    triangulatedLandmarkCount: number;
    recoveredLandmarkCount: number;
    viewCount: number;
    landmarks: PoseLandmark[];
  }>;
  warnings: string[];
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
  reconstruction?: {
    source: "single_camera" | "dual_camera" | "multi_view";
    syncOffsetMs?: number;
    reprojectionErrorPx?: number;
    triangulatedLandmarkRatio?: number;
    qualityGain?: number;
    cameraCount?: number;
    placementQualityScore?: number;
    occlusionRecoveryRatio?: number;
    calibrationQualityScore?: number;
  };
};
