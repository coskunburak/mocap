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
  landmarkSchema?: "body_33" | "wham_internal" | "custom";
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
    landmarkSchema?: "body_33" | "wham_internal" | "custom";
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
};

export type SolvedMotionArtifact = {
  schema: "mocap.solved_motion.v1";
  takeId: string;
  jobId: string;
  solver?: {
    name: "wham";
    version: string;
    source: "single_camera" | "dual_camera" | "multi_view";
    premium: boolean;
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
    inputSource: "single_camera" | "dual_camera" | "multi_view";
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
    source: "single_camera" | "dual_camera" | "multi_view";
  };
};
