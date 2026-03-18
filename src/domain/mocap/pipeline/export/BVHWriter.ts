import type { PoseFrame } from "../../models/PoseFrame";
import type { CalibrationPose } from "../../models/Take";
import type { Quaternion } from "../retarget/Quaternion";
import { quatInverse, quatMultiply, quatToEulerZXYDeg } from "../retarget/Quaternion";
import { bakeAnimation, type BakedAnimation } from "./AnimationBake";
import type { ExportPresetId } from "./ExportPresets";

type BVHOptions = {
  fps?: number;
  calibrationFrames?: number;
  preserveRootMotion?: boolean | "auto";
  presetId?: ExportPresetId;
  targetPose?: CalibrationPose;
};

function fmt(n: number) {
  const value = Math.abs(n) < 1e-8 ? 0 : n;
  return value.toFixed(6);
}

function toDeltaRotation(
  current: Quaternion,
  rest: Quaternion,
) {
  return quatMultiply(current, quatInverse(rest));
}

function childrenOfNode(bake: BakedAnimation, nodeIndex: number) {
  return bake.nodes
    .map((node, index) => (node.parentIndex === nodeIndex ? index : -1))
    .filter((index) => index >= 0);
}

function writeHierarchy(bake: BakedAnimation) {
  const lines: string[] = [];
  const root = bake.nodes[0];

  lines.push("HIERARCHY");
  lines.push(`ROOT ${root?.name ?? "Hips"}`);
  lines.push("{");
  lines.push("  OFFSET 0.000000 0.000000 0.000000");
  lines.push("  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation");

  const writeJoint = (nodeIndex: number, indent: number) => {
    const pad = "  ".repeat(indent);

    for (const childIndex of childrenOfNode(bake, nodeIndex)) {
      const child = bake.nodes[childIndex];
      lines.push(`${pad}JOINT ${child.name}`);
      lines.push(`${pad}{`);
      lines.push(
        `${pad}  OFFSET ${fmt(child.offset.x)} ${fmt(child.offset.y)} ${fmt(child.offset.z)}`,
      );
      lines.push(`${pad}  CHANNELS 3 Zrotation Xrotation Yrotation`);

      writeJoint(childIndex, indent + 1);

      if (childrenOfNode(bake, childIndex).length === 0) {
        lines.push(`${pad}  End Site`);
        lines.push(`${pad}  {`);
        lines.push(`${pad}    OFFSET 0.000000 0.000000 0.000000`);
        lines.push(`${pad}  }`);
      }

      lines.push(`${pad}}`);
    }
  };

  writeJoint(0, 1);
  lines.push("}");

  return lines.join("\n");
}

function writeMotion(bake: BakedAnimation) {
  const lines: string[] = [];

  lines.push("MOTION");
  lines.push(`Frames: ${bake.frames.length}`);
  lines.push(`Frame Time: ${(1 / bake.fps).toFixed(6)}`);

  for (const frame of bake.frames) {
    const rootDelta = toDeltaRotation(frame.rotations[0], bake.restLocalRotations[0]);
    const rootEuler = quatToEulerZXYDeg(rootDelta);
    const values: number[] = [
      frame.rootTranslation.x,
      frame.rootTranslation.y,
      frame.rootTranslation.z,
      rootEuler.z,
      rootEuler.x,
      rootEuler.y,
    ];

    for (let nodeIndex = 1; nodeIndex < bake.nodes.length; nodeIndex += 1) {
      const delta = toDeltaRotation(
        frame.rotations[nodeIndex],
        bake.restLocalRotations[nodeIndex],
      );
      const euler = quatToEulerZXYDeg(delta);
      values.push(euler.z, euler.x, euler.y);
    }

    lines.push(values.map(fmt).join(" "));
  }

  return lines.join("\n");
}

export class BVHWriter {
  static fromBakedAnimation(bake: BakedAnimation) {
    if (bake.frames.length === 0) {
      throw new Error("No frames");
    }

    return `${writeHierarchy(bake)}\n${writeMotion(bake)}\n`;
  }

  static fromMediapipePoseFrames(frames: PoseFrame[], opts?: BVHOptions) {
    if (frames.length === 0) {
      throw new Error("No frames");
    }

    const baked = bakeAnimation(frames, {
      fps: opts?.fps ?? 30,
      calibrationFrames: opts?.calibrationFrames,
      preserveRootMotion: opts?.preserveRootMotion ?? "auto",
      presetId: opts?.presetId ?? "dcc-archive",
      targetPose: opts?.targetPose,
    });

    return BVHWriter.fromBakedAnimation(baked);
  }
}
