import { ROTATION_ORDER, SKELETON_NAME } from "./skeletonDefinition";

export type MotionRetargetPresetId =
  | "humanoid_bvh_v1"
  | "humanoid_bvh_quality_v1_5"
  | "humanoid_bvh_dual_v1"
  | "humanoid_bvh_pro_4_camera_v1"
  | "humanoid_bvh_fast_preview";

export type IkConstraint = {
  joint: string;
  type: "soft_limit" | "hinge" | "foot_lock" | "root_stabilizer";
  weight: number;
  minEulerDeg?: [number, number, number];
  maxEulerDeg?: [number, number, number];
};

export type MotionRetargetPreset = {
  id: MotionRetargetPresetId;
  label: string;
  skeletonName: typeof SKELETON_NAME;
  exportFormat: "bvh";
  rotationOrder: typeof ROTATION_ORDER;
  ikProfile: "standard" | "quality_v1_5" | "dual_camera" | "pro_multiview" | "fast_preview";
  retarget: {
    targetSkeleton: "mocap_humanoid" | "mixamo_humanoid" | "blender_humanoid";
    scaleMode: "source_locked" | "normalized_humanoid";
    rootMotion: "hips";
    footLocking: "off" | "basic" | "pro_contact_anchor";
  };
  constraints: IkConstraint[];
};

const ARM_LIMIT: Pick<IkConstraint, "minEulerDeg" | "maxEulerDeg"> = {
  minEulerDeg: [-175, -125, -145],
  maxEulerDeg: [175, 125, 145],
};

const LEG_LIMIT: Pick<IkConstraint, "minEulerDeg" | "maxEulerDeg"> = {
  minEulerDeg: [-175, -70, -95],
  maxEulerDeg: [175, 70, 95],
};

const FOOT_LIMIT: Pick<IkConstraint, "minEulerDeg" | "maxEulerDeg"> = {
  minEulerDeg: [-90, -55, -70],
  maxEulerDeg: [90, 55, 70],
};

const QUALITY_CONSTRAINTS: IkConstraint[] = [
  { joint: "Hips", type: "root_stabilizer", weight: 0.45 },
  { joint: "LeftFoot", type: "foot_lock", weight: 0.58, ...FOOT_LIMIT },
  { joint: "RightFoot", type: "foot_lock", weight: 0.58, ...FOOT_LIMIT },
];

const DUAL_CONSTRAINTS: IkConstraint[] = [
  ...QUALITY_CONSTRAINTS,
  { joint: "LeftLeg", type: "hinge", weight: 0.55, ...LEG_LIMIT },
  { joint: "RightLeg", type: "hinge", weight: 0.55, ...LEG_LIMIT },
  { joint: "LeftForeArm", type: "hinge", weight: 0.5, ...ARM_LIMIT },
  { joint: "RightForeArm", type: "hinge", weight: 0.5, ...ARM_LIMIT },
];

const PRO_CONSTRAINTS: IkConstraint[] = [
  ...DUAL_CONSTRAINTS,
  { joint: "LeftArm", type: "soft_limit", weight: 0.48, ...ARM_LIMIT },
  { joint: "RightArm", type: "soft_limit", weight: 0.48, ...ARM_LIMIT },
  { joint: "LeftUpLeg", type: "soft_limit", weight: 0.52, ...LEG_LIMIT },
  { joint: "RightUpLeg", type: "soft_limit", weight: 0.52, ...LEG_LIMIT },
];

export const MOTION_RETARGET_PRESETS: Record<MotionRetargetPresetId, MotionRetargetPreset> = {
  humanoid_bvh_v1: {
    id: "humanoid_bvh_v1",
    label: "Humanoid BVH",
    skeletonName: SKELETON_NAME,
    exportFormat: "bvh",
    rotationOrder: ROTATION_ORDER,
    ikProfile: "standard",
    retarget: {
      targetSkeleton: "mocap_humanoid",
      scaleMode: "source_locked",
      rootMotion: "hips",
      footLocking: "basic",
    },
    constraints: QUALITY_CONSTRAINTS,
  },
  humanoid_bvh_quality_v1_5: {
    id: "humanoid_bvh_quality_v1_5",
    label: "Quality V1.5",
    skeletonName: SKELETON_NAME,
    exportFormat: "bvh",
    rotationOrder: ROTATION_ORDER,
    ikProfile: "quality_v1_5",
    retarget: {
      targetSkeleton: "mocap_humanoid",
      scaleMode: "source_locked",
      rootMotion: "hips",
      footLocking: "basic",
    },
    constraints: QUALITY_CONSTRAINTS,
  },
  humanoid_bvh_dual_v1: {
    id: "humanoid_bvh_dual_v1",
    label: "Dual Camera",
    skeletonName: SKELETON_NAME,
    exportFormat: "bvh",
    rotationOrder: ROTATION_ORDER,
    ikProfile: "dual_camera",
    retarget: {
      targetSkeleton: "mixamo_humanoid",
      scaleMode: "normalized_humanoid",
      rootMotion: "hips",
      footLocking: "basic",
    },
    constraints: DUAL_CONSTRAINTS,
  },
  humanoid_bvh_pro_4_camera_v1: {
    id: "humanoid_bvh_pro_4_camera_v1",
    label: "Pro 4 Camera",
    skeletonName: SKELETON_NAME,
    exportFormat: "bvh",
    rotationOrder: ROTATION_ORDER,
    ikProfile: "pro_multiview",
    retarget: {
      targetSkeleton: "blender_humanoid",
      scaleMode: "normalized_humanoid",
      rootMotion: "hips",
      footLocking: "pro_contact_anchor",
    },
    constraints: PRO_CONSTRAINTS,
  },
  humanoid_bvh_fast_preview: {
    id: "humanoid_bvh_fast_preview",
    label: "Fast Preview",
    skeletonName: SKELETON_NAME,
    exportFormat: "bvh",
    rotationOrder: ROTATION_ORDER,
    ikProfile: "fast_preview",
    retarget: {
      targetSkeleton: "mocap_humanoid",
      scaleMode: "source_locked",
      rootMotion: "hips",
      footLocking: "off",
    },
    constraints: [],
  },
};

export function isMotionRetargetPresetId(value: string): value is MotionRetargetPresetId {
  return Object.prototype.hasOwnProperty.call(MOTION_RETARGET_PRESETS, value);
}

export function resolveMotionRetargetPreset(value: string | undefined): MotionRetargetPreset {
  if (value && isMotionRetargetPresetId(value)) return MOTION_RETARGET_PRESETS[value];
  return MOTION_RETARGET_PRESETS.humanoid_bvh_v1;
}
