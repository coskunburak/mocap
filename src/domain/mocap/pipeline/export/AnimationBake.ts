import { lmAt, type LandmarkBuffer } from "../../models/Landmark";
import {
  MP33,
  JOINT_NAMES,
  RIG,
  mpLandmarkToRig,
  mp33ToJointPose,
  type JointName,
} from "../../models/MediapipePose33";
import type { PoseFrame } from "../../models/PoseFrame";
import type { CalibrationPose } from "../../models/Take";
import type { JointPose, Vec3 } from "../../models/Skeleton";
import { add, cross, len, mul, sub, v3 } from "../../models/Skeleton";
import { getExportPreset, type ExportPresetId } from "./ExportPresets";
import {
  buildJointRotations,
  derivePoseMeta,
  averageJointPose,
  type JointVectorMap,
  type RotationSignals,
} from "../retarget/RotationMath";
import { getRetargetPreset } from "../retarget/BoneMap";
import type { Quaternion } from "../retarget/Quaternion";
import { canonicalizeHumanoidRestPose } from "./CanonicalHumanoidPose";

export type BakedNode = Readonly<{
  sourceJoint: JointName;
  name: string;
  parentIndex: number | null;
  offset: Vec3;
}>;

export type BakedFrame = Readonly<{
  time: number;
  rootTranslation: Vec3;
  rotations: readonly Quaternion[];
}>;

export type BakedAnimation = Readonly<{
  fps: number;
  duration: number;
  presetId: ExportPresetId;
  nodeOrder: readonly JointName[];
  nodes: readonly BakedNode[];
  frames: readonly BakedFrame[];
  restPose: JointPose;
  restOffsets: Readonly<Record<JointName, Vec3>>;
  restLocalRotations: readonly Quaternion[];
  scaleMultiplier: number;
}>;

type BakeOptions = {
  fps?: number;
  calibrationFrames?: number;
  presetId?: ExportPresetId;
  preserveRootMotion?: boolean | "auto";
  targetPose?: CalibrationPose;
};

type LandmarkSpace = "normalized" | "world";

const ROOT: JointName = "Hips";

function average(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shouldMirrorForExport(pose: JointPose) {
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
): { buffer: LandmarkBuffer; space: "normalized" | "world" } {
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
  restMeta: ReturnType<typeof derivePoseMeta>,
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

function selectLandmarkSpace(frames: readonly PoseFrame[]): LandmarkSpace {
  return frames.every((frame) => frame.worldLandmarks) ? "world" : "normalized";
}

function toJointPose(frame: PoseFrame, preferredSpace: LandmarkSpace): JointPose {
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

function shouldPreserveRootMotion(poses: readonly JointPose[], rest: JointPose, mode: boolean | "auto") {
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

function buildRestOffsets(rest: JointPose, scaleMultiplier: number): Record<JointName, Vec3> {
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

export function bakeAnimation(frames: readonly PoseFrame[], opts?: BakeOptions): BakedAnimation {
  if (frames.length === 0) {
    throw new Error("No frames to bake.");
  }

  const fps = opts?.fps ?? 30;
  const preset = getExportPreset(opts?.presetId ?? "dcc-archive");
  const retargetPreset = getRetargetPreset(preset.retargetPresetId);
  const preferredSpace = selectLandmarkSpace(frames);
  const sourcePoses = frames.map((frame) => toJointPose(frame, preferredSpace));
  const sourceSignals = frames.map((frame, index) =>
    deriveFrameRotationSignals(frame, preferredSpace, sourcePoses[index]),
  );
  const sourceRestPose = averageJointPose(
    sourcePoses.slice(0, calibrationFrameCount(sourcePoses.length, fps, opts?.calibrationFrames)),
  );
  const mirrorForExport = shouldMirrorForExport(sourceRestPose);
  const poses = mirrorForExport ? sourcePoses.map((pose) => mirrorPoseX(pose)) : sourcePoses;
  const signals = mirrorForExport
    ? sourceSignals.map((signal) => mirrorRotationSignalsX(signal))
    : sourceSignals;
  const rawRestPose = mirrorForExport ? mirrorPoseX(sourceRestPose) : sourceRestPose;
  const restPose = canonicalizeHumanoidRestPose(rawRestPose, {
    targetPose:
      opts?.targetPose ??
      (preset.id === "unity-handoff" ? "t-pose" : "a-pose"),
  });
  const restMeta = derivePoseMeta(restPose);
  const restSignals = buildRestRotationSignals(restPose, restMeta);
  const restStates = buildJointRotations(restPose, restMeta, undefined, restSignals);
  const preserveRootMotion = shouldPreserveRootMotion(
    poses,
    rawRestPose,
    opts?.preserveRootMotion ?? "auto",
  );
  const restOffsets = buildRestOffsets(restPose, preset.scaleMultiplier);
  const nodeOrder = JOINT_NAMES;
  const nodes = nodeOrder.map((joint) => ({
    sourceJoint: joint,
    name: retargetPreset.sourceToTarget[joint] ?? joint,
    parentIndex: (() => {
      const parent = RIG.find((node) => node.name === joint)?.parent ?? null;
      return parent ? nodeOrder.indexOf(parent) : null;
    })(),
    offset: restOffsets[joint],
  }));

  const bakedFrames: BakedFrame[] = poses.map((pose, index) => {
    const frameSignals = mergeRotationSignals(restSignals, signals[index]);
    const states = buildJointRotations(pose, restMeta, restStates, frameSignals);
    const rootDelta = preserveRootMotion
      ? {
          x: (pose.Hips.x - restPose.Hips.x) * preset.scaleMultiplier,
          y: (pose.Hips.y - restPose.Hips.y) * preset.scaleMultiplier,
          z: (pose.Hips.z - restPose.Hips.z) * preset.scaleMultiplier,
        }
      : v3(0, 0, 0);

    return {
      time: index / fps,
      rootTranslation: rootDelta,
      rotations: nodeOrder.map((joint) => states[joint].local),
    };
  });

  return {
    fps,
    duration: bakedFrames[bakedFrames.length - 1]?.time ?? 0,
    presetId: preset.id,
    nodeOrder,
    nodes,
    frames: bakedFrames,
    restPose,
    restOffsets,
    restLocalRotations: nodeOrder.map((joint) => restStates[joint].local),
    scaleMultiplier: preset.scaleMultiplier,
  };
}
