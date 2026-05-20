import { RIG, mp33ToJointPose } from "../../models/BodyPose33";
import type { PoseFrame } from "../../models/PoseFrame";
import type { TakeRetarget } from "../../models/Take";
import { countMappedBones, getRetargetPreset, getUnmappedSourceBones, type RetargetPresetId } from "./BoneMap";
import { averageJointPose, buildJointRotations, derivePoseMeta } from "./RotationMath";

type Options = {
  presetId?: RetargetPresetId;
  calibrationFrames?: number;
};

function calibrationCount(frames: readonly PoseFrame[]) {
  return Math.max(1, Math.min(frames.length, 12));
}

function prefersWorld(frames: readonly PoseFrame[]) {
  return frames.every((frame) => frame.worldLandmarks);
}

export function analyzeRetarget(frames: readonly PoseFrame[], opts?: Options): TakeRetarget {
  const preset = getRetargetPreset(opts?.presetId ?? "unity-humanoid");
  const sourceBones = RIG.map((node) => node.name);

  if (frames.length === 0) {
    return {
      ready: false,
      preset: preset.id,
      targetSkeleton: preset.targetSkeleton,
      mappedBones: countMappedBones(preset),
      totalSourceBones: sourceBones.length,
      unmappedSourceBones: getUnmappedSourceBones(preset),
      generatedAt: Date.now(),
    };
  }

  const useWorld = prefersWorld(frames);
  const poses = frames.map((frame) =>
    mp33ToJointPose(useWorld && frame.worldLandmarks ? frame.worldLandmarks : frame.landmarks, {
      scale: 100,
      space: useWorld ? "world" : "normalized",
    }),
  );
  const restPose = averageJointPose(
    poses.slice(0, opts?.calibrationFrames ?? calibrationCount(frames)),
  );
  const restMeta = derivePoseMeta(restPose);
  const states = buildJointRotations(restPose, restMeta);

  const mappedBones = countMappedBones(preset);
  const requiredMapped = preset.required.every((joint) => preset.sourceToTarget[joint]);
  const solvedBones = sourceBones.filter((joint) => Boolean(states[joint])).length;

  return {
    ready:
      requiredMapped &&
      mappedBones >= Math.floor(sourceBones.length * 0.8) &&
      solvedBones >= sourceBones.length,
    preset: preset.id,
    targetSkeleton: preset.targetSkeleton,
    mappedBones,
    totalSourceBones: sourceBones.length,
    unmappedSourceBones: getUnmappedSourceBones(preset),
    generatedAt: Date.now(),
  };
}
