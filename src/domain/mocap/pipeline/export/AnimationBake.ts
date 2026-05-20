import {
  JOINT_NAMES,
  RIG,
  type JointName,
} from "../../models/BodyPose33";
import type { PoseFrame } from "../../models/PoseFrame";
import type { CalibrationPose } from "../../models/Take";
import type { JointPose, Vec3 } from "../../models/Skeleton";
import type { Quaternion } from "../retarget/Quaternion";
import { getRetargetPreset } from "../retarget/BoneMap";
import {
  buildAvatarMotionClip,
  type AvatarMotionSourceSpace,
} from "../avatar/AvatarMotion";
import { getExportPreset, type ExportPresetId } from "./ExportPresets";

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
  faceBlendshapes?: readonly number[];
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
  solverVersion: string;
  sourceSpace: AvatarMotionSourceSpace;
  calibrationFrameCount: number;
  targetPose: CalibrationPose;
}>;

type BakeOptions = {
  fps?: number;
  calibrationFrames?: number;
  presetId?: ExportPresetId;
  preserveRootMotion?: boolean | "auto";
  targetPose?: CalibrationPose;
};

export function bakeAnimation(frames: readonly PoseFrame[], opts?: BakeOptions): BakedAnimation {
  if (frames.length === 0) {
    throw new Error("No frames to bake.");
  }

  const fps = opts?.fps ?? 30;
  const preset = getExportPreset(opts?.presetId ?? "dcc-archive");
  const retargetPreset = getRetargetPreset(preset.retargetPresetId);
  const motion = buildAvatarMotionClip(frames, {
    fps,
    calibrationFrames: opts?.calibrationFrames,
    preserveRootMotion: opts?.preserveRootMotion ?? "auto",
    targetPose:
      opts?.targetPose ??
      (preset.id === "unity-handoff" ? "t-pose" : "a-pose"),
    scaleMultiplier: preset.scaleMultiplier,
  });
  const nodeOrder = JOINT_NAMES;
  const restPose = motion.calibration.restPose;
  const restOffsets = motion.calibration.restOffsets;
  const restStates = motion.calibration.restStates;
  const nodes: BakedNode[] = nodeOrder.map((joint) => ({
    sourceJoint: joint,
    name: retargetPreset.sourceToTarget[joint] ?? joint,
    parentIndex: (() => {
      const parent = RIG.find((node) => node.name === joint)?.parent ?? null;
      return parent ? nodeOrder.indexOf(parent) : null;
    })(),
    offset: restOffsets[joint],
  }));

  const bakedFrames: BakedFrame[] = motion.frames.map((frame) => ({
    time: frame.time,
    rootTranslation: frame.rootTranslation,
    rotations: nodeOrder.map((joint) => frame.localRotations[joint]),
    faceBlendshapes: frame.faceBlendshapes
      ? frame.faceBlendshapes.map((blendshape) => blendshape.score)
      : undefined,
  }));

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
    solverVersion: motion.calibration.solverVersion,
    sourceSpace: motion.calibration.sourceSpace,
    calibrationFrameCount: motion.calibration.calibrationFrameCount,
    targetPose: motion.calibration.targetPose,
  };
}
