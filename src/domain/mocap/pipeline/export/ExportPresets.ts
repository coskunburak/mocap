import type { RetargetPresetId } from "../retarget/BoneMap";

export type ExportFormat =
  | "json"
  | "bvh"
  | "gltf"
  | "glb"
  | "fbx"
  | "usd"
  | "both"
  | "bundle";

export type SingleExportFormat = Exclude<ExportFormat, "bundle" | "both">;

export type ExportPresetId =
  | "unity-handoff"
  | "unreal-handoff"
  | "web-preview"
  | "dcc-archive";

export type ExportPreset = Readonly<{
  id: ExportPresetId;
  label: string;
  description: string;
  formats: readonly SingleExportFormat[];
  primaryFormat: SingleExportFormat;
  retargetPresetId: RetargetPresetId;
  scaleMultiplier: number;
}>;

const PRESETS: Readonly<Record<ExportPresetId, ExportPreset>> = {
  "unity-handoff": {
    id: "unity-handoff",
    label: "Unity Handoff",
    description: "Humanoid delivery for Unity import with FBX as the primary asset.",
    formats: ["fbx", "json"],
    primaryFormat: "fbx",
    retargetPresetId: "unity-humanoid",
    scaleMultiplier: 1,
  },
  "unreal-handoff": {
    id: "unreal-handoff",
    label: "Unreal Handoff",
    description: "Manny/Quinn oriented delivery with FBX plus USDA reference.",
    formats: ["fbx", "usd", "json"],
    primaryFormat: "fbx",
    retargetPresetId: "unreal-mannequin",
    scaleMultiplier: 1,
  },
  "web-preview": {
    id: "web-preview",
    label: "Web Preview",
    description: "Compact GLB delivery for preview tools and browser-based review.",
    formats: ["glb", "json"],
    primaryFormat: "glb",
    retargetPresetId: "generic-humanoid",
    scaleMultiplier: 0.01,
  },
  "dcc-archive": {
    id: "dcc-archive",
    label: "DCC Archive",
    description: "Multi-format archive for Blender, Maya, MotionBuilder, and pipeline handoff.",
    formats: ["bvh", "gltf", "usd", "json"],
    primaryFormat: "gltf",
    retargetPresetId: "generic-humanoid",
    scaleMultiplier: 0.01,
  },
};

export function getExportPreset(id: ExportPresetId = "dcc-archive") {
  return PRESETS[id];
}

export function listExportPresets() {
  return Object.values(PRESETS);
}
