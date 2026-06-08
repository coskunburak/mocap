import type { SolvedMotionArtifact } from "../types";
import { childrenOf, SKELETON } from "./skeletonDefinition";

const BVH_JOINT_NAMES: Record<string, string> = {
  LeftArm: "LeftUpperArm",
  LeftForeArm: "LeftLowerArm",
  RightArm: "RightUpperArm",
  RightForeArm: "RightLowerArm",
  LeftUpLeg: "LeftUpperLeg",
  LeftLeg: "LeftLowerLeg",
  RightUpLeg: "RightUpperLeg",
  RightLeg: "RightLowerLeg",
};

function indent(level: number) {
  return "  ".repeat(level);
}

function fmt(value: number) {
  if (!Number.isFinite(value)) return "0.000000";
  return value.toFixed(6);
}

function writeJoint(name: string, level: number, lines: string[]) {
  const joint = SKELETON.find((item) => item.name === name);
  if (!joint) return;
  const kids = childrenOf(name);
  const keyword = joint.parent == null ? "ROOT" : "JOINT";
  lines.push(`${indent(level)}${keyword} ${BVH_JOINT_NAMES[joint.name] ?? joint.name}`);
  lines.push(`${indent(level)}{`);
  lines.push(
    `${indent(level + 1)}OFFSET ${fmt(joint.offset[0])} ${fmt(joint.offset[1])} ${fmt(joint.offset[2])}`,
  );
  if (joint.parent == null) {
    lines.push(
      `${indent(level + 1)}CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`,
    );
  } else {
    lines.push(`${indent(level + 1)}CHANNELS 3 Zrotation Xrotation Yrotation`);
  }

  if (kids.length === 0) {
    lines.push(`${indent(level + 1)}End Site`);
    lines.push(`${indent(level + 1)}{`);
    lines.push(`${indent(level + 2)}OFFSET 0.000000 4.000000 0.000000`);
    lines.push(`${indent(level + 1)}}`);
  } else {
    for (const child of kids) {
      writeJoint(child.name, level + 1, lines);
    }
  }
  lines.push(`${indent(level)}}`);
}

export function writeBvh(motion: SolvedMotionArtifact) {
  const lines: string[] = ["HIERARCHY"];
  writeJoint("Hips", 0, lines);
  lines.push("MOTION");
  lines.push(`Frames: ${motion.frames.length}`);
  lines.push(`Frame Time: ${fmt(1 / Math.max(1, motion.fps))}`);

  for (const frame of motion.frames) {
    const hips = frame.joints.Hips ?? [0, 0, 0];
    const values: number[] = [
      frame.rootTranslation[0],
      frame.rootTranslation[1],
      frame.rootTranslation[2],
      hips[2],
      hips[0],
      hips[1],
    ];
    for (const joint of SKELETON.slice(1)) {
      const rotation = frame.joints[joint.name] ?? [0, 0, 0];
      values.push(rotation[2], rotation[0], rotation[1]);
    }
    lines.push(values.map(fmt).join(" "));
  }

  return `${lines.join("\n")}\n`;
}
