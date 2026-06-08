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
  | "camera_extrinsics_missing"
  | "camera_extrinsics_role_angle_fallback_used"
  | "calibration_observations_missing"
  | "calibration_observation_solve_not_implemented"
  | "calibration_approximate"
  | "calibration_quality_low"
  | "sync_confidence_low"
  | "sync_offset_high"
  | "sync_diagnostic_approximation"
  | "sync_audio_analysis_unavailable"
  | "sync_audio_track_missing"
  | "sync_wall_clock_drift_possible"
  | "sync_first_frame_timestamp_approximation"
  | "sync_manual_offset_used"
  | "sync_index_based_diagnostic"
  | "sync_frame_count_mismatch"
  | "sync_metadata_incomplete"
  | "missing_timestamps"
  | "insufficient_frames"
  | "triangulation_coverage_low"
  | "reprojection_error_high"
  | "joint_track_coverage_low"
  | "joint_track_temporal_jitter_high"
  | "single_camera_solver_fallback_used"
  | "missing_pose_frames"
  | "pose_detector_unavailable"
  | "low_pose_confidence";

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
  cameraId?: string;
  deviceIndex?: number;
  frameIndex: number;
  timestampMs: number;
  timestampSource?: "detector" | "video_timestamp" | "recording_start" | "frame_index";
  keypoints2d: Point2D[];
  confidence: number[];
  keypoints?: PerCameraPoseKeypoint2D[];
  poseConfidence: number;
  detectorVersion: string;
  detectorSource?: string;
  averageConfidence?: number;
  status?: PerCameraPoseArtifactStatus;
  warnings?: MultiViewWarningCode[];
};

export type PerCameraPoseQuality = {
  frameCount: number;
  detectedFrameCount: number;
  missingFrameCount: number;
  lowConfidenceFrameCount: number;
  averagePoseConfidence: number;
};

export type PerCameraPoseArtifactStatus =
  | "ready"
  | "missing_pose_frames"
  | "low_confidence"
  | "failed";

export type PerCameraPoseKeypoint2D = {
  jointId: string;
  name?: string;
  x: number;
  y: number;
  confidence: number;
  visibility?: number;
  presence?: number;
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
  detectorSource?: string;
  status?: PerCameraPoseArtifactStatus;
  reason?: string;
  frames: PerCameraPoseFrame[];
  quality: PerCameraPoseQuality;
  averageConfidence?: number;
  warnings: MultiViewWarningCode[];
};

export type MultiViewSyncMethod =
  | "audio_marker_sync"
  | "network_clock_offset_sync"
  | "monotonic_timestamp_sync"
  | "frame_presentation_timestamp_sync"
  | "first_frame_timestamp_sync"
  | "wall_clock_sync"
  | "manual_offset_sync"
  | "index_based_diagnostic_sync"
  | "audio_marker"
  | "metadata_clock_offset"
  | "video_timestamps"
  | "manual"
  | "fallback";

export type MultiViewSyncDeviceReport = {
  deviceIndex: number;
  offsetMs: number;
  confidence: number;
  method: MultiViewSyncMethod;
  matchedFrameCount: number;
  droppedFrameCount: number;
  averageTimeDeltaMs: number;
  maxTimeDeltaMs: number;
};

export type MultiViewSyncStatus =
  | "ready"
  | "approximate"
  | "diagnostic_only"
  | "missing_timestamps"
  | "insufficient_frames"
  | "failed";

export type MultiViewSyncFramePair = {
  referenceCameraId?: string;
  referenceFrameIndex: number;
  targetFrameIndex: number;
  referenceTimestampMs: number;
  targetTimestampMs: number;
  deltaMs: number;
  targetCameraId?: string;
  targetDeviceIndex?: number;
  targetDeviceId?: string;
};

export type MultiViewSyncMetadataCompleteness = Record<
  string,
  {
    hasFrameTimestamps: boolean;
    hasFirstFrameTimestamp: boolean;
    hasMonotonicStart: boolean;
    hasWallClockStart: boolean;
    hasAudioTrack: boolean;
    hasNetworkClockOffset: boolean;
    hasManualOffset: boolean;
  }
>;

export type MultiViewSyncReport = {
  schema: "mocap.multiview_sync.v1";
  schemaVersion?: "mocap.multi_view_sync.v1";
  takeId: string;
  jobId: string;
  syncMethod: MultiViewSyncMethod;
  referenceDeviceId: string;
  targetDeviceIds: string[];
  referenceDeviceIndex: number;
  devices: MultiViewSyncDeviceReport[];
  matchedFrames: MultiViewMatchedFrameSet[];
  framePairs: MultiViewSyncFramePair[];
  matchedFrameCount: number;
  averageTimeDeltaMs: number;
  p95TimeDeltaMs: number;
  syncConfidence: number;
  droppedFrameCount: number;
  clockOffsetMs?: number | null;
  manualOffsetMs?: number | null;
  metadataCompleteness?: MultiViewSyncMetadataCompleteness;
  status: MultiViewSyncStatus;
  metrics: {
    matchedFrameCount: number;
    droppedFrameCount: number;
    averageTimeDeltaMs: number;
    maxTimeDeltaMs: number;
    p95TimeDeltaMs: number;
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

export type CameraCalibrationStatus =
  | "ready"
  | "approximate"
  | "diagnostic_only"
  | "missing_calibration"
  | "invalid_calibration"
  | "insufficient_views"
  | "failed";

export type CameraIntrinsicsSource =
  | "calibration_payload"
  | "stored_profile"
  | "capture_metadata"
  | "fov_fallback";

export type CameraExtrinsicsSource =
  | "calibration_payload"
  | "stored_profile"
  | "capture_metadata"
  | "role_angle_fallback";

export type CameraProjection = {
  cameraId?: string;
  deviceId?: string;
  deviceIndex: number;
  deviceRole: string;
  imageWidth?: number;
  imageHeight?: number;
  intrinsic: Matrix3x3;
  intrinsicMatrixK?: Matrix3x3;
  rotation: Matrix3x3;
  rotationR?: Matrix3x3;
  translation: Vector3;
  translationT?: Vector3;
  projection: ProjectionMatrix3x4;
  projectionMatrixP?: ProjectionMatrix3x4;
  distortionCoefficients?: readonly number[];
  intrinsicsSource: CameraIntrinsicsSource;
  extrinsicsSource?: CameraExtrinsicsSource;
  calibrationQualityScore?: number;
  warnings?: MultiViewWarningCode[];
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
  source:
    | "calibration_payload"
    | "stored_profile"
    | "capture_metadata"
    | "metadata_and_fov_fallback"
    | "calibration_clip";
  intrinsicsSource:
    | "calibration_payload"
    | "stored_profile"
    | "capture_metadata"
    | "capture_metadata_or_fov"
    | "fov_fallback";
  devices: CameraProjection[];
  cameras?: CameraProjection[];
  baselineEstimate?: number;
  coordinateSystem?: "right_handed_y_up";
  calibrationObservationStatus?: CalibrationObservationStatus;
  calibrationTargetType?: CalibrationTargetType;
  calibrationObservationCount?: number;
  calibrationDetectorSource?: string;
  calibrationObservationConfidence?: number;
  status?: CameraCalibrationStatus;
  reason?: string;
  quality: CameraCalibrationQuality;
  warnings: MultiViewWarningCode[];
};

export type CaptureVolumeStatus =
  | "ready"
  | "approximate"
  | "diagnostic_only"
  | "missing_intrinsics"
  | "missing_extrinsics"
  | "invalid_intrinsics"
  | "invalid_extrinsics"
  | "insufficient_cameras"
  | "failed";

export type CaptureVolumeArtifact = {
  schemaVersion: "mocap.capture_volume.v1";
  volumeId: string;
  takeId?: string;
  jobId: string;
  sessionId?: string | null;
  cameraIds: string[];
  validCameraCount: number;
  worldOrigin: {
    source: string;
    description: string;
  };
  coordinateSystem: {
    upAxis: "Y";
    forwardAxis: "Z";
    unit: "meter";
  };
  floorPlane: null;
  baselineEstimate: number | null;
  captureBounds: null;
  status: CaptureVolumeStatus;
  warnings: string[];
};

export type CalibrationTargetType =
  | "apriltag"
  | "checkerboard"
  | "charuco"
  | "human_pose_calibration";

export type CalibrationObservationStatus =
  | "ready"
  | "disabled"
  | "missing_runtime"
  | "missing_dependency"
  | "missing_calibration_observations"
  | "unsupported_target"
  | "failed"
  | "diagnostic_only";

export type CalibrationObservationPoint = {
  targetId: string;
  cornerId: string;
  x: number;
  y: number;
  confidence: number;
  objectPoint?: Vector3;
  warnings?: string[];
};

export type CalibrationObservationFrame = {
  cameraId: string;
  deviceId?: string;
  frameIndex: number;
  timestampMs?: number;
  observations: CalibrationObservationPoint[];
  warnings: string[];
};

export type CalibrationObservationCameraSummary = {
  cameraId: string;
  deviceId?: string;
  status: CalibrationObservationStatus;
  reason?: string | null;
  frameCount: number;
  observationCount: number;
  averageConfidence: number;
  warnings: string[];
};

export type CalibrationObservationsArtifact = {
  schemaVersion: "mocap.calibration_observations.v1";
  takeId?: string;
  jobId: string;
  sessionId?: string | null;
  targetType: CalibrationTargetType;
  detectorSource: string;
  status: CalibrationObservationStatus;
  reason?: string | null;
  cameras: CalibrationObservationCameraSummary[];
  frames: CalibrationObservationFrame[];
  artifactRef?: string;
  warnings: string[];
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
  p95TimeDeltaMs?: number;
  reprojectionErrorPx: number;
  reprojectionP95Px: number;
  triangulatedLandmarkRatio: number;
  fallbackLandmarkRatio: number;
  calibrationQualityScore: number;
  intrinsicsFallbackUsed: number;
  extrinsicsFallbackUsed?: number;
  multiViewQualityGain: number;
};

export type QualityReportFinalAnimationSource =
  | "primary_wham"
  | "dual_triangulation_diagnostic"
  | "dual_triangulation_constraint"
  | "true_dual_solve"
  | "unavailable";

export type QualityReportMultiViewReconstructionStatus =
  | "ready"
  | "diagnostic_only"
  | "approximate"
  | "missing_calibration"
  | "invalid_calibration"
  | "missing_pose_frames"
  | "missing_sync"
  | "insufficient_views"
  | "failed"
  | "unavailable"
  | (string & {});

export type QualityReportReadinessStatus =
  | "ready"
  | "approximate"
  | "diagnostic_only"
  | "missing_intrinsics"
  | "missing_extrinsics"
  | "invalid_intrinsics"
  | "invalid_extrinsics"
  | "insufficient_views"
  | "insufficient_calibration"
  | "failed"
  | "skipped"
  | "unavailable"
  | (string & {});

export type CaptureMetadataDeviceCompleteness = {
  deviceIndex: number;
  deviceId?: string;
  deviceRole?: string;
  presentFields: string[];
  missingFields: string[];
  hasAudioTrack: boolean;
  hasIntrinsics: boolean;
  hasFrameTimestamps: boolean;
};

export type CaptureMetadataCompleteness = {
  status: "complete" | "partial" | "minimal" | "missing";
  ratio: number;
  presentFieldCount: number;
  expectedFieldCount: number;
  missingFieldCount: number;
  perDevice: CaptureMetadataDeviceCompleteness[];
};

export type CaptureMetadataDiagnostics = {
  metadataCompleteness: CaptureMetadataCompleteness;
  availableTimestampFields: string[];
  availableCameraMetadataFields: string[];
  hasAudioTrack: boolean;
  hasIntrinsics: boolean;
  hasFrameTimestamps: boolean;
  missingMetadataWarnings: string[];
  audioTrackDeviceCount: number;
  intrinsicsDeviceCount: number;
  frameTimestampDeviceCount: number;
};

export interface QualityReportMultiViewSection {
  enabled: boolean;
  source: WhamInputUsageSource;
  pipelineBranch?: string;
  reconstructionBranchEntered?: boolean;
  workerRuntime?: {
    nodeEnv: string;
    enableMultiViewReconstruction: boolean;
    allowPrimaryWhamFallback: boolean;
    selectedVideoCount?: number;
  };
  reconstructionAvailable: boolean;
  reconstructionUsedForConstraints: boolean;
  primaryWhamFallbackUsed: boolean;
  primaryCameraFallbackUsed: boolean;
  finalAnimationSource: QualityReportFinalAnimationSource;
  reconstructionStatus: QualityReportMultiViewReconstructionStatus;
  dualReconstructionStatus?: QualityReportMultiViewReconstructionStatus;
  trueDualSolveAvailable?: boolean;
  poseDetectorSource?: string;
  poseExtractionStatus?: string;
  poseFramesDevice0Status?: string;
  poseFramesDevice1Status?: string;
  averageKeypointConfidence?: number;
  missingPoseFrameRatio?: number;
  syncStatus?: MultiViewSyncStatus;
  syncMethod?: MultiViewSyncMethod;
  syncConfidence?: number;
  averageTimeDeltaMs?: number;
  p95TimeDeltaMs?: number;
  syncDiagnosticOnly?: boolean;
  intrinsicsStatus?: QualityReportReadinessStatus;
  intrinsicsSource?: string;
  intrinsicsConfidence?: number;
  extrinsicsStatus?: QualityReportReadinessStatus;
  extrinsicsSource?: string;
  extrinsicsConfidence?: number;
  calibrationQualityScore?: number;
  calibrationObservationStatus?: CalibrationObservationStatus;
  calibrationTargetType?: CalibrationTargetType;
  calibrationObservationCount?: number;
  calibrationDetectorSource?: string;
  calibrationObservationConfidence?: number;
  captureVolumeStatus?: CaptureVolumeStatus;
  baselineEstimate?: number;
  reprojectionErrorPx?: number;
  jointTrackStatus?: TriangulatedJointTrackStatus;
  averageJointConfidence?: number;
  occludedJointRatio?: number;
  droppedJointRatio?: number;
  temporalJitterBefore?: number;
  temporalJitterAfter?: number;
  temporalSmoothingGain?: number;
  dualFitStatus?: DualFitStatus;
  dualFitAcceptedAsFinal?: boolean;
  dualFitAcceptance?: DualFitAcceptanceSummary;
  optimizedBvhAvailable?: boolean;
  optimizedSolvedMotionAvailable?: boolean;
  fittingTotalLoss?: number;
  initializationLoss?: number;
  triangulatedJointLoss?: number;
  reprojectionLoss?: number;
  reprojectionImprovementRatio?: number;
  boneLengthConsistencyScore?: number;
  jointLimitViolationCount?: number;
  footContactStabilityScore?: number;
  primaryWhamFallbackReason?: WhamFallbackReason;
  whamInputUsage?: WhamInputUsageMetrics;
  metadataCompleteness?: CaptureMetadataCompleteness;
  availableTimestampFields?: string[];
  availableCameraMetadataFields?: string[];
  hasAudioTrack?: boolean;
  hasIntrinsics?: boolean;
  hasFrameTimestamps?: boolean;
  missingMetadataWarnings?: string[];
  metrics?: {
    syncOffsetMs?: number;
    syncConfidence?: number;
    matchedFrameCount?: number;
    droppedFrameCount?: number;
    averageTimeDeltaMs?: number;
    p95TimeDeltaMs?: number;
    reprojectionErrorPx?: number;
    reprojectionP95Px?: number;
    triangulatedLandmarkRatio?: number;
    fallbackLandmarkRatio?: number;
    calibrationQualityScore?: number;
    baselineEstimate?: number;
    intrinsicsFallbackUsed?: number;
    extrinsicsFallbackUsed?: number;
    calibrationObservationCount?: number;
    calibrationObservationConfidence?: number;
    averageKeypointConfidence?: number;
    missingPoseFrameRatio?: number;
    averageJointConfidence?: number;
    lowConfidenceJointRatio?: number;
    occludedJointRatio?: number;
    smoothedJointRatio?: number;
    interpolatedJointRatio?: number;
    droppedJointRatio?: number;
    temporalJitterBefore?: number;
    temporalJitterAfter?: number;
    temporalSmoothingGain?: number;
    fittingTotalLoss?: number;
    initializationLoss?: number;
    triangulatedJointLoss?: number;
    triangulatedJointMeanPositionErrorBefore?: number;
    triangulatedJointMeanPositionErrorAfter?: number;
    triangulatedJointP95PositionErrorBefore?: number;
    triangulatedJointP95PositionErrorAfter?: number;
    reprojectionLoss?: number;
    reprojectionP95PxBefore?: number;
    reprojectionP95PxAfter?: number;
    reprojectionImprovementRatio?: number;
    boneLengthConsistencyScore?: number;
    boneLengthMeanVariation?: number;
    boneLengthMaxVariation?: number;
    jointLimitViolationCount?: number;
    footContactStabilityScore?: number;
    footLockViolationCount?: number;
    rootTranslationMeanDelta?: number;
    rootTranslationMaxDelta?: number;
    optimizedBvhAvailable?: number;
    optimizedSolvedMotionAvailable?: number;
    reliableConstraintRatio?: number;
    reliableConstraintCount?: number;
    candidateConstraintCount?: number;
    rejectedConstraintCount?: number;
    lowConfidenceConstraintCount?: number;
    highReprojectionConstraintCount?: number;
    invalidConstraintCount?: number;
    optimizedMotionDelta?: number;
    temporalJitterIncreaseRatio?: number;
    multiViewQualityGain?: number;
  };
  poseExtraction?: {
    detectorSource?: string;
    poseDetectorSource?: string;
    status: string;
    poseExtractionStatus: string;
    poseFramesDevice0Status?: string;
    poseFramesDevice1Status?: string;
    deviceStatuses: Record<string, string>;
    averageKeypointConfidence?: number;
    missingPoseFrameRatio?: number;
    warnings?: string[];
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

export type TriangulatedJointTrackStatus =
  | "ready"
  | "diagnostic_only"
  | "missing_pose_frames"
  | "missing_sync"
  | "missing_calibration"
  | "insufficient_views"
  | "low_confidence"
  | "high_reprojection_error"
  | "failed";

export type TriangulatedJointTrackJointStatus =
  | "tracked"
  | "smoothed"
  | "interpolated"
  | "occluded"
  | "dropped"
  | "low_confidence"
  | "high_reprojection_error"
  | "insufficient_views";

export type TriangulatedJointTrackJoint = {
  jointId: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  rawX?: number;
  rawY?: number;
  rawZ?: number;
  confidence?: number;
  sourceCameraIds: readonly string[];
  reprojectionErrorPx?: number;
  status: TriangulatedJointTrackJointStatus;
  reason?: string;
  warnings: readonly string[];
};

export type TriangulatedJointTrackFrameStatus =
  | "ready"
  | "diagnostic_only"
  | "low_confidence"
  | "high_reprojection_error"
  | "insufficient_views";

export type TriangulatedJointTrackFrame = {
  frameIndex: number;
  timestampMs: number;
  sourceFrameIndices: Record<string, number>;
  status: TriangulatedJointTrackFrameStatus;
  joints: readonly TriangulatedJointTrackJoint[];
  warnings: readonly string[];
};

export type TriangulatedJointTrackArtifact = {
  schema: "mocap.triangulated_joint_track.v1";
  takeId: string;
  jobId: string;
  source: MultiViewSource;
  status: TriangulatedJointTrackStatus;
  reason?: string | null;
  coordinateSystem: "right_handed_y_up";
  jointSet: "custom" | "coco17" | "body33" | "smpl_compatible";
  cameraIds: readonly string[];
  frameCount: number;
  trackedFrameCount: number;
  metrics: {
    matchedFrameCount: number;
    triangulatedJointRatio?: number;
    averageReprojectionErrorPx?: number;
    reprojectionP95Px?: number;
    averageJointConfidence?: number;
    lowConfidenceJointRatio?: number;
    occludedJointRatio?: number;
    smoothedJointRatio?: number;
    interpolatedJointRatio?: number;
    droppedJointRatio?: number;
    temporalJitterBefore?: number;
    temporalJitterAfter?: number;
    temporalSmoothingGain?: number;
  };
  frames: readonly TriangulatedJointTrackFrame[];
  warnings: readonly string[];
};

export type DualFitStatus =
  | "ready"
  | "diagnostic_only"
  | "missing_joint_track"
  | "missing_wham_initialization"
  | "insufficient_quality"
  | "optimization_not_implemented"
  | "optimization_failed"
  | "fallback_primary_wham"
  | "failed";

export type DualFitConstraintSet = {
  triangulated3DEnabled: boolean;
  reprojection2DEnabled: boolean;
  boneLengthConsistencyEnabled: boolean;
  jointAngleLimitsEnabled: boolean;
  footContactEnabled: boolean;
  temporalSmoothnessEnabled: boolean;
  centerOfMassEnabled: boolean;
  leftRightConsistencyEnabled: boolean;
};

export type DualFitLossSummary = {
  initializationLoss?: number | null;
  triangulatedJointLoss?: number | null;
  reprojectionLoss?: number | null;
  boneLengthLoss?: number | null;
  jointLimitLoss?: number | null;
  footContactLoss?: number | null;
  temporalSmoothnessLoss?: number | null;
  totalLoss?: number | null;
};

export type DualFitQualityMetrics = {
  triangulatedJointRatio?: number | null;
  reliableConstraintRatio?: number | null;
  reliableConstraintCount?: number | null;
  candidateConstraintCount?: number | null;
  rejectedConstraintCount?: number | null;
  lowConfidenceConstraintCount?: number | null;
  highReprojectionConstraintCount?: number | null;
  invalidConstraintCount?: number | null;
  triangulatedJointMeanPositionErrorBefore?: number | null;
  triangulatedJointMeanPositionErrorAfter?: number | null;
  triangulatedJointP95PositionErrorBefore?: number | null;
  triangulatedJointP95PositionErrorAfter?: number | null;
  averageReprojectionErrorPxBefore?: number | null;
  averageReprojectionErrorPxAfter?: number | null;
  reprojectionP95PxBefore?: number | null;
  reprojectionP95PxAfter?: number | null;
  reprojectionImprovementRatio?: number | null;
  calibrationQualityScore?: number | null;
  temporalJitterBefore?: number | null;
  temporalJitterAfter?: number | null;
  temporalJitterIncreaseRatio?: number | null;
  temporalSmoothingGain?: number | null;
  boneLengthConsistencyScore?: number | null;
  boneLengthMeanVariation?: number | null;
  boneLengthMaxVariation?: number | null;
  jointLimitViolationCount?: number | null;
  footContactStabilityScore?: number | null;
  footLockViolationCount?: number | null;
  rootTranslationMeanDelta?: number | null;
  rootTranslationMaxDelta?: number | null;
  optimizedMotionDelta?: number | null;
  optimizedMotionValid?: boolean | null;
  optimizedBvhValid?: boolean | null;
  optimizedArtifactsPresent?: boolean | null;
  fullSmplOptimization?: boolean | null;
  acceptedAsFinalAnimation: boolean;
};

export type DualFitGateFailureCode =
  | "calibration_not_ready"
  | "calibration_quality_low"
  | "triangulated_joint_ratio_low"
  | "triangulated_joint_ratio_unavailable"
  | "reliable_constraint_ratio_low"
  | "reliable_constraint_ratio_unavailable"
  | "reprojection_error_high"
  | "reprojection_error_unavailable"
  | "reprojection_p95_high"
  | "optimized_motion_invalid"
  | "optimized_bvh_missing"
  | "optimized_bvh_invalid"
  | "optimized_artifacts_missing"
  | "temporal_jitter_increased"
  | "temporal_jitter_unavailable"
  | "joint_limit_violation_high"
  | "joint_limit_unavailable"
  | "excessive_motion_delta"
  | "insufficient_motion_delta"
  | "bone_length_consistency_low"
  | "bone_length_consistency_unavailable"
  | "foot_contact_stability_low"
  | "foot_contact_stability_unavailable";

export type DualFitFinalAnimationSourceRecommendation =
  | "true_dual_solve"
  | "primary_wham";

export type DualFitAcceptanceSummary = {
  accepted: boolean;
  blockingFailures: DualFitGateFailureCode[];
  warnings: DualFitGateFailureCode[];
  unavailableMetrics: string[];
  metrics: Partial<
    Record<keyof DualFitQualityMetrics, number | boolean | null>
  >;
  finalAnimationSourceRecommendation: DualFitFinalAnimationSourceRecommendation;
};

export type DualFitQualityGateSummary = {
  passed: number;
  failed: number;
  blockingFailed: number;
  warningFailed: number;
  accepted?: boolean;
  blockingFailures?: DualFitGateFailureCode[];
  warnings?: DualFitGateFailureCode[];
  unavailableMetrics?: string[];
  metrics?: DualFitAcceptanceSummary["metrics"];
  finalAnimationSourceRecommendation?: DualFitFinalAnimationSourceRecommendation;
};

export type DualFitQualityGateResult = {
  name:
    | "triangulated_joint_ratio"
    | "reliable_constraint_ratio"
    | "calibration_readiness"
    | "calibration_quality"
    | "reprojection_error"
    | "reprojection_p95"
    | "temporal_jitter"
    | "temporal_jitter_increase"
    | "bone_length_consistency"
    | "joint_limit_violations"
    | "foot_contact_stability"
    | "root_translation_delta"
    | "optimized_motion_delta"
    | "optimized_motion_valid"
    | "optimized_bvh_valid"
    | "optimized_artifacts_present";
  passed: boolean;
  value?: number | string | boolean | null;
  threshold?: number | string | boolean | null;
  severity: "blocking" | "warning";
  code?: DualFitGateFailureCode | null;
  reason?: string | null;
};

export type DualFitReportArtifact = {
  schema: "mocap.dual_fit_report.v1";
  takeId: string;
  jobId: string;
  status: DualFitStatus;
  reason?: string | null;
  inputSources: {
    initialization: "primary_wham" | "unavailable";
    jointTrack?: "triangulated_joint_track_json" | null;
    pose2D: readonly string[];
    calibration?: "camera_calibration_json" | null;
  };
  constraints: DualFitConstraintSet;
  losses: DualFitLossSummary;
  metrics: DualFitQualityMetrics;
  qualityGates: readonly DualFitQualityGateResult[];
  acceptance?: DualFitAcceptanceSummary;
  acceptedAsFinalAnimation: boolean;
  finalAnimationSourceCandidate: "primary_wham" | "true_dual_solve";
  artifactRefs: Record<string, string>;
  warnings: readonly string[];
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
    rotationOrder: "ZXY";
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
  optimizedFrom?: {
    source: "primary_wham";
    method: "dual_camera_constrained_skeleton_adjustment" | "kinematic_post_fit";
    constraintsApplied: number;
    acceptedAsFinalAnimation: boolean;
    warnings: string[];
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

export type MotionPipelineStageName =
  | "video_normalization"
  | "primary_wham"
  | "per_camera_pose_extraction"
  | "frame_sync"
  | "calibration_target_detection"
  | "camera_intrinsics"
  | "camera_extrinsics"
  | "capture_volume"
  | "camera_calibration"
  | "dual_triangulation"
  | "triangulated_joint_tracking"
  | "dual_camera_fitting"
  | "dual_reconstruction_artifacts"
  | "quality_report"
  | "final_animation_export";

export type MotionPipelineStageResultStatus =
  | "completed"
  | "ready"
  | "approximate"
  | "diagnostic_only"
  | "missing_pose_frames"
  | "missing_timestamps"
  | "missing_calibration_observations"
  | "missing_intrinsics"
  | "missing_extrinsics"
  | "insufficient_views"
  | "insufficient_calibration"
  | "skipped"
  | "failed";

export type MotionPipelineStageStatus = {
  stageName: MotionPipelineStageName;
  status: MotionPipelineStageResultStatus;
  reason: string;
  targetType?: CalibrationTargetType;
  detectorSource?: string;
  observationCount?: number;
  averageConfidence?: number;
  calibrationObservationStatus?: CalibrationObservationStatus;
  captureVolumeStatus?: CaptureVolumeStatus;
  intrinsicsStatus?: QualityReportReadinessStatus;
  intrinsicsSource?: string;
  intrinsicsConfidence?: number;
  extrinsicsStatus?: QualityReportReadinessStatus;
  extrinsicsSource?: string;
  extrinsicsConfidence?: number;
  calibrationQualityScore?: number;
  baselineEstimate?: number;
  confidence?: number;
  qualityScore?: number;
  syncMethod?: MultiViewSyncMethod;
  averageTimeDeltaMs?: number;
  p95TimeDeltaMs?: number;
  syncConfidence?: number;
  matchedFrameCount?: number;
  jointTrackStatus?: TriangulatedJointTrackStatus;
  dualFitStatus?: DualFitStatus;
  acceptedAsFinalAnimation?: boolean;
  finalAnimationSource?: QualityReportFinalAnimationSource;
  qualityGateSummary?: DualFitQualityGateSummary;
  triangulatedJointRatio?: number;
  averageReprojectionErrorPx?: number;
  temporalJitterAfter?: number;
  artifactRef?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  artifactRefs: Record<string, string>;
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
    motionFallbackUsed: boolean;
    reasons: string[];
  };
  runtime?: {
    nodeEnv: string;
    captureMode: "solo" | "dual" | "pro_4_camera";
    selectedVideoCount: number;
    selectedPipelineBranch: string;
    reconstructionBranchEntered: boolean;
    enableMultiViewReconstruction: boolean;
    allowPrimaryWhamFallback: boolean;
  };
  finalAnimationSource: QualityReportFinalAnimationSource;
  artifacts: {
    smplParameters: string;
    rawSolvedMotion: string;
    solvedMotion: string;
    cleanupReport: string;
    qualityReport: string;
    previewSummary: string;
    overlayPreview?: string;
    bvh: string;
    optimizedSolvedMotion?: string;
    optimizedBvh?: string;
  };
  quality: {
    score: number;
    grade: QualityReport["grade"];
    warnings: string[];
    errors: string[];
  };
  stages?: MotionPipelineStageStatus[];
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
