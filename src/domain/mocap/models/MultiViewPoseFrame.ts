/**
 * MultiViewPoseFrame – A frame that contains data from two camera views
 * plus the triangulated 3D result.
 */

import type { LandmarkBuffer } from "./Landmark";
import type { PoseFrame, TrackingProfile } from "./PoseFrame";

/**
 * A single multi-view frame combining data from two cameras.
 */
export type MultiViewPoseFrame = Readonly<{
  /** Timestamp in host clock (ms) */
  ts: number;

  /** Frame from Camera A (host/local) */
  frameA: PoseFrame;

  /** Frame from Camera B (guest/remote), timestamp adjusted to host clock */
  frameB: PoseFrame;

  /** Triangulated 3D landmarks [x,y,z,c, ...] in world coordinates */
  triangulated3D: LandmarkBuffer;

  /** Per-landmark reprojection errors */
  reprojErrors: Float32Array;

  /** Average reprojection error across all landmarks */
  avgReprojError: number;

  /** Number of landmarks successfully triangulated */
  triangulatedCount: number;

  /** Absolute time difference between the two matched frames (ms) */
  timeDelta: number;

  /** Source device IDs */
  deviceA: string;
  deviceB: string;

  /** Tracking profile used */
  trackingProfile: TrackingProfile;

  /** Sequential frame ID */
  frameId: number;
}>;

/**
 * Stereo calibration result stored with a Take.
 */
export type StereoCalibrationResult = Readonly<{
  /** 3×3 rotation matrix (row-major, 9 elements) — Camera B relative to Camera A */
  rotation: readonly number[];

  /** 3×1 translation vector (3 elements) — Camera B relative to Camera A */
  translation: readonly number[];

  /** 3×3 intrinsic matrix for Camera A (row-major, 9 elements) */
  intrinsicA: readonly number[];

  /** 3×3 intrinsic matrix for Camera B (row-major, 9 elements) */
  intrinsicB: readonly number[];

  /** 3×4 projection matrix for Camera A (row-major, 12 elements) */
  projectionA: readonly number[];

  /** 3×4 projection matrix for Camera B (row-major, 12 elements) */
  projectionB: readonly number[];

  /** Calibration quality score (0..1) */
  qualityScore: number;

  /** Average reprojection error from calibration landmarks (pixels) */
  reprojError: number;

  /** Baseline distance between cameras (world units) */
  baseline: number;

  /** Angle between camera optical axes (degrees) */
  convergenceAngle: number;

  /** When calibration was performed */
  calibratedAt: number;

  /** Number of landmark pairs used for calibration */
  pointPairsUsed: number;
}>;

/**
 * Capture mode discriminator.
 */
export type CaptureMode = "solo" | "dual-camera" | "pro-4-camera";
