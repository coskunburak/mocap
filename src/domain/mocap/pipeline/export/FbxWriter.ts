import type { BakedAnimation } from "./AnimationBake";
import { quatToEulerXYZDeg } from "../retarget/Quaternion";

const FBX_TICKS_PER_SECOND = 46186158000;

function fmt(value: number) {
  const normalized = Math.abs(value) < 1e-8 ? 0 : value;
  return Number.isInteger(normalized) ? `${normalized}` : normalized.toFixed(6);
}

function matrixFromTranslation(x: number, y: number, z: number) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function matrixFromQuaternion(x: number, y: number, z: number, w: number) {
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
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    0,
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    0,
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ];
}

function matrixFromTR(
  translation: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number },
) {
  const matrix = matrixFromQuaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  matrix[12] = translation.x;
  matrix[13] = translation.y;
  matrix[14] = translation.z;
  return matrix;
}

function multiplyMat4(a: number[], b: number[]) {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row * 4 + col] =
        a[row * 4 + 0] * b[0 * 4 + col] +
        a[row * 4 + 1] * b[1 * 4 + col] +
        a[row * 4 + 2] * b[2 * 4 + col] +
        a[row * 4 + 3] * b[3 * 4 + col];
    }
  }
  return out;
}

function buildRestMatrices(bake: BakedAnimation) {
  const matrices: number[][] = [];
  bake.nodes.forEach((node, index) => {
    const localTranslation =
      node.parentIndex == null
        ? { x: 0, y: 0, z: 0 }
        : { x: node.offset.x, y: node.offset.y, z: node.offset.z };
    const local = matrixFromTR(localTranslation, bake.restLocalRotations[index]);
    matrices[index] =
      node.parentIndex == null ? local : multiplyMat4(matrices[node.parentIndex], local);
  });
  return matrices;
}

function keyTimes(frameCount: number, fps: number) {
  return Array.from({ length: frameCount }, (_, index) =>
    Math.round((index / fps) * FBX_TICKS_PER_SECOND),
  );
}

function keyAttrFlags(frameCount: number) {
  return Array.from({ length: frameCount }, () => "24836").join(",");
}

function keyAttrData(frameCount: number) {
  return Array.from({ length: frameCount * 4 }, () => "0").join(",");
}

function keyAttrRefCount(frameCount: number) {
  return Array.from({ length: frameCount }, () => "1").join(",");
}

export const FbxWriter = {
  fromBakedAnimation(bake: BakedAnimation) {
    const ids = {
      rootModel: 100000,
      rootAttr: 100500,
      pose: 101000,
      animStack: 102000,
      animLayer: 102100,
    };

    const modelIds = bake.nodes.map((_, index) => ids.rootModel + index);
    const attrIds = bake.nodes.map((_, index) => ids.rootAttr + index);
    const restMatrices = buildRestMatrices(bake);
    const times = keyTimes(bake.frames.length, bake.fps);

    let curveNodeId = 110000;
    let curveId = 120000;

    const objects: string[] = [];
    const connections: string[] = [];

    bake.nodes.forEach((node, index) => {
      const restRotation = quatToEulerXYZDeg(bake.restLocalRotations[index]);
      const localTranslation =
        node.parentIndex == null
          ? [0, 0, 0]
          : [node.offset.x, node.offset.y, node.offset.z];
      objects.push(`    Model: ${modelIds[index]}, "Model::${node.name}", "LimbNode" {
      Version: 232
      Properties70:  {
        P: "Lcl Translation", "Lcl Translation", "", "A",${fmt(localTranslation[0])},${fmt(localTranslation[1])},${fmt(localTranslation[2])}
        P: "Lcl Rotation", "Lcl Rotation", "", "A",${fmt(restRotation.x)},${fmt(restRotation.y)},${fmt(restRotation.z)}
        P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
        P: "RotationOrder", "enum", "", "",0
      }
      Shading: T
      Culling: "CullingOff"
    }`);
      objects.push(`    NodeAttribute: ${attrIds[index]}, "NodeAttribute::${node.name}", "LimbNode" {
      TypeFlags: "Skeleton"
      Properties70:  {
        P: "Size", "double", "Number", "",1
      }
    }`);

      connections.push(`    C: "OO",${attrIds[index]},${modelIds[index]}`);
      if (node.parentIndex == null) {
        connections.push(`    C: "OO",${modelIds[index]},0`);
      } else {
        connections.push(`    C: "OO",${modelIds[index]},${modelIds[node.parentIndex]}`);
      }
    });

    const poseNodes = bake.nodes
      .map((_, index) => {
        const matrix = restMatrices[index].map((value) => fmt(value)).join(",");
        return `      PoseNode:  {
        Node: ${modelIds[index]}
        Matrix: ${matrix}
      }`;
      })
      .join("\n");
    objects.push(`    Pose: ${ids.pose}, "Pose::BindPose", "BindPose" {
      Type: "BindPose"
      Version: 100
      NbPoseNodes: ${bake.nodes.length}
${poseNodes}
    }`);

    objects.push(`    AnimationStack: ${ids.animStack}, "AnimStack::Take", "" {
    }`);
    objects.push(`    AnimationLayer: ${ids.animLayer}, "AnimLayer::BaseLayer", "" {
    }`);
    connections.push(`    C: "OO",${ids.animLayer},${ids.animStack}`);

    bake.nodes.forEach((node, index) => {
      const rotationCurveNode = curveNodeId++;
      const rotationCurves = [curveId++, curveId++, curveId++];
      const rotationKeys = bake.frames.map((frame) => quatToEulerXYZDeg(frame.rotations[index]));
      objects.push(`    AnimationCurveNode: ${rotationCurveNode}, "AnimCurveNode::${node.name}_R", "" {
      Properties70:  {
        P: "d|X", "Number", "", "A",0
        P: "d|Y", "Number", "", "A",0
        P: "d|Z", "Number", "", "A",0
      }
    }`);
      connections.push(`    C: "OP",${rotationCurveNode},${modelIds[index]},"Lcl Rotation"`);
      connections.push(`    C: "OO",${rotationCurveNode},${ids.animLayer}`);

      [["X", "x"], ["Y", "y"], ["Z", "z"]].forEach(([label, axis], axisIndex) => {
        const values = rotationKeys.map((rotation) => fmt(rotation[axis as "x" | "y" | "z"])).join(",");
        objects.push(`    AnimationCurve: ${rotationCurves[axisIndex]}, "AnimCurve::${node.name}_R_${label}", "" {
      Default: 0
      KeyVer: 4008
      KeyTime: *${times.length} {
        a: ${times.join(",")}
      }
      KeyValueFloat: *${rotationKeys.length} {
        a: ${values}
      }
      KeyAttrFlags: *${times.length} {
        a: ${keyAttrFlags(times.length)}
      }
      KeyAttrDataFloat: *${times.length * 4} {
        a: ${keyAttrData(times.length)}
      }
      KeyAttrRefCount: *${times.length} {
        a: ${keyAttrRefCount(times.length)}
      }
    }`);
        connections.push(`    C: "OP",${rotationCurves[axisIndex]},${rotationCurveNode},"d|${label}"`);
      });

      if (index === 0) {
        const translationCurveNode = curveNodeId++;
        const translationCurves = [curveId++, curveId++, curveId++];
        objects.push(`    AnimationCurveNode: ${translationCurveNode}, "AnimCurveNode::${node.name}_T", "" {
      Properties70:  {
        P: "d|X", "Number", "", "A",0
        P: "d|Y", "Number", "", "A",0
        P: "d|Z", "Number", "", "A",0
      }
    }`);
        connections.push(`    C: "OP",${translationCurveNode},${modelIds[index]},"Lcl Translation"`);
        connections.push(`    C: "OO",${translationCurveNode},${ids.animLayer}`);

        [["X", "x"], ["Y", "y"], ["Z", "z"]].forEach(([label, axis], axisIndex) => {
          const values = bake.frames
            .map((frame) => fmt(frame.rootTranslation[axis as "x" | "y" | "z"]))
            .join(",");
          objects.push(`    AnimationCurve: ${translationCurves[axisIndex]}, "AnimCurve::${node.name}_T_${label}", "" {
      Default: 0
      KeyVer: 4008
      KeyTime: *${times.length} {
        a: ${times.join(",")}
      }
      KeyValueFloat: *${bake.frames.length} {
        a: ${values}
      }
      KeyAttrFlags: *${times.length} {
        a: ${keyAttrFlags(times.length)}
      }
      KeyAttrDataFloat: *${times.length * 4} {
        a: ${keyAttrData(times.length)}
      }
      KeyAttrRefCount: *${times.length} {
        a: ${keyAttrRefCount(times.length)}
      }
    }`);
          connections.push(`    C: "OP",${translationCurves[axisIndex]},${translationCurveNode},"d|${label}"`);
        });
      }
    });

    const definitionBlocks = [
      `    ObjectType: "Model" {\n      Count: ${bake.nodes.length}\n    }`,
      `    ObjectType: "NodeAttribute" {\n      Count: ${bake.nodes.length}\n    }`,
      `    ObjectType: "Pose" {\n      Count: 1\n    }`,
      `    ObjectType: "AnimationStack" {\n      Count: 1\n    }`,
      `    ObjectType: "AnimationLayer" {\n      Count: 1\n    }`,
      `    ObjectType: "AnimationCurveNode" {\n      Count: ${bake.nodes.length + 1}\n    }`,
      `    ObjectType: "AnimationCurve" {\n      Count: ${(bake.nodes.length * 3) + 3}\n    }`,
    ].join("\n");

return `; FBX 7.4.0 project file
FBXHeaderExtension:  {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
  Creator: "MocapExpo humanoid-v2"
}
GlobalSettings:  {
  Version: 1000
  Properties70:  {
    P: "UpAxis", "int", "Integer", "",1
    P: "UpAxisSign", "int", "Integer", "",1
    P: "FrontAxis", "int", "Integer", "",2
    P: "FrontAxisSign", "int", "Integer", "",1
    P: "CoordAxis", "int", "Integer", "",0
    P: "CoordAxisSign", "int", "Integer", "",1
    P: "UnitScaleFactor", "double", "Number", "",1
    P: "OriginalUnitScaleFactor", "double", "Number", "",1
  }
}
Definitions:  {
  Version: 100
${definitionBlocks}
}
Objects:  {
${objects.join("\n")}
}
Connections:  {
${connections.join("\n")}
    C: "OO",${ids.pose},0
}
`;
  },
};
