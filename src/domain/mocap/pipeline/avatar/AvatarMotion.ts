import { lmAt, type LandmarkBuffer } from "../../models/Landmark";
import {
  MP33,
  JOINT_NAMES,
  RIG,
  mpLandmarkToRig,
  mp33ToJointPose,
  type JointName,
} from "../../models/BodyPose33";
import type { FaceBlendshape, PoseFrame } from "../../models/PoseFrame";
import type { CalibrationPose } from "../../models/Take";
import type { JointPose, Vec3 } from "../../models/Skeleton";
import { add, cross, len, mul, sub, v3 } from "../../models/Skeleton";
import { canonicalizeHumanoidRestPose } from "../export/CanonicalHumanoidPose";
import {
  averageJointPose,
  buildJointRotations,
  buildLocalDeltaRotations,
  derivePoseMeta,
  type JointRotationState,
  type JointVectorMap,
  type PoseMeta,
  type RotationSignals,
} from "../retarget/RotationMath";
import type { Quaternion } from "../retarget/Quaternion";

export const AVATAR_MOTION_ENGINE_VERSION = "avatar-motion-v1" as const;

export type AvatarMotionSourceSpace = "normalized" | "world" | "triangulated";

export type AvatarMotionCalibration = Readonly<{
  solverVersion: typeof AVATAR_MOTION_ENGINE_VERSION;
  sourceSpace: AvatarMotionSourceSpace;
  targetPose: CalibrationPose;
  mirrorX: boolean;
  preserveRootMotion: boolean;
  scaleMultiplier: number;
  calibrationFrameCount: number;
  rawRestPose: JointPose;
  restPose: JointPose;
  restMeta: PoseMeta;
  restSignals: RotationSignals;
  restStates: Record<JointName, JointRotationState>;
  restOffsets: Record<JointName, Vec3>;
}>;

export type AvatarSolvedFrame = Readonly<{
  time: number;
  sourceSpace: AvatarMotionSourceSpace;
  sourcePose: JointPose;
  pose: JointPose;
  poseQuality: number;
  rootTranslation: Vec3;
  localRotations: Record<JointName, Quaternion>;
  localDeltas: Record<JointName, Quaternion>;
  faceBlendshapes?: readonly FaceBlendshape[];
}>;

export type AvatarMotionClip = Readonly<{
  fps: number;
  duration: number;
  nodeOrder: readonly JointName[];
  calibration: AvatarMotionCalibration;
  frames: readonly AvatarSolvedFrame[];
}>;

export type AvatarMotionOptions = Readonly<{
  fps?: number;
  calibrationFrames?: number;
  sourceSpace?: AvatarMotionSourceSpace | "auto";
  targetPose?: CalibrationPose;
  preserveRootMotion?: boolean | "auto";
  scaleMultiplier?: number;
}>;

type LandmarkSpace = "normalized" | "world";

function average(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function effectiveLandmarkSpace(sourceSpace: AvatarMotionSourceSpace): LandmarkSpace {
  return sourceSpace === "normalized" ? "normalized" : "world";
}

function shouldMirrorX(pose: JointPose) {
  const leftAverage = average([
    pose.LeftShoulder.x,
    pose.LeftUpperArm.x,
    pose.LeftUpperLeg.x,
  ]);
  const rightAverage = average([
    pose.RightShoulder.x,
    pose.RightUpperArm.x,
    pose.RightUpperLeg.x,
  ]);

  return leftAverage > rightAverage;
}

function mirrorVecX(vector: Vec3): Vec3 {
  return { x: -vector.x, y: vector.y, z: vector.z };
}

function mirrorPoseX(pose: JointPose): JointPose {
  return {
    Hips: mirrorVecX(pose.Hips),
    Spine: mirrorVecX(pose.Spine),
    Chest: mirrorVecX(pose.Chest),
    Neck: mirrorVecX(pose.Neck),
    Head: mirrorVecX(pose.Head),
    LeftShoulder: mirrorVecX(pose.LeftShoulder),
    LeftUpperArm: mirrorVecX(pose.LeftUpperArm),
    LeftLowerArm: mirrorVecX(pose.LeftLowerArm),
    LeftHand: mirrorVecX(pose.LeftHand),
    RightShoulder: mirrorVecX(pose.RightShoulder),
    RightUpperArm: mirrorVecX(pose.RightUpperArm),
    RightLowerArm: mirrorVecX(pose.RightLowerArm),
    RightHand: mirrorVecX(pose.RightHand),
    LeftUpperLeg: mirrorVecX(pose.LeftUpperLeg),
    LeftLowerLeg: mirrorVecX(pose.LeftLowerLeg),
    LeftFoot: mirrorVecX(pose.LeftFoot),
    LeftToes: mirrorVecX(pose.LeftToes),
    RightUpperLeg: mirrorVecX(pose.RightUpperLeg),
    RightLowerLeg: mirrorVecX(pose.RightLowerLeg),
    RightFoot: mirrorVecX(pose.RightFoot),
    RightToes: mirrorVecX(pose.RightToes),
  };
}

function mirrorJointVectorMapX(map?: JointVectorMap): JointVectorMap | undefined {
  if (!map) {
    return undefined;
  }

  const out: JointVectorMap = {};
  for (const joint of JOINT_NAMES) {
    const value = map[joint];
    if (value) {
      out[joint] = mirrorVecX(value);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function mirrorRotationSignalsX(signals?: RotationSignals): RotationSignals | undefined {
  if (!signals) {
    return undefined;
  }

  const primaryAxes = mirrorJointVectorMapX(signals.primaryAxes);
  const directHints = mirrorJointVectorMapX(signals.directHints);
  const fallbackHints = mirrorJointVectorMapX(signals.fallbackHints);

  if (!primaryAxes && !directHints && !fallbackHints) {
    return undefined;
  }

  return {
    primaryAxes,
    directHints,
    fallbackHints,
  };
}

function mergeJointVectorMaps(
  base?: JointVectorMap,
  extra?: JointVectorMap,
): JointVectorMap | undefined {
  if (!base && !extra) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
}

function mergeRotationSignals(
  base?: RotationSignals,
  extra?: RotationSignals,
): RotationSignals | undefined {
  const primaryAxes = mergeJointVectorMaps(base?.primaryAxes, extra?.primaryAxes);
  const directHints = mergeJointVectorMaps(base?.directHints, extra?.directHints);
  const fallbackHints = mergeJointVectorMaps(base?.fallbackHints, extra?.fallbackHints);

  if (!primaryAxes && !directHints && !fallbackHints) {
    return undefined;
  }

  return {
    primaryAxes,
    directHints,
    fallbackHints,
  };
}

function averageVec3(samples: readonly Vec3[], fallback?: Vec3): Vec3 | null {
  if (samples.length === 0) {
    return fallback ?? null;
  }

  let sum = v3(0, 0, 0);
  for (const sample of samples) {
    sum = add(sum, sample);
  }
  return mul(sum, 1 / samples.length);
}

function poseLandmarkSource(
  frame: PoseFrame,
  preferredSpace: LandmarkSpace,
): { buffer: LandmarkBuffer; space: LandmarkSpace } {
  if (preferredSpace === "world" && frame.worldLandmarks) {
    return { buffer: frame.worldLandmarks, space: "world" };
  }
  return { buffer: frame.landmarks, space: "normalized" };
}

function poseLandmarkVector(
  frame: PoseFrame,
  preferredSpace: LandmarkSpace,
  index: number,
  minConfidence = 0.12,
): Vec3 | null {
  const { buffer, space } = poseLandmarkSource(frame, preferredSpace);
  const confidence = lmAt(buffer, index).c ?? 0;
  if (confidence < minConfidence) {
    return null;
  }

  return mpLandmarkToRig(buffer, index, { scale: 100, space });
}

function handAcrossVector(
  frame: PoseFrame,
  preferredSpace: LandmarkSpace,
  side: "left" | "right",
): Vec3 | null {
  const indexPoint = poseLandmarkVector(
    frame,
    preferredSpace,
    side === "left" ? MP33.LEFT_INDEX : MP33.RIGHT_INDEX,
  );
  const thumbPoint = poseLandmarkVector(
    frame,
    preferredSpace,
    side === "left" ? MP33.LEFT_THUMB : MP33.RIGHT_THUMB,
  );
  const pinkyPoint = poseLandmarkVector(
    frame,
    preferredSpace,
    side === "left" ? MP33.LEFT_PINKY : MP33.RIGHT_PINKY,
  );

  const thumbSide = averageVec3(
    [indexPoint, thumbPoint].filter((value): value is Vec3 => Boolean(value)),
  );
  if (!thumbSide || !pinkyPoint) {
    return null;
  }

  const across = sub(thumbSide, pinkyPoint);
  return len(across) > 1e-5 ? across : null;
}

function forearmPlaneHint(
  forearm: Vec3,
  across: Vec3 | null,
): Vec3 | null {
  if (!across || len(forearm) < 1e-5) {
    return null;
  }

  const planeHint = cross(forearm, across);
  return len(planeHint) > 1e-5 ? planeHint : null;
}

function deriveFrameRotationSignals(
  frame: PoseFrame,
  preferredSpace: LandmarkSpace,
  pose: JointPose,
): RotationSignals | undefined {
  const leftAcross = handAcrossVector(frame, preferredSpace, "left");
  const rightAcross = handAcrossVector(frame, preferredSpace, "right");
  const leftPlane = forearmPlaneHint(sub(pose.LeftHand, pose.LeftLowerArm), leftAcross);
  const rightPlane = forearmPlaneHint(sub(pose.RightHand, pose.RightLowerArm), rightAcross);

  const directHints: JointVectorMap = {};
  const fallbackHints: JointVectorMap = {};

  if (leftAcross) {
    directHints.LeftHand = leftAcross;
    fallbackHints.LeftLowerArm = leftAcross;
  }
  if (rightAcross) {
    directHints.RightHand = rightAcross;
    fallbackHints.RightLowerArm = rightAcross;
  }
  if (leftPlane) {
    fallbackHints.LeftUpperArm = leftPlane;
  }
  if (rightPlane) {
    fallbackHints.RightUpperArm = rightPlane;
  }

  if (!Object.keys(directHints).length && !Object.keys(fallbackHints).length) {
    return undefined;
  }

  return {
    directHints: Object.keys(directHints).length ? directHints : undefined,
    fallbackHints: Object.keys(fallbackHints).length ? fallbackHints : undefined,
  };
}

function buildRestRotationSignals(
  restPose: JointPose,
  restMeta: PoseMeta,
): RotationSignals {
  const leftAcross = restMeta.torsoForward;
  const rightAcross = mul(restMeta.torsoForward, -1);
  const leftPlane =
    forearmPlaneHint(sub(restPose.LeftHand, restPose.LeftLowerArm), leftAcross) ??
    restMeta.torsoUp;
  const rightPlane =
    forearmPlaneHint(sub(restPose.RightHand, restPose.RightLowerArm), rightAcross) ??
    restMeta.torsoUp;

  return {
    directHints: {
      LeftHand: leftAcross,
      RightHand: rightAcross,
    },
    fallbackHints: {
      LeftUpperArm: leftPlane,
      RightUpperArm: rightPlane,
      LeftLowerArm: leftAcross,
      RightLowerArm: rightAcross,
    },
  };
}

function selectSourceSpace(
  frames: readonly PoseFrame[],
  requested: AvatarMotionOptions["sourceSpace"],
): AvatarMotionSourceSpace {
  if (requested && requested !== "auto") {
    return requested;
  }

  if (frames.every((frame) => frame.triangulated && frame.worldLandmarks)) {
    return "triangulated";
  }
  if (frames.every((frame) => frame.worldLandmarks)) {
    return "world";
  }
  return "normalized";
}

function toJointPose(frame: PoseFrame, sourceSpace: AvatarMotionSourceSpace): JointPose {
  const preferredSpace = effectiveLandmarkSpace(sourceSpace);
  if (preferredSpace === "world" && frame.worldLandmarks) {
    return mp33ToJointPose(frame.worldLandmarks, { scale: 100, space: "world" });
  }
  return mp33ToJointPose(frame.landmarks, { scale: 100, space: "normalized" });
}

function calibrationFrameCount(frameCount: number, fps: number, requested?: number) {
  if (requested) {
    return Math.max(1, Math.min(frameCount, requested));
  }
  return Math.max(1, Math.min(frameCount, Math.max(4, Math.round(fps * 0.15))));
}

function shouldPreserveRootMotion(
  poses: readonly JointPose[],
  rest: JointPose,
  mode: boolean | "auto",
) {
  if (mode !== "auto") {
    return mode;
  }

  const shoulderWidth = Math.max(len(sub(rest.RightUpperArm, rest.LeftUpperArm)), 1);
  let maxDisplacement = 0;

  for (const pose of poses) {
    maxDisplacement = Math.max(maxDisplacement, len(sub(pose.Hips, rest.Hips)));
  }

  return maxDisplacement > shoulderWidth * 0.18;
}

export function buildAvatarRestOffsets(
  rest: JointPose,
  scaleMultiplier: number,
): Record<JointName, Vec3> {
  const offsets = {} as Record<JointName, Vec3>;
  for (const joint of RIG) {
    offsets[joint.name] = joint.parent
      ? {
          x: (rest[joint.name].x - rest[joint.parent].x) * scaleMultiplier,
          y: (rest[joint.name].y - rest[joint.parent].y) * scaleMultiplier,
          z: (rest[joint.name].z - rest[joint.parent].z) * scaleMultiplier,
        }
      : v3(0, 0, 0);
  }
  return offsets;
}

function framePoseQuality(frame: PoseFrame) {
  const core = [
    MP33.LEFT_SHOULDER,
    MP33.RIGHT_SHOULDER,
    MP33.LEFT_HIP,
    MP33.RIGHT_HIP,
    MP33.LEFT_KNEE,
    MP33.RIGHT_KNEE,
    MP33.LEFT_ANKLE,
    MP33.RIGHT_ANKLE,
  ];
  const extremities = [
    MP33.LEFT_WRIST,
    MP33.RIGHT_WRIST,
    MP33.LEFT_FOOT_INDEX,
    MP33.RIGHT_FOOT_INDEX,
  ];

  const coreScore =
    core.reduce((sum, index) => sum + Math.max(0, Math.min(1, lmAt(frame.landmarks, index).c)), 0) /
    core.length;
  const extremityScore =
    extremities.reduce(
      (sum, index) => sum + Math.max(0, Math.min(1, lmAt(frame.landmarks, index).c)),
      0,
    ) / extremities.length;

  return Math.max(0, Math.min(1, coreScore * 0.75 + extremityScore * 0.25));
}

export function createAvatarMotionCalibration(
  frames: readonly PoseFrame[],
  opts?: AvatarMotionOptions,
): AvatarMotionCalibration {
  if (frames.length === 0) {
    throw new Error("No frames available for avatar calibration.");
  }

  const fps = opts?.fps ?? 30;
  const sourceSpace = selectSourceSpace(frames, opts?.sourceSpace ?? "auto");
  const sourcePoses = frames.map((frame) => toJointPose(frame, sourceSpace));
  const sourceRestPose = averageJointPose(
    sourcePoses.slice(0, calibrationFrameCount(sourcePoses.length, fps, opts?.calibrationFrames)),
  );
  const mirrorX = shouldMirrorX(sourceRestPose);
  const poses = mirrorX ? sourcePoses.map((pose) => mirrorPoseX(pose)) : sourcePoses;
  const rawRestPose = mirrorX ? mirrorPoseX(sourceRestPose) : sourceRestPose;
  const targetPose = opts?.targetPose ?? "a-pose";
  const scaleMultiplier = opts?.scaleMultiplier ?? 1;
  const restPose = canonicalizeHumanoidRestPose(rawRestPose, { targetPose });
  const restMeta = derivePoseMeta(restPose);
  const restSignals = buildRestRotationSignals(restPose, restMeta);
  const restStates = buildJointRotations(restPose, restMeta, undefined, restSignals);
  const preserveRootMotion = shouldPreserveRootMotion(
    poses,
    rawRestPose,
    opts?.preserveRootMotion ?? "auto",
  );

  return {
    solverVersion: AVATAR_MOTION_ENGINE_VERSION,
    sourceSpace,
    targetPose,
    mirrorX,
    preserveRootMotion,
    scaleMultiplier,
    calibrationFrameCount: calibrationFrameCount(frames.length, fps, opts?.calibrationFrames),
    rawRestPose,
    restPose,
    restMeta,
    restSignals,
    restStates,
    restOffsets: buildAvatarRestOffsets(restPose, scaleMultiplier),
  };
}

export function solveAvatarMotionFrame(
  frame: PoseFrame,
  calibration: AvatarMotionCalibration,
  time = 0,
): AvatarSolvedFrame {
  const sourcePose = toJointPose(frame, calibration.sourceSpace);
  const preferredSpace = effectiveLandmarkSpace(calibration.sourceSpace);
  const sourceSignals = deriveFrameRotationSignals(frame, preferredSpace, sourcePose);
  const pose = calibration.mirrorX ? mirrorPoseX(sourcePose) : sourcePose;
  const signals = calibration.mirrorX
    ? mirrorRotationSignalsX(sourceSignals)
    : sourceSignals;
  const states = buildJointRotations(
    pose,
    calibration.restMeta,
    calibration.restStates,
    mergeRotationSignals(calibration.restSignals, signals),
  );
  const rootTranslation = calibration.preserveRootMotion
    ? {
        x: (pose.Hips.x - calibration.restPose.Hips.x) * calibration.scaleMultiplier,
        y: (pose.Hips.y - calibration.restPose.Hips.y) * calibration.scaleMultiplier,
        z: (pose.Hips.z - calibration.restPose.Hips.z) * calibration.scaleMultiplier,
      }
    : v3(0, 0, 0);

  const localRotations = {} as Record<JointName, Quaternion>;
  for (const joint of JOINT_NAMES) {
    localRotations[joint] = states[joint].local;
  }

  return {
    time,
    sourceSpace: calibration.sourceSpace,
    sourcePose,
    pose,
    poseQuality: framePoseQuality(frame),
    rootTranslation,
    localRotations,
    localDeltas: buildLocalDeltaRotations(states, calibration.restStates),
    faceBlendshapes: frame.faceBlendshapes,
  };
}

export function buildAvatarMotionClip(
  frames: readonly PoseFrame[],
  opts?: AvatarMotionOptions,
): AvatarMotionClip {
  const fps = opts?.fps ?? 30;
  const calibration = createAvatarMotionCalibration(frames, opts);
  const solvedFrames = frames.map((frame, index) =>
    solveAvatarMotionFrame(frame, calibration, index / fps),
  );

  return {
    fps,
    duration: solvedFrames[solvedFrames.length - 1]?.time ?? 0,
    nodeOrder: JOINT_NAMES,
    calibration,
    frames: solvedFrames,
  };
}
