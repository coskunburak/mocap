import {
  childrenOf,
  JOINT_NAMES,
  RIG,
  RIG_ROOT,
  type JointName,
} from "../../models/BodyPose33";
import type { JointPose, Vec3 } from "../../models/Skeleton";
import { add, cross, dot, len, mul, norm, sub, v3 } from "../../models/Skeleton";
import {
  quatFromBasis,
  quatIdentity,
  quatInverse,
  quatMultiply,
  type Quaternion,
} from "./Quaternion";

export type Basis = Readonly<{
  x: Vec3;
  y: Vec3;
  z: Vec3;
}>;

export type PoseMeta = Readonly<{
  torsoRight: Vec3;
  torsoUp: Vec3;
  torsoForward: Vec3;
}>;

export type JointRotationState = Readonly<{
  basis: Basis;
  world: Quaternion;
  local: Quaternion;
}>;

export type JointVectorMap = Partial<Record<JointName, Vec3>>;

export type RotationSignals = Readonly<{
  primaryAxes?: JointVectorMap;
  directHints?: JointVectorMap;
  fallbackHints?: JointVectorMap;
}>;

const EPS = 1e-6;
function normalizeOr(vector: Vec3, fallback: Vec3) {
  return len(vector) > EPS ? norm(vector) : fallback;
}

function reject(vector: Vec3, axis: Vec3) {
  return sub(vector, mul(axis, dot(vector, axis)));
}

function arbitraryPerpendicular(axis: Vec3) {
  const helper = Math.abs(axis.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const perpendicular = cross(axis, helper);
  return len(perpendicular) > EPS ? norm(perpendicular) : v3(0, 0, 1);
}

function bendHint(
  pose: JointPose,
  parent: JointName,
  joint: JointName,
  child: JointName,
  fallback: Vec3,
) {
  const incoming = sub(pose[parent], pose[joint]);
  const outgoing = sub(pose[child], pose[joint]);
  let normal = cross(incoming, outgoing);
  if (len(normal) < EPS) return fallback;
  if (dot(normal, fallback) < 0) normal = mul(normal, -1);
  return normal;
}

function primaryAxis(
  pose: JointPose,
  joint: JointName,
  signals?: RotationSignals,
): Vec3 {
  const override = signals?.primaryAxes?.[joint];
  if (override && len(override) > EPS) {
    return override;
  }

  switch (joint) {
    case "Hips":
      return sub(pose.Spine, pose.Hips);
    case "Spine":
      return sub(pose.Chest, pose.Spine);
    case "Chest":
      return sub(pose.Neck, pose.Chest);
    case "Neck":
      return sub(pose.Head, pose.Neck);
    case "Head":
      return sub(pose.Head, pose.Neck);
    case "LeftShoulder":
      return sub(pose.LeftUpperArm, pose.LeftShoulder);
    case "LeftUpperArm":
      return sub(pose.LeftLowerArm, pose.LeftUpperArm);
    case "LeftLowerArm":
      return sub(pose.LeftHand, pose.LeftLowerArm);
    case "LeftHand":
      return sub(pose.LeftHand, pose.LeftLowerArm);
    case "RightShoulder":
      return sub(pose.RightUpperArm, pose.RightShoulder);
    case "RightUpperArm":
      return sub(pose.RightLowerArm, pose.RightUpperArm);
    case "RightLowerArm":
      return sub(pose.RightHand, pose.RightLowerArm);
    case "RightHand":
      return sub(pose.RightHand, pose.RightLowerArm);
    case "LeftUpperLeg":
      return sub(pose.LeftLowerLeg, pose.LeftUpperLeg);
    case "LeftLowerLeg":
      return sub(pose.LeftFoot, pose.LeftLowerLeg);
    case "LeftFoot":
      return sub(pose.LeftToes, pose.LeftFoot);
    case "LeftToes":
      return sub(pose.LeftToes, pose.LeftFoot);
    case "RightUpperLeg":
      return sub(pose.RightLowerLeg, pose.RightUpperLeg);
    case "RightLowerLeg":
      return sub(pose.RightFoot, pose.RightLowerLeg);
    case "RightFoot":
      return sub(pose.RightToes, pose.RightFoot);
    case "RightToes":
      return sub(pose.RightToes, pose.RightFoot);
  }
}

function hintAxis(
  pose: JointPose,
  meta: PoseMeta,
  joint: JointName,
  parentBasis?: Basis,
  signals?: RotationSignals,
): Vec3 {
  const directHint = signals?.directHints?.[joint];
  if (directHint && len(directHint) > EPS) {
    return directHint;
  }

  const fallbackHint = signals?.fallbackHints?.[joint];

  switch (joint) {
    case "Hips":
    case "Spine":
    case "Chest":
    case "Neck":
      return meta.torsoForward;
    case "Head":
      return meta.torsoRight;
    case "LeftShoulder":
    case "RightShoulder":
    case "LeftUpperLeg":
    case "RightUpperLeg":
      return meta.torsoForward;
    case "LeftUpperArm":
      return bendHint(
        pose,
        "LeftShoulder",
        "LeftUpperArm",
        "LeftLowerArm",
        fallbackHint ?? parentBasis?.z ?? meta.torsoForward,
      );
    case "RightUpperArm":
      return bendHint(
        pose,
        "RightShoulder",
        "RightUpperArm",
        "RightLowerArm",
        fallbackHint ?? parentBasis?.z ?? meta.torsoForward,
      );
    case "LeftLowerArm":
      return bendHint(
        pose,
        "LeftUpperArm",
        "LeftLowerArm",
        "LeftHand",
        fallbackHint ?? parentBasis?.z ?? meta.torsoForward,
      );
    case "RightLowerArm":
      return bendHint(
        pose,
        "RightUpperArm",
        "RightLowerArm",
        "RightHand",
        fallbackHint ?? parentBasis?.z ?? meta.torsoForward,
      );
    case "LeftLowerLeg":
      return bendHint(
        pose,
        "LeftUpperLeg",
        "LeftLowerLeg",
        "LeftFoot",
        fallbackHint ?? parentBasis?.z ?? meta.torsoForward,
      );
    case "RightLowerLeg":
      return bendHint(
        pose,
        "RightUpperLeg",
        "RightLowerLeg",
        "RightFoot",
        fallbackHint ?? parentBasis?.z ?? meta.torsoForward,
      );
    case "LeftHand":
    case "RightHand":
    case "LeftFoot":
    case "RightFoot":
    case "LeftToes":
    case "RightToes":
      return fallbackHint ?? parentBasis?.z ?? meta.torsoForward;
  }
}

export function averageJointPose(poses: readonly JointPose[]) {
  const out = {} as Record<JointName, Vec3>;
  const sampleCount = Math.max(poses.length, 1);

  for (const joint of RIG) {
    let sum = v3(0, 0, 0);
    for (const pose of poses) {
      sum = add(sum, pose[joint.name]);
    }
    out[joint.name] = mul(sum, 1 / sampleCount);
  }

  return out as JointPose;
}

export function derivePoseMeta(pose: JointPose, referenceForward?: Vec3): PoseMeta {
  const shoulderLine = sub(pose.RightUpperArm, pose.LeftUpperArm);
  const hipLine = sub(pose.RightUpperLeg, pose.LeftUpperLeg);
  const torsoRight = normalizeOr(add(normalizeOr(shoulderLine, v3(1, 0, 0)), normalizeOr(hipLine, v3(1, 0, 0))), v3(1, 0, 0));
  const torsoUp = normalizeOr(sub(pose.Neck, pose.Hips), v3(0, 1, 0));
  let torsoForward = normalizeOr(cross(torsoRight, torsoUp), referenceForward ?? v3(0, 0, 1));

  if (referenceForward && dot(torsoForward, referenceForward) < 0) {
    torsoForward = mul(torsoForward, -1);
  }

  const correctedRight = normalizeOr(cross(torsoUp, torsoForward), torsoRight);
  const correctedForward = normalizeOr(cross(correctedRight, torsoUp), torsoForward);

  return {
    torsoRight: correctedRight,
    torsoUp,
    torsoForward: correctedForward,
  };
}

function torsoBasis(meta: PoseMeta, reference?: Basis) {
  let basis = createBasis(meta.torsoUp, meta.torsoForward, reference);
  if (dot(basis.x, meta.torsoRight) < 0) {
    basis = {
      x: mul(basis.x, -1),
      y: basis.y,
      z: mul(basis.z, -1),
    };
  }
  return basis;
}

export function createBasis(primary: Vec3, hint: Vec3, reference?: Basis): Basis {
  const y = normalizeOr(primary, reference?.y ?? v3(0, 1, 0));
  let z = reject(hint, y);

  if (len(z) < EPS) {
    z = reject(reference?.z ?? arbitraryPerpendicular(y), y);
  }
  if (len(z) < EPS) {
    z = arbitraryPerpendicular(y);
  }

  z = norm(z);
  let x = cross(y, z);
  if (len(x) < EPS) {
    x = arbitraryPerpendicular(y);
  }
  x = norm(x);
  z = normalizeOr(cross(x, y), z);

  if (reference && dot(z, reference.z) < 0) {
    x = mul(x, -1);
    z = mul(z, -1);
  }

  return { x, y, z };
}

export function buildJointRotations(
  pose: JointPose,
  referenceMeta: PoseMeta,
  referenceStates?: Partial<Record<JointName, JointRotationState>>,
  signals?: RotationSignals,
) {
  const meta = derivePoseMeta(pose, referenceMeta.torsoForward);
  const states = {} as Record<JointName, JointRotationState>;

  const rootBasis = torsoBasis(meta, referenceStates?.Hips?.basis);
  const rootWorld = quatFromBasis(rootBasis.x, rootBasis.y, rootBasis.z);
  states.Hips = {
    basis: rootBasis,
    world: rootWorld,
    local: rootWorld,
  };

  const visit = (joint: JointName) => {
    for (const child of childrenOf(joint)) {
      const parentState = states[joint];
      const basis = createBasis(
        primaryAxis(pose, child, signals),
        hintAxis(pose, meta, child, parentState.basis, signals),
        referenceStates?.[child]?.basis,
      );
      const world = quatFromBasis(basis.x, basis.y, basis.z);
      const local = quatMultiply(quatInverse(parentState.world), world);

      states[child] = {
        basis,
        world,
        local,
      };

      visit(child);
    }
  };

  visit(RIG_ROOT);
  return states;
}

export function buildLocalDeltaRotations(
  current: Record<JointName, JointRotationState>,
  rest: Partial<Record<JointName, JointRotationState>>,
) {
  const out = {} as Record<JointName, Quaternion>;
  for (const joint of JOINT_NAMES) {
    const currentLocal = current[joint]?.local ?? quatIdentity();
    const restLocal = rest[joint]?.local ?? quatIdentity();
    out[joint] = quatMultiply(currentLocal, quatInverse(restLocal));
  }
  return out;
}
