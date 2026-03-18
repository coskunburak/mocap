import type { CalibrationPose } from "../../models/Take";
import type { JointPose, Vec3 } from "../../models/Skeleton";
import { add, dot, len, mul, norm, sub, v3 } from "../../models/Skeleton";

type LocalVec3 = Readonly<{ x: number; y: number; z: number }>;

type CanonicalHumanoidPoseOptions = Readonly<{
  targetPose?: CalibrationPose;
  preserveHeadTilt?: boolean;
}>;

const EPS = 1e-6;

function localToWorld(
  right: Vec3,
  up: Vec3,
  forward: Vec3,
  local: LocalVec3,
) {
  return add(
    add(mul(right, local.x), mul(up, local.y)),
    mul(forward, local.z),
  );
}

function worldToLocal(
  vector: Vec3,
  right: Vec3,
  up: Vec3,
  forward: Vec3,
): LocalVec3 {
  return {
    x: dot(vector, right),
    y: dot(vector, up),
    z: dot(vector, forward),
  };
}

function average(values: readonly number[], fallback = 0) {
  if (values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageLength(vectors: readonly Vec3[], fallback: number) {
  const lengths = vectors.map((vector) => len(vector)).filter((value) => value > EPS);
  return average(lengths, fallback);
}

function normalizeOr(vector: Vec3, fallback: Vec3) {
  return len(vector) > EPS ? norm(vector) : fallback;
}

function vectorWithLength(
  right: Vec3,
  up: Vec3,
  forward: Vec3,
  preferredLocal: LocalVec3,
  lengthValue: number,
  fallbackLocal: LocalVec3,
): Vec3 {
  const preferred = localToWorld(right, up, forward, preferredLocal);
  const fallback = localToWorld(right, up, forward, fallbackLocal);
  const direction = normalizeOr(preferred, normalizeOr(fallback, up));
  return mul(direction, Math.max(lengthValue, EPS));
}

function mirroredAbsAverage(left: LocalVec3, right: LocalVec3): LocalVec3 {
  return {
    x: average([Math.abs(left.x), Math.abs(right.x)], 0),
    y: average([left.y, right.y], 0),
    z: average([left.z, right.z], 0),
  };
}

function resolveArmVector(mode: CalibrationPose | undefined, sign: 1 | -1): LocalVec3 {
  if (mode === "a-pose") {
    return { x: 0.9 * sign, y: -0.34, z: 0.14 };
  }
  return { x: 0.995 * sign, y: -0.01, z: 0.08 };
}

export function canonicalizeHumanoidRestPose(
  rawPose: JointPose,
  opts?: CanonicalHumanoidPoseOptions,
): JointPose {
  const right = v3(1, 0, 0);
  const up = v3(0, 1, 0);
  const forward = v3(0, 0, 1);

  const hips = rawPose.Hips;

  const spineLength = averageLength([sub(rawPose.Spine, rawPose.Hips)], 8);
  const chestLength = averageLength([sub(rawPose.Chest, rawPose.Spine)], 8);
  const neckLength = averageLength([sub(rawPose.Neck, rawPose.Chest)], 5);
  const headLength = averageLength([sub(rawPose.Head, rawPose.Neck)], 10);

  const shoulderLength = averageLength(
    [sub(rawPose.LeftShoulder, rawPose.Chest), sub(rawPose.RightShoulder, rawPose.Chest)],
    6,
  );
  const upperArmLength = averageLength(
    [
      sub(rawPose.LeftUpperArm, rawPose.LeftShoulder),
      sub(rawPose.RightUpperArm, rawPose.RightShoulder),
    ],
    15,
  );
  const lowerArmLength = averageLength(
    [
      sub(rawPose.LeftLowerArm, rawPose.LeftUpperArm),
      sub(rawPose.RightLowerArm, rawPose.RightUpperArm),
    ],
    15,
  );
  const handLength = averageLength(
    [sub(rawPose.LeftHand, rawPose.LeftLowerArm), sub(rawPose.RightHand, rawPose.RightLowerArm)],
    10,
  );

  const thighLength = averageLength(
    [sub(rawPose.LeftUpperLeg, rawPose.Hips), sub(rawPose.RightUpperLeg, rawPose.Hips)],
    12,
  );
  const shinLength = averageLength(
    [
      sub(rawPose.LeftLowerLeg, rawPose.LeftUpperLeg),
      sub(rawPose.RightLowerLeg, rawPose.RightUpperLeg),
    ],
    18,
  );
  const footLength = averageLength(
    [sub(rawPose.LeftFoot, rawPose.LeftLowerLeg), sub(rawPose.RightFoot, rawPose.RightLowerLeg)],
    12,
  );
  const toeLength = averageLength(
    [sub(rawPose.LeftToes, rawPose.LeftFoot), sub(rawPose.RightToes, rawPose.RightFoot)],
    6,
  );

  const rawLeftShoulder = worldToLocal(sub(rawPose.LeftShoulder, rawPose.Chest), right, up, forward);
  const rawRightShoulder = worldToLocal(sub(rawPose.RightShoulder, rawPose.Chest), right, up, forward);
  const rawShoulder = mirroredAbsAverage(rawLeftShoulder, {
    x: -rawRightShoulder.x,
    y: rawRightShoulder.y,
    z: rawRightShoulder.z,
  });

  const rawLeftHip = worldToLocal(sub(rawPose.LeftUpperLeg, rawPose.Hips), right, up, forward);
  const rawRightHip = worldToLocal(sub(rawPose.RightUpperLeg, rawPose.Hips), right, up, forward);
  const rawHip = mirroredAbsAverage(rawLeftHip, {
    x: -rawRightHip.x,
    y: rawRightHip.y,
    z: rawRightHip.z,
  });

  const shoulderLocal = {
    x: Math.max(rawShoulder.x, shoulderLength * 0.92, upperArmLength * 0.18),
    y: Math.max(rawShoulder.y, shoulderLength * 0.12),
    z: average([rawLeftShoulder.z, rawRightShoulder.z], 0) * 0.45,
  };

  const hipLocal = {
    x: Math.max(rawHip.x, thighLength * 0.68),
    y: -Math.max(Math.abs(rawHip.y), thighLength * 0.12),
    z: 0,
  };

  const spine = add(hips, mul(up, spineLength));
  const chest = add(spine, mul(up, chestLength));
  const neck = add(chest, mul(up, neckLength));

  const rawHead = worldToLocal(sub(rawPose.Head, rawPose.Neck), right, up, forward);
  const headLocal = {
    x: opts?.preserveHeadTilt ? rawHead.x * 0.25 : 0,
    y: Math.max(rawHead.y, headLength * 0.85),
    z: Math.max(rawHead.z, headLength * 0.08),
  };
  const head = add(neck, vectorWithLength(right, up, forward, headLocal, headLength, { x: 0, y: 1, z: 0.08 }));

  const leftShoulder = add(
    chest,
    vectorWithLength(right, up, forward, { x: -shoulderLocal.x, y: shoulderLocal.y, z: shoulderLocal.z }, shoulderLength, { x: -1, y: 0.08, z: 0 }),
  );
  const rightShoulder = add(
    chest,
    vectorWithLength(
      right,
      up,
      forward,
      { x: shoulderLocal.x, y: shoulderLocal.y, z: shoulderLocal.z },
      shoulderLength,
      { x: 1, y: 0.08, z: 0 },
    ),
  );

  const leftUpperArm = add(
    leftShoulder,
    vectorWithLength(right, up, forward, resolveArmVector(opts?.targetPose, -1), upperArmLength, {
      x: -1,
      y: 0,
      z: 0,
    }),
  );
  const rightUpperArm = add(
    rightShoulder,
    vectorWithLength(right, up, forward, resolveArmVector(opts?.targetPose, 1), upperArmLength, {
      x: 1,
      y: 0,
      z: 0,
    }),
  );

  const lowerArmLocal = opts?.targetPose === "a-pose"
    ? { x: 0.97, y: -0.12, z: 0.16 }
    : { x: 1, y: 0, z: 0.14 };
  const handLocal = opts?.targetPose === "a-pose"
    ? { x: 1, y: -0.08, z: 0.18 }
    : { x: 1, y: 0.02, z: 0.16 };

  const leftLowerArm = add(
    leftUpperArm,
    vectorWithLength(right, up, forward, { x: -lowerArmLocal.x, y: lowerArmLocal.y, z: lowerArmLocal.z }, lowerArmLength, { x: -1, y: 0, z: 0.04 }),
  );
  const rightLowerArm = add(
    rightUpperArm,
    vectorWithLength(right, up, forward, lowerArmLocal, lowerArmLength, { x: 1, y: 0, z: 0.04 }),
  );
  const leftHand = add(
    leftLowerArm,
    vectorWithLength(right, up, forward, { x: -handLocal.x, y: handLocal.y, z: handLocal.z }, handLength, { x: -1, y: 0, z: 0.08 }),
  );
  const rightHand = add(
    rightLowerArm,
    vectorWithLength(right, up, forward, handLocal, handLength, { x: 1, y: 0, z: 0.08 }),
  );

  const leftUpperLeg = add(
    hips,
    vectorWithLength(right, up, forward, { x: -hipLocal.x, y: hipLocal.y, z: hipLocal.z }, thighLength, { x: -0.8, y: -0.2, z: 0 }),
  );
  const rightUpperLeg = add(
    hips,
    vectorWithLength(
      right,
      up,
      forward,
      hipLocal,
      thighLength,
      { x: 0.8, y: -0.2, z: 0 },
    ),
  );

  const lowerLegLocal = { x: 0, y: -1, z: 0.03 };
  const footLocal = { x: 0, y: -0.24, z: 0.97 };
  const toeLocal = { x: 0, y: 0.02, z: 1 };

  const leftLowerLeg = add(
    leftUpperLeg,
    vectorWithLength(right, up, forward, lowerLegLocal, shinLength, { x: 0, y: -1, z: 0 }),
  );
  const rightLowerLeg = add(
    rightUpperLeg,
    vectorWithLength(right, up, forward, lowerLegLocal, shinLength, { x: 0, y: -1, z: 0 }),
  );
  const leftFoot = add(
    leftLowerLeg,
    vectorWithLength(right, up, forward, footLocal, footLength, { x: 0, y: -0.18, z: 1 }),
  );
  const rightFoot = add(
    rightLowerLeg,
    vectorWithLength(right, up, forward, footLocal, footLength, { x: 0, y: -0.18, z: 1 }),
  );
  const leftToes = add(
    leftFoot,
    vectorWithLength(right, up, forward, toeLocal, toeLength, { x: 0, y: 0, z: 1 }),
  );
  const rightToes = add(
    rightFoot,
    vectorWithLength(right, up, forward, toeLocal, toeLength, { x: 0, y: 0, z: 1 }),
  );

  return {
    Hips: hips,
    Spine: spine,
    Chest: chest,
    Neck: neck,
    Head: head,
    LeftShoulder: leftShoulder,
    LeftUpperArm: leftUpperArm,
    LeftLowerArm: leftLowerArm,
    LeftHand: leftHand,
    RightShoulder: rightShoulder,
    RightUpperArm: rightUpperArm,
    RightLowerArm: rightLowerArm,
    RightHand: rightHand,
    LeftUpperLeg: leftUpperLeg,
    LeftLowerLeg: leftLowerLeg,
    LeftFoot: leftFoot,
    LeftToes: leftToes,
    RightUpperLeg: rightUpperLeg,
    RightLowerLeg: rightLowerLeg,
    RightFoot: rightFoot,
    RightToes: rightToes,
  };
}
