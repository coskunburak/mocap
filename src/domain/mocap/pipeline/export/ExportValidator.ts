import type { BakedAnimation } from "./AnimationBake";
import { getExportPreset, type ExportPresetId } from "./ExportPresets";
import { getRetargetPreset } from "../retarget/BoneMap";

export type ExportValidationIssue = Readonly<{
  code: string;
  severity: "error" | "warning";
  message: string;
}>;

export type ExportValidationResult = Readonly<{
  ok: boolean;
  presetId: ExportPresetId;
  targetSkeleton: string;
  jointCount: number;
  requiredBoneCount: number;
  missingTargetBones: readonly string[];
  issues: readonly ExportValidationIssue[];
  generatedAt: number;
}>;

const UNITY_HUMANOID_MIN_BONES = 15;

function hasFiniteVec3(value: { x: number; y: number; z: number }) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function getNodeIndexByName(bake: BakedAnimation, name: string) {
  return bake.nodes.findIndex((node) => node.name === name);
}

function addHierarchyIssue(
  issues: ExportValidationIssue[],
  bake: BakedAnimation,
  childName: string,
  expectedParentName: string | null,
) {
  const childIndex = getNodeIndexByName(bake, childName);
  if (childIndex < 0) {
    return;
  }

  const actualParentIndex = bake.nodes[childIndex]?.parentIndex ?? null;
  const actualParentName =
    actualParentIndex == null ? null : bake.nodes[actualParentIndex]?.name ?? null;

  if (actualParentName !== expectedParentName) {
    issues.push({
      code: "hierarchy",
      severity: "error",
      message: `${childName} must be parented to ${expectedParentName ?? "root"}; got ${actualParentName ?? "root"}.`,
    });
  }
}

function addOffsetDirectionIssue(
  issues: ExportValidationIssue[],
  bake: BakedAnimation,
  boneName: string,
  predicate: (offset: { x: number; y: number; z: number }) => boolean,
  message: string,
) {
  const node = bake.nodes.find((candidate) => candidate.name === boneName);
  if (!node) {
    return;
  }

  if (!predicate(node.offset)) {
    issues.push({
      code: "offset_direction",
      severity: "error",
      message,
    });
  }
}

export function validateBakedAnimation(
  bake: BakedAnimation,
  presetId: ExportPresetId,
): ExportValidationResult {
  const preset = getExportPreset(presetId);
  const retargetPreset = getRetargetPreset(preset.retargetPresetId);
  const issues: ExportValidationIssue[] = [];

  if (!Number.isFinite(bake.fps) || bake.fps <= 0) {
    issues.push({
      code: "fps",
      severity: "error",
      message: `Invalid export FPS: ${bake.fps}.`,
    });
  }

  if (bake.frames.length === 0) {
    issues.push({
      code: "frames",
      severity: "error",
      message: "Export has no animation frames.",
    });
  }

  const nodeNames = bake.nodes.map((node) => node.name);
  const duplicateNames = nodeNames.filter((name, index) => nodeNames.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    issues.push({
      code: "duplicate_bones",
      severity: "error",
      message: `Duplicate bone names detected: ${Array.from(new Set(duplicateNames)).join(", ")}.`,
    });
  }

  bake.nodes.forEach((node, index) => {
    if (!hasFiniteVec3(node.offset)) {
      issues.push({
        code: "offset",
        severity: "error",
        message: `Bone ${node.name} has a non-finite rest offset.`,
      });
    }

    if (node.parentIndex != null && (node.parentIndex < 0 || node.parentIndex >= bake.nodes.length)) {
      issues.push({
        code: "parent_index",
        severity: "error",
        message: `Bone ${node.name} references an invalid parent index.`,
      });
    }

    if (node.parentIndex != null && node.parentIndex >= index) {
      issues.push({
        code: "parent_order",
        severity: "error",
        message: `Bone ${node.name} appears before its parent in node order.`,
      });
    }
  });

  bake.frames.forEach((frame, index) => {
    if (frame.rotations.length !== bake.nodes.length) {
      issues.push({
        code: "rotation_count",
        severity: "error",
        message: `Frame ${index + 1} has ${frame.rotations.length} rotations for ${bake.nodes.length} bones.`,
      });
    }

    if (index > 0 && frame.time <= bake.frames[index - 1]!.time) {
      issues.push({
        code: "frame_time",
        severity: "error",
        message: "Animation frame times are not strictly increasing.",
      });
    }
  });

  const requiredTargetBones = retargetPreset.required
    .map((joint) => retargetPreset.sourceToTarget[joint])
    .filter(Boolean);
  const missingTargetBones = requiredTargetBones.filter((bone) => !nodeNames.includes(bone));

  if (missingTargetBones.length > 0) {
    issues.push({
      code: "missing_bones",
      severity: "error",
      message: `Required bones are missing: ${missingTargetBones.join(", ")}.`,
    });
  }

  if (preset.retargetPresetId === "unity-humanoid" && nodeNames.length < UNITY_HUMANOID_MIN_BONES) {
    issues.push({
      code: "humanoid_minimum",
      severity: "error",
      message: `Unity Humanoid requires at least ${UNITY_HUMANOID_MIN_BONES} bones; export has ${nodeNames.length}.`,
    });
  }

  if (preset.retargetPresetId === "unity-humanoid") {
    addHierarchyIssue(issues, bake, "Hips", null);
    addHierarchyIssue(issues, bake, "Spine", "Hips");
    addHierarchyIssue(issues, bake, "Chest", "Spine");
    addHierarchyIssue(issues, bake, "Neck", "Chest");
    addHierarchyIssue(issues, bake, "Head", "Neck");
    addHierarchyIssue(issues, bake, "LeftShoulder", "Chest");
    addHierarchyIssue(issues, bake, "LeftUpperArm", "LeftShoulder");
    addHierarchyIssue(issues, bake, "LeftLowerArm", "LeftUpperArm");
    addHierarchyIssue(issues, bake, "LeftHand", "LeftLowerArm");
    addHierarchyIssue(issues, bake, "RightShoulder", "Chest");
    addHierarchyIssue(issues, bake, "RightUpperArm", "RightShoulder");
    addHierarchyIssue(issues, bake, "RightLowerArm", "RightUpperArm");
    addHierarchyIssue(issues, bake, "RightHand", "RightLowerArm");
    addHierarchyIssue(issues, bake, "LeftUpperLeg", "Hips");
    addHierarchyIssue(issues, bake, "LeftLowerLeg", "LeftUpperLeg");
    addHierarchyIssue(issues, bake, "LeftFoot", "LeftLowerLeg");
    addHierarchyIssue(issues, bake, "RightUpperLeg", "Hips");
    addHierarchyIssue(issues, bake, "RightLowerLeg", "RightUpperLeg");
    addHierarchyIssue(issues, bake, "RightFoot", "RightLowerLeg");
    addOffsetDirectionIssue(
      issues,
      bake,
      "LeftUpperArm",
      (offset) => offset.x < 0,
      "LeftUpperArm must sit on the negative X side for Unity humanoid import.",
    );
    addOffsetDirectionIssue(
      issues,
      bake,
      "RightUpperArm",
      (offset) => offset.x > 0,
      "RightUpperArm must sit on the positive X side for Unity humanoid import.",
    );
    addOffsetDirectionIssue(
      issues,
      bake,
      "LeftUpperLeg",
      (offset) => offset.x < 0 && offset.y < 0,
      "LeftUpperLeg must extend to negative X and downward from Hips.",
    );
    addOffsetDirectionIssue(
      issues,
      bake,
      "RightUpperLeg",
      (offset) => offset.x > 0 && offset.y < 0,
      "RightUpperLeg must extend to positive X and downward from Hips.",
    );
  }

  bake.nodes.forEach((node) => {
    if (node.parentIndex == null) {
      return;
    }

    const magnitude = Math.hypot(node.offset.x, node.offset.y, node.offset.z);
    if (magnitude < 1e-4) {
      issues.push({
        code: "zero_length_bone",
        severity: "warning",
        message: `Bone ${node.name} has a near-zero rest offset and may collapse in DCC tools.`,
      });
    }
  });

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    presetId,
    targetSkeleton: retargetPreset.targetSkeleton,
    jointCount: bake.nodes.length,
    requiredBoneCount: requiredTargetBones.length,
    missingTargetBones,
    issues,
    generatedAt: Date.now(),
  };
}
