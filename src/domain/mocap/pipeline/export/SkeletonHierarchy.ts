export enum PoseJoints {
  NOSE = 0,
  LEFT_EYE_INNER = 1,
  LEFT_EYE = 2,
  LEFT_EYE_OUTER = 3,
  RIGHT_EYE_INNER = 4,
  RIGHT_EYE = 5,
  RIGHT_EYE_OUTER = 6,
  LEFT_EAR = 7,
  RIGHT_EAR = 8,
  MOUTH_LEFT = 9,
  MOUTH_RIGHT = 10,
  LEFT_SHOULDER = 11,
  RIGHT_SHOULDER = 12,
  LEFT_ELBOW = 13,
  RIGHT_ELBOW = 14,
  LEFT_WRIST = 15,
  RIGHT_WRIST = 16,
  LEFT_PINKY = 17,
  RIGHT_PINKY = 18,
  LEFT_INDEX = 19,
  RIGHT_INDEX = 20,
  LEFT_THUMB = 21,
  RIGHT_THUMB = 22,
  LEFT_HIP = 23,
  RIGHT_HIP = 24,
  LEFT_KNEE = 25,
  RIGHT_KNEE = 26,
  LEFT_ANKLE = 27,
  RIGHT_ANKLE = 28,
  LEFT_HEEL = 29,
  RIGHT_HEEL = 30,
  LEFT_FOOT_INDEX = 31,
  RIGHT_FOOT_INDEX = 32,
}

export type Bone = {
  name: string;
  parent: string | null;
  startJoint: number | null; // e.g. LEFT_HIP
  endJoint: number; // e.g. LEFT_KNEE
  children: Bone[];
};

export const SKELETON_HIERARCHY: Bone = {
  name: "Hips", // Center of left & right hip
  parent: null,
  startJoint: null,
  endJoint: -1, // Calculated as (LEFT_HIP + RIGHT_HIP) / 2
  children: [
    {
      name: "Spine",
      parent: "Hips",
      startJoint: -1, // Hips
      endJoint: -2, // Mid-shoulders: (LEFT_SHOULDER + RIGHT_SHOULDER) / 2
      children: [
        {
          name: "Neck",
          parent: "Spine",
          startJoint: -2,
          endJoint: PoseJoints.NOSE, // Approximation for head
          children: [],
        },
        {
          name: "LeftShoulder",
          parent: "Spine",
          startJoint: -2,
          endJoint: PoseJoints.LEFT_SHOULDER,
          children: [
            {
              name: "LeftArm",
              parent: "LeftShoulder",
              startJoint: PoseJoints.LEFT_SHOULDER,
              endJoint: PoseJoints.LEFT_ELBOW,
              children: [
                {
                  name: "LeftForeArm",
                  parent: "LeftArm",
                  startJoint: PoseJoints.LEFT_ELBOW,
                  endJoint: PoseJoints.LEFT_WRIST,
                  children: [
                    {
                      name: "LeftHand",
                      parent: "LeftForeArm",
                      startJoint: PoseJoints.LEFT_WRIST,
                      endJoint: PoseJoints.LEFT_INDEX,
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          name: "RightShoulder",
          parent: "Spine",
          startJoint: -2,
          endJoint: PoseJoints.RIGHT_SHOULDER,
          children: [
            {
              name: "RightArm",
              parent: "RightShoulder",
              startJoint: PoseJoints.RIGHT_SHOULDER,
              endJoint: PoseJoints.RIGHT_ELBOW,
              children: [
                {
                  name: "RightForeArm",
                  parent: "RightArm",
                  startJoint: PoseJoints.RIGHT_ELBOW,
                  endJoint: PoseJoints.RIGHT_WRIST,
                  children: [
                    {
                      name: "RightHand",
                      parent: "RightForeArm",
                      startJoint: PoseJoints.RIGHT_WRIST,
                      endJoint: PoseJoints.RIGHT_INDEX,
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "LeftUpLeg",
      parent: "Hips",
      startJoint: -1,
      endJoint: PoseJoints.LEFT_HIP,
      children: [
        {
          name: "LeftLeg",
          parent: "LeftUpLeg",
          startJoint: PoseJoints.LEFT_HIP,
          endJoint: PoseJoints.LEFT_KNEE,
          children: [
            {
              name: "LeftFoot",
              parent: "LeftLeg",
              startJoint: PoseJoints.LEFT_KNEE,
              endJoint: PoseJoints.LEFT_ANKLE,
              children: [
                {
                  name: "LeftToeBase",
                  parent: "LeftFoot",
                  startJoint: PoseJoints.LEFT_ANKLE,
                  endJoint: PoseJoints.LEFT_FOOT_INDEX,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "RightUpLeg",
      parent: "Hips",
      startJoint: -1,
      endJoint: PoseJoints.RIGHT_HIP,
      children: [
        {
          name: "RightLeg",
          parent: "RightUpLeg",
          startJoint: PoseJoints.RIGHT_HIP,
          endJoint: PoseJoints.RIGHT_KNEE,
          children: [
            {
              name: "RightFoot",
              parent: "RightLeg",
              startJoint: PoseJoints.RIGHT_KNEE,
              endJoint: PoseJoints.RIGHT_ANKLE,
              children: [
                {
                  name: "RightToeBase",
                  parent: "RightFoot",
                  startJoint: PoseJoints.RIGHT_ANKLE,
                  endJoint: PoseJoints.RIGHT_FOOT_INDEX,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
