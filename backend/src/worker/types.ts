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

export type QualityReport = {
  schema: "mocap.quality_report.v1";
  takeId: string;
  jobId: string;
  score: number;
  metrics: Record<string, number>;
  warnings: string[];
  errors: string[];
};
