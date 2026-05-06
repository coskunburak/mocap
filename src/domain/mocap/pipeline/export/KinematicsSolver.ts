import type { LandmarkBuffer } from "../../models/Landmark";
import { LANDMARK_STRIDE } from "../../models/Landmark";
import { Quaternion, Vector3 } from "../math/Math3D";
import { type Bone, PoseJoints, SKELETON_HIERARCHY } from "./SkeletonHierarchy";

export type JointData = {
  name: string;
  position: Vector3; // Global position
  rotation: Quaternion; // Local rotation
  eulerZXY: { x: number; y: number; z: number }; // Local euler angles (radians)
  children: JointData[];
};

export class KinematicsSolver {
  private baseBoneLengths: Record<string, number> = {};
  private baseBoneDirs: Record<string, Vector3> = {};

  constructor() {}

  // Retrieves the 3D position of a joint from the landmark buffer
  private getJointPos(buffer: LandmarkBuffer, jointIndex: number): Vector3 {
    if (jointIndex === -1) {
      // Hips: Midpoint of left and right hip
      const lHip = this.getJointPos(buffer, PoseJoints.LEFT_HIP);
      const rHip = this.getJointPos(buffer, PoseJoints.RIGHT_HIP);
      return lHip.add(rHip).multiplyScalar(0.5);
    }
    if (jointIndex === -2) {
      // Mid-shoulder
      const lShldr = this.getJointPos(buffer, PoseJoints.LEFT_SHOULDER);
      const rShldr = this.getJointPos(buffer, PoseJoints.RIGHT_SHOULDER);
      return lShldr.add(rShldr).multiplyScalar(0.5);
    }
    const o = jointIndex * LANDMARK_STRIDE;
    return new Vector3(buffer[o], buffer[o + 1], buffer[o + 2]); // x, y, z
  }

  // Define a generic T-pose mapping for rest orientations
  private getRestDirection(boneName: string): Vector3 {
    // T-Pose rest directions
    if (boneName.includes("LeftArm") || boneName.includes("LeftForeArm") || boneName.includes("LeftHand")) {
      return new Vector3(1, 0, 0); // Arms point left (+x in BVH coords often)
    }
    if (boneName.includes("RightArm") || boneName.includes("RightForeArm") || boneName.includes("RightHand")) {
      return new Vector3(-1, 0, 0); // Arms point right (-x)
    }
    if (boneName.includes("Leg") || boneName.includes("Foot")) {
      return new Vector3(0, -1, 0); // Legs point down (-y)
    }
    if (boneName === "Spine" || boneName === "Neck") {
      return new Vector3(0, 1, 0); // Spine points up (+y)
    }
    if (boneName === "LeftShoulder") return new Vector3(1, 0, 0);
    if (boneName === "RightShoulder") return new Vector3(-1, 0, 0);
    if (boneName === "LeftUpLeg") return new Vector3(1, -1, 0).normalize();
    if (boneName === "RightUpLeg") return new Vector3(-1, -1, 0).normalize();
    
    return new Vector3(0, 1, 0); // Default up
  }

  /**
   * Solves the hierarchy for a single frame.
   * Recursively computes global and local rotations.
   */
  public solveFrame(buffer: LandmarkBuffer): JointData {
    // 1. First pass: Get all global positions
    const positions: Record<string, Vector3> = {};
    const extractPositions = (bone: Bone) => {
      positions[bone.name] = this.getJointPos(buffer, bone.endJoint);
      bone.children.forEach(extractPositions);
    };
    extractPositions(SKELETON_HIERARCHY);

    // Root position is the start of the Hips
    const rootPos = this.getJointPos(buffer, -1);

    // 2. Second pass: Compute rotations
    const solveBone = (bone: Bone, parentGlobalRot: Quaternion): JointData => {
      const pos = positions[bone.name];
      const startPos = bone.parent ? positions[bone.parent] : rootPos;
      
      const dirGlobal = pos.sub(startPos).normalize();
      const dirRest = this.getRestDirection(bone.name);

      // We want to find the local rotation Q_local such that:
      // ParentGlobalRot * Q_local * RestDir = GlobalDir
      // Q_local * RestDir = ParentGlobalRot^-1 * GlobalDir

      const invParentRot = parentGlobalRot.invert();
      const dirLocal = new Vector3(
        invParentRot.x, invParentRot.y, invParentRot.z
      ); // This is just a placeholder, actual vector rotation requires q * v * q^-1
      
      // Vector rotation by quaternion: v' = q * v * q^-1
      const rotVec = (q: Quaternion, v: Vector3) => {
        const qv = new Quaternion(v.x, v.y, v.z, 0);
        const res = q.multiply(qv).multiply(q.invert());
        return new Vector3(res.x, res.y, res.z);
      };

      const dirTargetLocal = rotVec(invParentRot, dirGlobal);
      
      // Local rotation from RestDir to TargetLocalDir
      const localRot = Quaternion.fromVectors(dirRest, dirTargetLocal);
      
      const globalRot = parentGlobalRot.multiply(localRot).normalize();

      const euler = localRot.toEulerZXY();

      const children = bone.children.map(child => solveBone(child, globalRot));

      return {
        name: bone.name,
        position: pos,
        rotation: localRot,
        eulerZXY: euler,
        children,
      };
    };

    return solveBone(SKELETON_HIERARCHY, Quaternion.identity());
  }

  /**
   * Generates BVH Hierarchy offsets by averaging the bone lengths across given frames
   * (usually use the calibration T-pose frames).
   */
  public extractRestOffsets(frames: LandmarkBuffer[]) {
    // For now, take the first frame as the rest pose offset
    if (!frames.length) return;
    const buf = frames[0];
    
    const extract = (bone: Bone, startP: Vector3) => {
      const endP = this.getJointPos(buf, bone.endJoint);
      const vec = endP.sub(startP);
      this.baseBoneDirs[bone.name] = vec;
      this.baseBoneLengths[bone.name] = vec.length();
      bone.children.forEach(c => extract(c, endP));
    };
    
    extract(SKELETON_HIERARCHY, this.getJointPos(buf, -1));
  }

  public getBaseOffset(boneName: string): Vector3 {
    return this.baseBoneDirs[boneName] || new Vector3(0, 0, 0);
  }
}
