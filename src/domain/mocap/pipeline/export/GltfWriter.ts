import type { BakedAnimation } from "./AnimationBake";
import type { Quaternion } from "../retarget/Quaternion";

type GlbPayload = {
  jsonText: string;
  glbBytes: Uint8Array;
};

type GltfPayload = {
  jsonText: string;
};

function pad4(length: number) {
  return (4 - (length % 4)) % 4;
}

function encodeBase64(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;
    const remaining = Math.min(3, bytes.length - index);

    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += remaining > 1 ? alphabet[(chunk >> 6) & 63] : "=";
    output += remaining > 2 ? alphabet[chunk & 63] : "=";
  }
  return output;
}

function f32(values: number[]) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function quaternionArray(rotation: Quaternion) {
  return [rotation.x, rotation.y, rotation.z, rotation.w];
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

function translationMatrix(x: number, y: number, z: number) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function matrixFromTR(
  translation: { x: number; y: number; z: number },
  rotation: Quaternion,
) {
  const matrix = quaternionToMatrix(rotation);
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

function inverseRigidTransform(matrix: number[]) {
  const r00 = matrix[0];
  const r01 = matrix[1];
  const r02 = matrix[2];
  const r10 = matrix[4];
  const r11 = matrix[5];
  const r12 = matrix[6];
  const r20 = matrix[8];
  const r21 = matrix[9];
  const r22 = matrix[10];
  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];

  return [
    r00,
    r10,
    r20,
    0,
    r01,
    r11,
    r21,
    0,
    r02,
    r12,
    r22,
    0,
    -(tx * r00 + ty * r10 + tz * r20),
    -(tx * r01 + ty * r11 + tz * r21),
    -(tx * r02 + ty * r12 + tz * r22),
    1,
  ];
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

function buildPayload(bake: BakedAnimation) {
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const binaryChunks: Uint8Array[] = [];

  const pushAccessor = (
    bytes: Uint8Array,
    componentType: number,
    count: number,
    type: string,
    extras?: Record<string, unknown>,
  ) => {
    const padded = pad4(bytes.length);
    const offset = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    binaryChunks.push(bytes);
    if (padded) {
      binaryChunks.push(new Uint8Array(padded));
    }

    const bufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
    });
    const accessorIndex = accessors.length;
    accessors.push({
      bufferView: bufferViewIndex,
      componentType,
      count,
      type,
      ...extras,
    });
    return accessorIndex;
  };

  const times = bake.frames.map((frame) => frame.time);
  const timeAccessor = pushAccessor(
    f32(times),
    5126,
    times.length,
    "SCALAR",
    {
      min: [times[0] ?? 0],
      max: [times[times.length - 1] ?? 0],
    },
  );

  const restMatrices = buildRestMatrices(bake);
  const inverseBindMatrices = restMatrices.flatMap((matrix) => inverseRigidTransform(matrix));
  const inverseBindAccessor = pushAccessor(
    f32(inverseBindMatrices),
    5126,
    bake.nodes.length,
    "MAT4",
  );

  const nodes = bake.nodes.map((node, index) => ({
    name: node.name,
    extras: {
      sourceJoint: node.sourceJoint,
      rig: "mocapexpo-humanoid-v2",
    },
    translation:
      node.parentIndex == null
        ? [0, 0, 0]
        : [node.offset.x, node.offset.y, node.offset.z],
    rotation: quaternionArray(bake.restLocalRotations[index]),
    children: bake.nodes
      .map((candidate, candidateIndex) =>
        candidate.parentIndex === index ? candidateIndex : -1,
      )
      .filter((candidateIndex) => candidateIndex >= 0),
  }));

  const samplers: any[] = [];
  const channels: any[] = [];

  const rootTranslations = bake.frames.flatMap((frame) => [
    frame.rootTranslation.x,
    frame.rootTranslation.y,
    frame.rootTranslation.z,
  ]);
  const rootTranslationAccessor = pushAccessor(
    f32(rootTranslations),
    5126,
    bake.frames.length,
    "VEC3",
  );
  samplers.push({
    input: timeAccessor,
    output: rootTranslationAccessor,
    interpolation: "LINEAR",
  });
  channels.push({
    sampler: samplers.length - 1,
    target: { node: 0, path: "translation" },
  });

  bake.nodes.forEach((_, nodeIndex) => {
    const rotations = bake.frames.flatMap((frame) =>
      quaternionArray(frame.rotations[nodeIndex]),
    );
    const rotationAccessor = pushAccessor(
      f32(rotations),
      5126,
      bake.frames.length,
      "VEC4",
    );
    samplers.push({
      input: timeAccessor,
      output: rotationAccessor,
      interpolation: "LINEAR",
    });
    channels.push({
      sampler: samplers.length - 1,
      target: { node: nodeIndex, path: "rotation" },
    });
  });

  return {
    json: {
      asset: { version: "2.0", generator: "MocapExpo humanoid-v2" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes,
      skins: [
        {
          name: "MocapExpoRig",
          joints: bake.nodes.map((_, index) => index),
          skeleton: 0,
          inverseBindMatrices: inverseBindAccessor,
        },
      ],
      animations: [
        {
          name: "Take",
          samplers,
          channels,
        },
      ],
      buffers: [
        {
          byteLength: binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0),
        },
      ] as Array<{ byteLength: number; uri?: string }>,
      bufferViews,
      accessors,
      extras: {
        presetId: bake.presetId,
        rig: "mocapexpo-humanoid-v2",
      },
    },
    binary: concatBytes(binaryChunks),
  };
}

export const GltfWriter = {
  toGltf(bake: BakedAnimation): GltfPayload {
    const payload = buildPayload(bake);
    payload.json.buffers[0].uri = `data:application/octet-stream;base64,${encodeBase64(payload.binary)}`;
    return {
      jsonText: JSON.stringify(payload.json),
    };
  },

  toGlb(bake: BakedAnimation): GlbPayload {
    const payload = buildPayload(bake);
    const encoder = new TextEncoder();
    const jsonChunk = encoder.encode(JSON.stringify(payload.json));
    const jsonPadding = pad4(jsonChunk.length);
    const binPadding = pad4(payload.binary.length);

    const totalLength =
      12 +
      8 +
      jsonChunk.length +
      jsonPadding +
      8 +
      payload.binary.length +
      binPadding;

    const out = new Uint8Array(totalLength);
    const view = new DataView(out.buffer);

    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);

    let offset = 12;
    view.setUint32(offset, jsonChunk.length + jsonPadding, true);
    view.setUint32(offset + 4, 0x4e4f534a, true);
    out.set(jsonChunk, offset + 8);
    for (let i = 0; i < jsonPadding; i += 1) {
      out[offset + 8 + jsonChunk.length + i] = 0x20;
    }
    offset += 8 + jsonChunk.length + jsonPadding;

    view.setUint32(offset, payload.binary.length + binPadding, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    out.set(payload.binary, offset + 8);

    return {
      jsonText: JSON.stringify(payload.json),
      glbBytes: out,
    };
  },
};
