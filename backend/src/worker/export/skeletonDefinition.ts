export type SkeletonJoint = {
  name: string;
  parent: string | null;
  offset: [number, number, number];
  primaryChild?: string;
};

export const SKELETON_NAME = "mocap_humanoid_v1" as const;
export const ROTATION_ORDER = "XYZ" as const;

export const SKELETON: SkeletonJoint[] = [
  { name: "Hips", parent: null, offset: [0, 0, 0], primaryChild: "Spine" },
  { name: "Spine", parent: "Hips", offset: [0, 10, 0], primaryChild: "Chest" },
  { name: "Chest", parent: "Spine", offset: [0, 14, 0], primaryChild: "Neck" },
  { name: "Neck", parent: "Chest", offset: [0, 8, 0], primaryChild: "Head" },
  { name: "Head", parent: "Neck", offset: [0, 9, 0] },
  { name: "LeftShoulder", parent: "Chest", offset: [-8, 7, 0], primaryChild: "LeftArm" },
  { name: "LeftArm", parent: "LeftShoulder", offset: [-14, 0, 0], primaryChild: "LeftForeArm" },
  { name: "LeftForeArm", parent: "LeftArm", offset: [-13, 0, 0], primaryChild: "LeftHand" },
  { name: "LeftHand", parent: "LeftForeArm", offset: [-7, 0, 0] },
  { name: "RightShoulder", parent: "Chest", offset: [8, 7, 0], primaryChild: "RightArm" },
  { name: "RightArm", parent: "RightShoulder", offset: [14, 0, 0], primaryChild: "RightForeArm" },
  { name: "RightForeArm", parent: "RightArm", offset: [13, 0, 0], primaryChild: "RightHand" },
  { name: "RightHand", parent: "RightForeArm", offset: [7, 0, 0] },
  { name: "LeftUpLeg", parent: "Hips", offset: [-6, -8, 0], primaryChild: "LeftLeg" },
  { name: "LeftLeg", parent: "LeftUpLeg", offset: [0, -20, 0], primaryChild: "LeftFoot" },
  { name: "LeftFoot", parent: "LeftLeg", offset: [0, -18, 3] },
  { name: "RightUpLeg", parent: "Hips", offset: [6, -8, 0], primaryChild: "RightLeg" },
  { name: "RightLeg", parent: "RightUpLeg", offset: [0, -20, 0], primaryChild: "RightFoot" },
  { name: "RightFoot", parent: "RightLeg", offset: [0, -18, 3] },
];

export function childrenOf(name: string) {
  return SKELETON.filter((joint) => joint.parent === name);
}
