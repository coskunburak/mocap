import { RIG, type JointName } from "../../models/MediapipePose33";

export type RetargetPresetId =
  | "generic-humanoid"
  | "unity-humanoid"
  | "unreal-mannequin"
  | "mixamo";

export type RetargetPreset = Readonly<{
  id: RetargetPresetId;
  label: string;
  targetSkeleton: string;
  sourceToTarget: Readonly<Record<JointName, string>>;
  required: readonly JointName[];
}>;

const GENERIC_HUMANOID: RetargetPreset = {
  id: "generic-humanoid",
  label: "Generic Humanoid",
  targetSkeleton: "MocapExpo Humanoid",
  sourceToTarget: {
    Hips: "Hips",
    Spine: "Spine",
    Chest: "Chest",
    Neck: "Neck",
    Head: "Head",
    LeftShoulder: "LeftShoulder",
    LeftUpperArm: "LeftUpperArm",
    LeftLowerArm: "LeftLowerArm",
    LeftHand: "LeftHand",
    RightShoulder: "RightShoulder",
    RightUpperArm: "RightUpperArm",
    RightLowerArm: "RightLowerArm",
    RightHand: "RightHand",
    LeftUpperLeg: "LeftUpperLeg",
    LeftLowerLeg: "LeftLowerLeg",
    LeftFoot: "LeftFoot",
    LeftToes: "LeftToes",
    RightUpperLeg: "RightUpperLeg",
    RightLowerLeg: "RightLowerLeg",
    RightFoot: "RightFoot",
    RightToes: "RightToes",
  },
  required: [
    "Hips",
    "Spine",
    "Chest",
    "Neck",
    "Head",
    "LeftUpperArm",
    "LeftLowerArm",
    "LeftHand",
    "RightUpperArm",
    "RightLowerArm",
    "RightHand",
    "LeftUpperLeg",
    "LeftLowerLeg",
    "LeftFoot",
    "RightUpperLeg",
    "RightLowerLeg",
    "RightFoot",
  ],
};

const UNITY_HUMANOID: RetargetPreset = {
  id: "unity-humanoid",
  label: "Unity Humanoid",
  targetSkeleton: "Unity Avatar / Humanoid",
  sourceToTarget: {
    Hips: "Hips",
    Spine: "Spine",
    Chest: "Chest",
    Neck: "Neck",
    Head: "Head",
    LeftShoulder: "LeftShoulder",
    LeftUpperArm: "LeftUpperArm",
    LeftLowerArm: "LeftLowerArm",
    LeftHand: "LeftHand",
    RightShoulder: "RightShoulder",
    RightUpperArm: "RightUpperArm",
    RightLowerArm: "RightLowerArm",
    RightHand: "RightHand",
    LeftUpperLeg: "LeftUpperLeg",
    LeftLowerLeg: "LeftLowerLeg",
    LeftFoot: "LeftFoot",
    LeftToes: "LeftToes",
    RightUpperLeg: "RightUpperLeg",
    RightLowerLeg: "RightLowerLeg",
    RightFoot: "RightFoot",
    RightToes: "RightToes",
  },
  required: GENERIC_HUMANOID.required,
};

const UNREAL_MANNEQUIN: RetargetPreset = {
  id: "unreal-mannequin",
  label: "Unreal Mannequin",
  targetSkeleton: "UE5 Manny / Quinn",
  sourceToTarget: {
    Hips: "pelvis",
    Spine: "spine_01",
    Chest: "spine_02",
    Neck: "neck_01",
    Head: "head",
    LeftShoulder: "clavicle_l",
    LeftUpperArm: "upperarm_l",
    LeftLowerArm: "lowerarm_l",
    LeftHand: "hand_l",
    RightShoulder: "clavicle_r",
    RightUpperArm: "upperarm_r",
    RightLowerArm: "lowerarm_r",
    RightHand: "hand_r",
    LeftUpperLeg: "thigh_l",
    LeftLowerLeg: "calf_l",
    LeftFoot: "foot_l",
    LeftToes: "ball_l",
    RightUpperLeg: "thigh_r",
    RightLowerLeg: "calf_r",
    RightFoot: "foot_r",
    RightToes: "ball_r",
  },
  required: GENERIC_HUMANOID.required,
};

const MIXAMO: RetargetPreset = {
  id: "mixamo",
  label: "Mixamo Humanoid",
  targetSkeleton: "Mixamo Standard",
  sourceToTarget: {
    Hips: "mixamorig:Hips",
    Spine: "mixamorig:Spine",
    Chest: "mixamorig:Spine1",
    Neck: "mixamorig:Neck",
    Head: "mixamorig:Head",
    LeftShoulder: "mixamorig:LeftShoulder",
    LeftUpperArm: "mixamorig:LeftArm",
    LeftLowerArm: "mixamorig:LeftForeArm",
    LeftHand: "mixamorig:LeftHand",
    RightShoulder: "mixamorig:RightShoulder",
    RightUpperArm: "mixamorig:RightArm",
    RightLowerArm: "mixamorig:RightForeArm",
    RightHand: "mixamorig:RightHand",
    LeftUpperLeg: "mixamorig:LeftUpLeg",
    LeftLowerLeg: "mixamorig:LeftLeg",
    LeftFoot: "mixamorig:LeftFoot",
    LeftToes: "mixamorig:LeftToeBase",
    RightUpperLeg: "mixamorig:RightUpLeg",
    RightLowerLeg: "mixamorig:RightLeg",
    RightFoot: "mixamorig:RightFoot",
    RightToes: "mixamorig:RightToeBase",
  },
  required: GENERIC_HUMANOID.required,
};

const PRESETS: Readonly<Record<RetargetPresetId, RetargetPreset>> = {
  "generic-humanoid": GENERIC_HUMANOID,
  "unity-humanoid": UNITY_HUMANOID,
  "unreal-mannequin": UNREAL_MANNEQUIN,
  mixamo: MIXAMO,
};

export function getRetargetPreset(id: RetargetPresetId = "unity-humanoid") {
  return PRESETS[id];
}

export function listRetargetPresets() {
  return Object.values(PRESETS);
}

export function countMappedBones(preset: RetargetPreset) {
  return Object.keys(preset.sourceToTarget).length;
}

export function getUnmappedSourceBones(preset: RetargetPreset) {
  return RIG.map((node) => node.name).filter((joint) => !preset.sourceToTarget[joint]);
}
