import type {
  CalibrationObservationStatus,
  CalibrationObservationsArtifact,
  CalibrationTargetType,
} from "../types";

export type CalibrationDetectorName =
  | "disabled"
  | "fixture"
  | "opencv_apriltag"
  | "opencv_checkerboard"
  | "opencv_charuco";

export type CalibrationDetectorConfig = {
  fixture?: unknown;
  fixturePath?: string;
  cliPath?: string;
  timeoutMs?: number;
  [key: string]: unknown;
};

export type CalibrationDetectionCameraInput = {
  cameraId: string;
  deviceId?: string;
  calibrationVideoPath?: string;
  normalizedVideoPath?: string;
  videoMetadata?: {
    fps?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    frameCount?: number;
  };
};

export type CalibrationDetectionInput = {
  takeId?: string;
  jobId: string;
  sessionId?: string | null;
  cameraId?: string;
  deviceId?: string;
  calibrationVideoPath?: string;
  normalizedVideoPath?: string;
  targetType: CalibrationTargetType;
  detectorConfig?: CalibrationDetectorConfig;
  videoMetadata?: CalibrationDetectionCameraInput["videoMetadata"];
  outputArtifactName?: string;
  cameras?: readonly CalibrationDetectionCameraInput[];
};

export type CalibrationDetectionResult = CalibrationObservationsArtifact;

export type CalibrationTargetDetectorAdapter = {
  name: string;
  version: string;
  detectCalibrationObservations(
    input: CalibrationDetectionInput,
  ): Promise<CalibrationDetectionResult>;
};

export type CalibrationDetectorRuntimeConfig = {
  detector: CalibrationDetectorName;
  targetType: CalibrationTargetType;
  cliPath?: string;
  timeoutMs: number;
};

export type CalibrationDetectorRuntimeCheck = {
  status: CalibrationObservationStatus;
  reason?: string;
  warnings: string[];
};
