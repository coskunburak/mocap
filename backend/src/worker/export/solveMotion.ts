import type {
  PoseFrameArtifactFrame,
  PoseFramesArtifact,
  PoseLandmark,
  SolvedMotionArtifact,
  SolvedMotionFrame,
} from "../types";
import { ROTATION_ORDER, SKELETON, SKELETON_NAME } from "./skeletonDefinition";

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const MP = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function v(x = 0, y = 0, z = 0): Vec3 {
  return [finite(x), finite(y), finite(z)];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return mul(add(a, b), 0.5);
}

function len(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const length = len(a);
  if (length < 1e-6) return [0, 1, 0];
  return [a[0] / length, a[1] / length, a[2] / length];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const f = normalize(from);
  const t = normalize(to);
  const d = Math.max(-1, Math.min(1, dot(f, t)));
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    const axis = normalize(Math.abs(f[0]) < 0.9 ? cross(f, [1, 0, 0]) : cross(f, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(f, t);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const qLen = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / qLen, q[1] / qLen, q[2] / qLen, q[3] / qLen];
}

function quatToEulerXYZ(q: Quat): [number, number, number] {
  const [x, y, z, w] = q;
  const test = 2 * (w * y - z * x);
  const clamped = Math.max(-1, Math.min(1, test));
  const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const ry = Math.asin(clamped);
  const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [rx, ry, rz].map((radians) => finite((radians * 180) / Math.PI)) as [
    number,
    number,
    number,
  ];
}

function convertLandmark(landmark: PoseLandmark | undefined, scale = 100): Vec3 | null {
  if (!landmark) return null;
  if (![landmark.x, landmark.y, landmark.z].every(Number.isFinite)) return null;
  return v(landmark.x * scale, -landmark.y * scale, -landmark.z * scale);
}

function getPoint(frame: PoseFrameArtifactFrame, index: number): Vec3 | null {
  const source = frame.worldLandmarks?.length ? frame.worldLandmarks : frame.landmarks;
  const scale = frame.worldLandmarks?.length ? 100 : 180;
  return convertLandmark(source[index], scale);
}

function requiredPoint(frame: PoseFrameArtifactFrame, index: number, fallback: Vec3): Vec3 {
  return getPoint(frame, index) ?? fallback;
}

function skeletonPoints(frame: PoseFrameArtifactFrame): Record<string, Vec3> | null {
  if (frame.landmarks.length < 29 && !frame.worldLandmarks?.length) return null;

  const leftHip = requiredPoint(frame, MP.leftHip, [-6, 90, 0]);
  const rightHip = requiredPoint(frame, MP.rightHip, [6, 90, 0]);
  const hips = mid(leftHip, rightHip);
  const leftShoulder = requiredPoint(frame, MP.leftShoulder, [-16, 135, 0]);
  const rightShoulder = requiredPoint(frame, MP.rightShoulder, [16, 135, 0]);
  const shoulders = mid(leftShoulder, rightShoulder);
  const head = (() => {
    const nose = getPoint(frame, MP.nose);
    const leftEar = getPoint(frame, MP.leftEar);
    const rightEar = getPoint(frame, MP.rightEar);
    if (leftEar && rightEar) return mid(leftEar, rightEar);
    if (nose) return nose;
    return add(shoulders, [0, 22, 0]);
  })();

  return {
    Hips: hips,
    Spine: add(hips, mul(sub(shoulders, hips), 0.42)),
    Chest: shoulders,
    Neck: add(shoulders, mul(sub(head, shoulders), 0.35)),
    Head: head,
    LeftShoulder: leftShoulder,
    LeftArm: requiredPoint(frame, MP.leftElbow, add(leftShoulder, [-18, 0, 0])),
    LeftForeArm: requiredPoint(frame, MP.leftWrist, add(leftShoulder, [-32, 0, 0])),
    LeftHand: requiredPoint(frame, MP.leftWrist, add(leftShoulder, [-40, 0, 0])),
    RightShoulder: rightShoulder,
    RightArm: requiredPoint(frame, MP.rightElbow, add(rightShoulder, [18, 0, 0])),
    RightForeArm: requiredPoint(frame, MP.rightWrist, add(rightShoulder, [32, 0, 0])),
    RightHand: requiredPoint(frame, MP.rightWrist, add(rightShoulder, [40, 0, 0])),
    LeftUpLeg: leftHip,
    LeftLeg: requiredPoint(frame, MP.leftKnee, add(leftHip, [0, -24, 0])),
    LeftFoot: requiredPoint(frame, MP.leftAnkle, add(leftHip, [0, -48, 4])),
    RightUpLeg: rightHip,
    RightLeg: requiredPoint(frame, MP.rightKnee, add(rightHip, [0, -24, 0])),
    RightFoot: requiredPoint(frame, MP.rightAnkle, add(rightHip, [0, -48, 4])),
  };
}

function solveFrame(frame: PoseFrameArtifactFrame, firstRoot: Vec3): SolvedMotionFrame | null {
  const points = skeletonPoints(frame);
  if (!points) return null;
  const joints: Record<string, [number, number, number]> = {};

  for (const joint of SKELETON) {
    if (!joint.primaryChild) {
      joints[joint.name] = [0, 0, 0];
      continue;
    }
    const from = joint.offset;
    const source = points[joint.name];
    const target = points[joint.primaryChild];
    const direction = source && target ? sub(target, source) : from;
    joints[joint.name] = quatToEulerXYZ(quatFromUnitVectors(from, direction));
  }

  return {
    frameIndex: frame.frameIndex,
    timestampMs: frame.timestampMs,
    rootTranslation: sub(points.Hips, firstRoot),
    joints,
  };
}

export function solveMotion(artifact: PoseFramesArtifact): SolvedMotionArtifact {
  const firstValid = artifact.frames.find((frame) => skeletonPoints(frame));
  if (!firstValid) {
    return {
      schema: "mocap.solved_motion.v1",
      takeId: artifact.takeId,
      jobId: artifact.jobId,
      skeleton: {
        name: SKELETON_NAME,
        rotationOrder: ROTATION_ORDER,
        coordinateSystem: "right_handed_y_up",
      },
      fps: artifact.sourceVideo.fps,
      frameCount: 0,
      durationMs: artifact.sourceVideo.durationMs,
      frames: [],
      validation: {
        ok: false,
        warnings: [],
        errors: ["No valid pose frames were available for skeleton solve."],
      },
    };
  }

  const firstRoot = skeletonPoints(firstValid)?.Hips ?? [0, 0, 0];
  const frames = artifact.frames
    .map((frame) => solveFrame(frame, firstRoot))
    .filter((frame): frame is SolvedMotionFrame => frame != null);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (frames.length === 0) errors.push("Solved motion has no frames.");
  if (frames.length < artifact.frames.length * 0.5) {
    warnings.push("More than half of detected frames were not solveable.");
  }

  return {
    schema: "mocap.solved_motion.v1",
    takeId: artifact.takeId,
    jobId: artifact.jobId,
    skeleton: {
      name: SKELETON_NAME,
      rotationOrder: ROTATION_ORDER,
      coordinateSystem: "right_handed_y_up",
    },
    fps: artifact.sourceVideo.fps,
    frameCount: frames.length,
    durationMs: artifact.sourceVideo.durationMs,
    frames,
    validation: {
      ok: errors.length === 0,
      warnings,
      errors,
    },
  };
}
