import type { BakedAnimation } from "./AnimationBake";
import type { Quaternion } from "../retarget/Quaternion";

function fmt(value: number) {
  const normalized = Math.abs(value) < 1e-8 ? 0 : value;
  return Number.isInteger(normalized) ? `${normalized}` : normalized.toFixed(6);
}

function quaternionToMatrix(rotation: Quaternion) {
  const { w, x, y, z } = rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0],
    [0, 0, 0, 1],
  ];
}

function matrixString(
  translation: { x: number; y: number; z: number },
  rotation: Quaternion,
) {
  const matrix = quaternionToMatrix(rotation);
  matrix[3][0] = translation.x;
  matrix[3][1] = translation.y;
  matrix[3][2] = translation.z;

  return `((${matrix
    .map((row) => row.map((value) => fmt(value)).join(", "))
    .join("), (")}))`;
}

function writeNode(
  bake: BakedAnimation,
  nodeIndex: number,
  indent: number,
): string {
  const node = bake.nodes[nodeIndex];
  const pad = "    ".repeat(indent);
  const childIndices = bake.nodes
    .map((candidate, index) => (candidate.parentIndex === nodeIndex ? index : -1))
    .filter((index) => index >= 0);

  const timeSamples = bake.frames
    .map((frame) => {
      const translation =
        node.parentIndex == null
          ? frame.rootTranslation
          : node.offset;
      return `${pad}        ${fmt(frame.time)}: ${matrixString(
        translation,
        frame.rotations[nodeIndex],
      )}`;
    })
    .join(",\n");

  const children = childIndices.map((childIndex) => writeNode(bake, childIndex, indent + 1)).join("\n");

  return `${pad}def Xform "${node.name}" {
${pad}    customData = {
${pad}        string sourceJoint = "${node.sourceJoint}"
${pad}        string rig = "mocapexpo-humanoid-v2"
${pad}    }
${pad}    matrix4d xformOp:transform.timeSamples = {
${timeSamples}
${pad}    }
${pad}    uniform token[] xformOpOrder = ["xformOp:transform"]
${children ? `\n${children}` : ""}
${pad}}`;
}

export const UsdWriter = {
  fromBakedAnimation(bake: BakedAnimation) {
    return `#usda 1.0
(
    defaultPrim = "Take"
    metersPerUnit = 0.01
    upAxis = "Y"
    documentation = "MocapExpo humanoid-v2 export"
)

def Xform "Take" {
${writeNode(bake, 0, 1)}
}
`;
  },
};
