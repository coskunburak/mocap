import type { PoseFrame } from "../../models/PoseFrame";
import type { LandmarkBuffer } from "../../models/Landmark";
import { type Bone, SKELETON_HIERARCHY } from "./SkeletonHierarchy";
import { KinematicsSolver, type JointData } from "./KinematicsSolver";

export class BvhExporter {
  private solver = new KinematicsSolver();

  // Flattens the hierarchy to ensure consistent order of channels
  private flatBones: string[] = [];

  constructor() {}

  private generateHierarchy(bone: Bone, depth: number): string {
    const indent = "  ".repeat(depth);
    const isRoot = depth === 0;
    const type = isRoot ? "ROOT" : bone.children.length === 0 ? "End Site" : "JOINT";
    
    let out = `${indent}${type} ${bone.name}\n`;
    out += `${indent}{\n`;
    
    const offset = this.solver.getBaseOffset(bone.name);
    // Multiply by 100 to convert meters to centimeters (standard for BVH)
    out += `${indent}  OFFSET ${(offset.x * 100).toFixed(4)} ${(offset.y * 100).toFixed(4)} ${(offset.z * 100).toFixed(4)}\n`;

    if (bone.children.length > 0 || isRoot) {
      if (isRoot) {
        out += `${indent}  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n`;
      } else {
        out += `${indent}  CHANNELS 3 Zrotation Xrotation Yrotation\n`;
      }
      this.flatBones.push(bone.name);

      for (const child of bone.children) {
        out += this.generateHierarchy(child, depth + 1);
      }
    } else {
      // End site
      this.flatBones.push(bone.name); // Track it if needed, usually end sites don't have channels
    }
    
    out += `${indent}}\n`;
    return out;
  }

  private generateFrameData(solved: JointData, frameOut: number[]): void {
    // Traverse in the exact same order as hierarchy
    if (solved.name === "Hips") {
      // Root gets positional data (converted to cm)
      frameOut.push(solved.position.x * 100, solved.position.y * 100, solved.position.z * 100);
    }
    
    if (solved.children.length > 0 || solved.name === "Hips") {
      // Convert radians to degrees
      const rad2deg = 180 / Math.PI;
      frameOut.push(
        solved.eulerZXY.z * rad2deg,
        solved.eulerZXY.x * rad2deg,
        solved.eulerZXY.y * rad2deg
      );
      
      for (const child of solved.children) {
        this.generateFrameData(child, frameOut);
      }
    }
  }

  public export(frames: PoseFrame[], useSmoothed: boolean = false): string {
    if (frames.length === 0) return "";

    // If using smoothed data, assume we have a OneEuroFilter pass done beforehand,
    // or we can do it here. For now, we use the provided frames directly.
    // If it's a multi-view frame, it should have `worldLandmarks`.
    const getBuffer = (f: PoseFrame) => (f.worldLandmarks || f.landmarks) as LandmarkBuffer;

    this.flatBones = [];
    
    // 1. Extract base offsets from the first frame
    this.solver.extractRestOffsets([getBuffer(frames[0])]);

    // 2. Build HIERARCHY string
    let bvh = "HIERARCHY\n";
    bvh += this.generateHierarchy(SKELETON_HIERARCHY, 0);

    // 3. Build MOTION string
    bvh += "MOTION\n";
    bvh += `Frames: ${frames.length}\n`;
    // Approximate frame time, fallback to 30fps
    const dt = frames.length > 1 ? (frames[1].ts - frames[0].ts) / 1000 : 0.033333;
    bvh += `Frame Time: ${dt.toFixed(6)}\n`;

    for (const frame of frames) {
      const solved = this.solver.solveFrame(getBuffer(frame));
      const frameData: number[] = [];
      this.generateFrameData(solved, frameData);
      bvh += frameData.map(v => v.toFixed(4)).join(" ") + "\n";
    }

    return bvh;
  }
}
