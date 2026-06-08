import type {
  CaptureCameraPosition,
  CaptureVideoOrientation,
} from "./CaptureMetadata";
import type { LandmarkBuffer } from "./Landmark";
import { LANDMARK_STRIDE } from "./Landmark";

export type TrackingProfile = "pose" | "holistic";
export type TrackingProfileRequest = TrackingProfile | "auto";

export type FaceBlendshape = Readonly<{
  index: number;
  name: string;
  score: number;
  displayName?: string;
}>;

export type PoseFrame = Readonly<{
  ts: number; // ms
  landmarks: LandmarkBuffer; // pose landmarks, Float32Array (N*4)
  worldLandmarks?: LandmarkBuffer; // metric-ish 3D pose landmarks when native layer provides them
  faceLandmarks?: LandmarkBuffer;
  leftHandLandmarks?: LandmarkBuffer;
  leftHandWorldLandmarks?: LandmarkBuffer;
  rightHandLandmarks?: LandmarkBuffer;
  rightHandWorldLandmarks?: LandmarkBuffer;
  faceBlendshapes?: readonly FaceBlendshape[];
  hasPoseSegmentationMask?: boolean;
  trackingProfile?: TrackingProfile;
  requestedTrackingProfile?: TrackingProfileRequest;
  fps?: number;
  frameId?: number;
  /** Which device produced this frame (for multi-view) */
  sourceDevice?: string;
  /** Whether this frame contains triangulated 3D data */
  triangulated?: boolean;
  /** Landmark x/y coordinate contract. Defaults to image_normalized for legacy frames. */
  coordinateSpace?: "image_normalized" | "preview_normalized";
  /** Upright image dimensions that normalized x/y coordinates refer to. */
  imageWidth?: number;
  imageHeight?: number;
  /** Raw camera buffer dimensions before native orientation correction, when known. */
  inputImageWidth?: number;
  inputImageHeight?: number;
  videoOrientation?: CaptureVideoOrientation;
  cameraPosition?: CaptureCameraPosition;
  isMirrored?: boolean;
  orientationCorrection?: string;
}>;

function countBuffer(buf?: LandmarkBuffer) {
  return buf ? Math.floor(buf.length / LANDMARK_STRIDE) : 0;
}

function countTrackedBuffer(buf?: LandmarkBuffer, minConfidence = 0.01) {
  if (!buf) return 0;

  let tracked = 0;
  for (let index = 0; index < buf.length; index += LANDMARK_STRIDE) {
    if ((buf[index + 3] ?? 0) >= minConfidence) {
      tracked += 1;
    }
  }

  return tracked;
}

export function countTrackedLandmarks(frame?: PoseFrame, minConfidence = 0.01) {
  if (!frame) return 0;
  return (
    countTrackedBuffer(frame.landmarks, minConfidence) +
    countTrackedBuffer(frame.faceLandmarks, minConfidence) +
    countTrackedBuffer(frame.leftHandLandmarks, minConfidence) +
    countTrackedBuffer(frame.rightHandLandmarks, minConfidence)
  );
}
