import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Asset } from "expo-asset";
import { Canvas, useFrame, useThree } from "@react-three/fiber/native";
import * as THREE from "three";
import { useCaptureStore } from "../state/captureStore";
import {
  MP33,
  JOINT_NAMES,
  RIG,
  RIG_ROOT,
  childrenOf,
  type JointName,
} from "../../../domain/mocap/models/BodyPose33";
import { lmAt, type LandmarkBuffer } from "../../../domain/mocap/models/Landmark";
import type { PoseFrame } from "../../../domain/mocap/models/PoseFrame";
import {
  createAvatarMotionCalibration,
  solveAvatarMotionFrame,
  type AvatarMotionCalibration,
} from "../../../domain/mocap/pipeline/avatar/AvatarMotion";
import {
  buildBlendshapeIndexCache,
  blendshapeLerpFactor,
} from "./BlendshapeAliases";
import { LOW_POLY_HUMANOID_ROBOT_GLB } from "../../../assets/avatarAssets";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Camera follow distance */
const CAMERA_DISTANCE = 2.5;

/** Blendshape score thresholds */
const BLENDSHAPE_DEADZONE = 0.02;
const LIVE_CALIBRATION_SAMPLE_FRAMES = 12;
const LIVE_MIN_SOLVE_QUALITY = 0.28;

// Reusable THREE objects to avoid GC pressure in useFrame
const _rootTargetPos = new THREE.Vector3();
const _fallbackA = new THREE.Vector3();
const _fallbackB = new THREE.Vector3();
const _robotStart = new THREE.Vector3();
const _robotEnd = new THREE.Vector3();
const _robotMid = new THREE.Vector3();
const _robotDir = new THREE.Vector3();
const _robotUp = new THREE.Vector3(0, 1, 0);
const _robotQuat = new THREE.Quaternion();
const _overlayTargetPosition = new THREE.Vector3();
const _overlayTargetScale = new THREE.Vector3(1, 1, 1);
const _overlayWorldOrigin = new THREE.Vector3(0, 0, 0);
const _retargetBoneWorld = new THREE.Vector3();
const _retargetChildWorld = new THREE.Vector3();
const _retargetParentWorldQuat = new THREE.Quaternion();
const _retargetParentInverse = new THREE.Quaternion();
const _retargetTargetParentDir = new THREE.Vector3();
const _retargetDeltaQ = new THREE.Quaternion();
const _retargetTargetQ = new THREE.Quaternion();

const GRID_SIZE = 10;
const GRID_STEP = 0.5;
const ROBOT_SCENE_SCALE = 0.018;
const ROBOT_BASE_Y = 0.9;
const AVATAR_SCREEN_ALIGN_MIN_CONFIDENCE = 0.1;
const AVATAR_SCREEN_ALIGN_LERP = 22;
const AVATAR_SCREEN_HEIGHT_MULTIPLIER = 1.05;
const AVATAR_SCREEN_MIN_HEIGHT = 0.24;
const AVATAR_SCREEN_MAX_HEIGHT = 0.92;

const ROBOT_BONES = RIG.filter(
  (node): node is typeof node & { parent: JointName } => Boolean(node.parent),
);

type LiveAvatarViewerProps = {
  modelUrl?: string;
  frame?: PoseFrame;
};

type RobotAvatarSource = "local" | "remote" | "procedural";

type HumanoidRetargetProfile = Readonly<{
  id: string;
  source: RobotAvatarSource;
  boneAliases: Readonly<Record<JointName, readonly string[]>>;
  heightMeters: number;
  yOffset: number;
  rootTranslationScale: number;
  preserveAssetRootMotion: boolean;
}>;

const LOCAL_ROBOT_ASSET = LOW_POLY_HUMANOID_ROBOT_GLB;

const LOW_POLY_HUMANOID_ROBOT_PROFILE: HumanoidRetargetProfile = {
  id: "fab-low-poly-humanoid-robot",
  source: "local",
  heightMeters: 1.72,
  yOffset: 0,
  rootTranslationScale: 0.01,
  preserveAssetRootMotion: false,
  boneAliases: {
    Hips: ["lpBip Pelvis", "pelvis", "hips"],
    Spine: ["lpBip Spine", "spine"],
    Chest: ["lpBip Spine1", "chest", "spine1", "spine_01"],
    Neck: ["lpBip Neck", "neck"],
    Head: ["lpBip Head", "head"],
    LeftShoulder: ["lpBip L Clavicle", "leftshoulder", "left clavicle", "l clavicle"],
    LeftUpperArm: ["lpBip L UpperArm", "leftupperarm", "l upperarm"],
    LeftLowerArm: ["lpBip L Forearm", "leftlowerarm", "leftforearm", "l forearm"],
    LeftHand: ["lpBip L Hand", "lefthand", "l hand"],
    RightShoulder: ["lpBip R Clavicle", "rightshoulder", "right clavicle", "r clavicle"],
    RightUpperArm: ["lpBip R UpperArm", "rightupperarm", "r upperarm"],
    RightLowerArm: ["lpBip R Forearm", "rightlowerarm", "rightforearm", "r forearm"],
    RightHand: ["lpBip R Hand", "righthand", "r hand"],
    LeftUpperLeg: ["lpBip L Thigh", "leftupperleg", "leftthigh", "l thigh"],
    LeftLowerLeg: ["lpBip L Calf", "leftlowerleg", "leftcalf", "l calf"],
    LeftFoot: ["lpBip L Foot", "leftfoot", "l foot"],
    LeftToes: ["lpBip L Toe0", "lefttoes", "lefttoe", "l toe0"],
    RightUpperLeg: ["lpBip R Thigh", "rightupperleg", "rightthigh", "r thigh"],
    RightLowerLeg: ["lpBip R Calf", "rightlowerleg", "rightcalf", "r calf"],
    RightFoot: ["lpBip R Foot", "rightfoot", "r foot"],
    RightToes: ["lpBip R Toe0", "righttoes", "righttoe", "r toe0"],
  },
};

const FALLBACK_POSE_CONNECTIONS: Array<[number, number]> = [
  [0, 11],
  [0, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 32],
];

const FALLBACK_REST_POINTS: Record<number, [number, number, number]> = {
  0: [0, 1.75, 0],
  11: [-0.35, 1.35, 0],
  12: [0.35, 1.35, 0],
  13: [-0.65, 0.95, 0],
  14: [0.65, 0.95, 0],
  15: [-0.85, 0.55, 0],
  16: [0.85, 0.55, 0],
  23: [-0.25, 0.55, 0],
  24: [0.25, 0.55, 0],
  25: [-0.28, 0.0, 0],
  26: [0.28, 0.0, 0],
  27: [-0.28, -0.55, 0],
  28: [0.28, -0.55, 0],
  31: [-0.35, -0.62, 0.12],
  32: [0.35, -0.62, 0.12],
};

const ROBOT_NEUTRAL_POINTS: Record<JointName, [number, number, number]> = {
  Hips: [0, 0.9, 0],
  Spine: [0, 1.1, 0],
  Chest: [0, 1.32, 0],
  Neck: [0, 1.5, 0],
  Head: [0, 1.72, 0],
  LeftShoulder: [-0.28, 1.38, 0],
  LeftUpperArm: [-0.54, 1.22, 0],
  LeftLowerArm: [-0.72, 0.92, 0],
  LeftHand: [-0.84, 0.62, 0],
  RightShoulder: [0.28, 1.38, 0],
  RightUpperArm: [0.54, 1.22, 0],
  RightLowerArm: [0.72, 0.92, 0],
  RightHand: [0.84, 0.62, 0],
  LeftUpperLeg: [-0.18, 0.72, 0],
  LeftLowerLeg: [-0.22, 0.34, 0.02],
  LeftFoot: [-0.22, 0.04, 0.04],
  LeftToes: [-0.22, 0.0, 0.2],
  RightUpperLeg: [0.18, 0.72, 0],
  RightLowerLeg: [0.22, 0.34, 0.02],
  RightFoot: [0.22, 0.04, 0.04],
  RightToes: [0.22, 0.0, 0.2],
};

// ────────────────────────────────────────────────────────────────────────────
// AvatarModel — Internal component that drives the 3D character
// ────────────────────────────────────────────────────────────────────────────

type AvatarModelProps = {
  scene: THREE.Group;
  frame?: PoseFrame;
  profile: HumanoidRetargetProfile;
};

type GLTF = {
  scene: THREE.Group;
};

type DirectionBinding = Readonly<{
  joint: JointName;
  child: JointName;
  bone: THREE.Bone;
  restDirectionParent: THREE.Vector3;
  initialLocalQuaternion: THREE.Quaternion;
}>;

type ScreenAnchor = Readonly<{
  centerX: number;
  topY: number;
  bottomY: number;
  height: number;
}>;

function normalizeBoneName(name: string) {
  return name
    .toLowerCase()
    .replace(/^mixamorig[:.\s_-]?/i, "")
    .replace(/^armature[:.\s_-]?/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function boneMatchesJoint(
  boneName: string,
  joint: JointName,
  profile: HumanoidRetargetProfile,
) {
  const normalized = normalizeBoneName(boneName);
  const aliases = profile.boneAliases[joint] ?? [];
  return aliases.some((alias) => normalized === normalizeBoneName(alias));
}

function collectAvatarBindings(scene: THREE.Group, profile: HumanoidRetargetProfile) {
  const bMap = new Map<string, THREE.Bone>();
  const sMeshes: THREE.SkinnedMesh[] = [];
  const unmatchedBones: string[] = [];

  scene.traverse((obj) => {
    if (obj.type === "Bone") {
      const bone = obj as THREE.Bone;
      let matched = false;

      for (const joint of JOINT_NAMES) {
        if (boneMatchesJoint(bone.name, joint, profile)) {
          bMap.set(joint, bone);
          matched = true;
          break;
        }
      }

      if (!matched) {
        unmatchedBones.push(bone.name);
      }
    } else if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const mesh = obj as THREE.SkinnedMesh;
      mesh.frustumCulled = false;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        sMeshes.push(mesh);
      }
    }
  });

  if (__DEV__) {
    const missing = JOINT_NAMES.filter((joint) => !bMap.has(joint));
    if (missing.length) {
      console.warn("[LiveAvatarViewer] missing avatar bones", {
        profile: profile.id,
        missing,
        unmatchedBones,
      });
    }
  }

  return { boneMap: bMap, skinnedMeshes: sMeshes };
}

const RETARGET_CHILD_PRIORITY: Partial<Record<JointName, readonly JointName[]>> = {
  Hips: ["Spine", "LeftUpperLeg", "RightUpperLeg"],
  Spine: ["Chest"],
  Chest: ["Neck", "LeftShoulder", "RightShoulder"],
  Neck: ["Head"],
  LeftShoulder: ["LeftUpperArm"],
  LeftUpperArm: ["LeftLowerArm"],
  LeftLowerArm: ["LeftHand"],
  RightShoulder: ["RightUpperArm"],
  RightUpperArm: ["RightLowerArm"],
  RightLowerArm: ["RightHand"],
  LeftUpperLeg: ["LeftLowerLeg"],
  LeftLowerLeg: ["LeftFoot"],
  LeftFoot: ["LeftToes"],
  RightUpperLeg: ["RightLowerLeg"],
  RightLowerLeg: ["RightFoot"],
  RightFoot: ["RightToes"],
};

function retargetChildForJoint(
  joint: JointName,
  boneMap: Map<string, THREE.Bone>,
): JointName | null {
  const priorities = RETARGET_CHILD_PRIORITY[joint] ?? childrenOf(joint);
  for (const child of priorities) {
    if (boneMap.has(child)) {
      return child;
    }
  }
  return null;
}

function buildDirectionBindings(boneMap: Map<string, THREE.Bone>): DirectionBinding[] {
  const bindings: DirectionBinding[] = [];

  for (const joint of JOINT_NAMES) {
    const bone = boneMap.get(joint);
    const child = retargetChildForJoint(joint, boneMap);
    const childBone = child ? boneMap.get(child) : undefined;

    if (!bone || !child || !childBone) {
      continue;
    }

    bone.updateWorldMatrix(true, false);
    childBone.updateWorldMatrix(true, false);
    bone.getWorldPosition(_retargetBoneWorld);
    childBone.getWorldPosition(_retargetChildWorld);

    const restDirectionParent = _retargetChildWorld.sub(_retargetBoneWorld);
    if (restDirectionParent.lengthSq() < 1e-8) {
      continue;
    }

    bone.parent?.getWorldQuaternion(_retargetParentWorldQuat);
    _retargetParentInverse.copy(_retargetParentWorldQuat).invert();
    restDirectionParent.applyQuaternion(_retargetParentInverse).normalize();

    bindings.push({
      joint,
      child,
      bone,
      restDirectionParent: restDirectionParent.clone(),
      initialLocalQuaternion: bone.quaternion.clone(),
    });
  }

  return bindings;
}

function prepareAvatarScene(scene: THREE.Group, profile: HumanoidRetargetProfile) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const material = mesh.material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of materials) {
      const mat = item as THREE.MeshStandardMaterial;
      if ("roughness" in mat) mat.roughness = Math.max(mat.roughness ?? 0.35, 0.42);
      if ("metalness" in mat) mat.metalness = Math.min(Math.max(mat.metalness ?? 0.12, 0.08), 0.7);
      mat.needsUpdate = true;
    }
  });

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  if (Number.isFinite(size.y) && size.y > 1e-4) {
    const scale = profile.heightMeters / size.y;
    scene.scale.setScalar(scale);
    scene.position.set(-center.x * scale, -box.min.y * scale + profile.yOffset, -center.z * scale);
  }
}

function AvatarModel({ scene, frame, profile }: AvatarModelProps) {
  // ── Phase 1: Parse the GLTF scene once ──
  const { boneMap, skinnedMeshes } = useMemo(
    () => collectAvatarBindings(scene, profile),
    [profile, scene],
  );

  // ── Cache: original bone quaternions ──
  const directionBindings = useMemo(() => buildDirectionBindings(boneMap), [boneMap]);

  // ── Phase 1 (Face): Pre-computed blendshape index caches per mesh ──
  const blendshapeCaches = useMemo(() => {
    return skinnedMeshes.map((mesh) => {
      if (!mesh.morphTargetDictionary) return new Map<string, number>();
      return buildBlendshapeIndexCache(mesh.morphTargetDictionary);
    });
  }, [skinnedMeshes]);

  const calibrationRef = useRef<AvatarMotionCalibration | null>(null);
  const calibrationSamplesRef = useRef<PoseFrame[]>([]);

  // ── Main render loop: IK solve + Face morphing ──
  useFrame((_state, delta) => {
    const lastFrame = frame ?? useCaptureStore.getState().lastFrame;
    if (!lastFrame) return;

    if (!calibrationRef.current) {
      const samples = calibrationSamplesRef.current;
      if (samples[samples.length - 1]?.ts !== lastFrame.ts) {
        samples.push(lastFrame);
      }

      if (samples.length < LIVE_CALIBRATION_SAMPLE_FRAMES) {
        return;
      }

      try {
        calibrationRef.current = createAvatarMotionCalibration(samples, {
          calibrationFrames: LIVE_CALIBRATION_SAMPLE_FRAMES,
          preserveRootMotion: "auto",
          scaleMultiplier: profile.rootTranslationScale,
          targetPose: "t-pose",
        });
      } catch (error) {
        if (__DEV__) {
          console.warn("[LiveAvatarViewer] avatar calibration failed", error);
        }
        samples.splice(0, Math.max(0, samples.length - LIVE_CALIBRATION_SAMPLE_FRAMES + 1));
        return;
      }
    }

    const solved = solveAvatarMotionFrame(lastFrame, calibrationRef.current);
    if (solved.poseQuality < LIVE_MIN_SOLVE_QUALITY) {
      return;
    }

    // Apply direction-based retargeting. This avoids pushing solver-space twist
    // directly into arbitrary GLB bone local axes, which is what causes inverted
    // wrists/feet on non-standard humanoid assets.
    const slerpFactor = Math.min(1, 15 * delta);
    for (const binding of directionBindings) {
      const from = solved.pose[binding.joint];
      const to = solved.pose[binding.child];
      _retargetTargetParentDir.set(to.x - from.x, to.y - from.y, to.z - from.z);

      if (_retargetTargetParentDir.lengthSq() < 1e-8) {
        continue;
      }

      binding.bone.parent?.getWorldQuaternion(_retargetParentWorldQuat);
      _retargetParentInverse.copy(_retargetParentWorldQuat).invert();
      _retargetTargetParentDir.normalize().applyQuaternion(_retargetParentInverse).normalize();

      _retargetDeltaQ.setFromUnitVectors(
        binding.restDirectionParent,
        _retargetTargetParentDir,
      );
      _retargetTargetQ.copy(_retargetDeltaQ).multiply(binding.initialLocalQuaternion);
      binding.bone.quaternion.slerp(_retargetTargetQ, slerpFactor);
    }

    // Root translation uses the same calibrated root solve as export.
    const rootBone = boneMap.get(RIG_ROOT);
    if (rootBone) {
      _rootTargetPos.set(
        solved.rootTranslation.x,
        solved.rootTranslation.y,
        solved.rootTranslation.z,
      );
      if (profile.preserveAssetRootMotion) {
        rootBone.position.lerp(_rootTargetPos, Math.min(1, 10 * delta));
      }
    }

    // ── AŞAMA 1: Face Blendshapes (Production-Ready) ──
    if (lastFrame.faceBlendshapes && skinnedMeshes.length > 0) {
      for (const bs of lastFrame.faceBlendshapes) {
        const name = bs.name;
        // Clamp + deadzone
        const score =
          Math.abs(bs.score) < BLENDSHAPE_DEADZONE
            ? 0
            : Math.max(0, Math.min(1, bs.score));

        const lerpF = blendshapeLerpFactor(name, delta);

        for (let mi = 0; mi < skinnedMeshes.length; mi++) {
          const mesh = skinnedMeshes[mi];
          const cache = blendshapeCaches[mi];
          const influences = mesh.morphTargetInfluences;
          if (!influences || !cache) continue;

          const idx = cache.get(name);
          if (idx === undefined) continue;

          // Smooth lerp with adaptive speed
          influences[idx] += (score - influences[idx]) * lerpF;
        }
      }
    }
  });

  return <primitive object={scene} />;
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();

    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

function RemoteAvatarModel({
  uri,
  frame,
  profile,
}: {
  uri: string;
  frame?: PoseFrame;
  profile: HumanoidRetargetProfile;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [failed, setFailed] = useState(false);
  const loadedScene = useRef<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { GLTFLoader } = require("three-stdlib") as typeof import("three-stdlib");
    const loader = new GLTFLoader();

    setScene(null);
    setFailed(false);

    loader.load(
      uri,
      (gltf: GLTF) => {
        if (cancelled) {
          disposeObject3D(gltf.scene);
          return;
        }

        if (loadedScene.current) {
          disposeObject3D(loadedScene.current);
        }

        prepareAvatarScene(gltf.scene, profile);
        loadedScene.current = gltf.scene;
        setScene(gltf.scene);
      },
      undefined,
      (error: unknown) => {
        if (cancelled) return;
        setFailed(true);
        if (__DEV__) {
          console.warn("[LiveAvatarViewer] avatar asset failed; using pose fallback", error);
        }
      },
    );

    return () => {
      cancelled = true;
      if (loadedScene.current) {
        disposeObject3D(loadedScene.current);
        loadedScene.current = null;
      }
    };
  }, [uri]);

  if (failed || !scene) {
    return <ProceduralRobotAvatar frame={frame} />;
  }

  return <AvatarModel scene={scene} frame={frame} profile={profile} />;
}

function LocalRobotAvatarModel({ frame }: { frame?: PoseFrame }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAsset() {
      try {
        setFailed(false);
        const asset = Asset.fromModule(LOCAL_ROBOT_ASSET);
        await asset.downloadAsync();
        if (cancelled) return;

        const resolvedUri = asset.localUri ?? asset.uri;
        if (!resolvedUri) {
          throw new Error("Local robot asset URI could not be resolved.");
        }
        setUri(resolvedUri);
      } catch (error) {
        if (cancelled) return;
        setFailed(true);
        if (__DEV__) {
          console.warn("[LiveAvatarViewer] local robot asset failed; using procedural fallback", error);
        }
      }
    }

    void loadAsset();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !uri) {
    return <ProceduralRobotAvatar frame={frame} />;
  }

  return (
    <RemoteAvatarModel
      uri={uri}
      frame={frame}
      profile={LOW_POLY_HUMANOID_ROBOT_PROFILE}
    />
  );
}

function writeFallbackPoint(
  landmarks: LandmarkBuffer | undefined,
  index: number,
  target: THREE.Vector3,
) {
  const landmark = landmarks && index * 4 + 3 < landmarks.length ? lmAt(landmarks, index) : undefined;
  if (!landmark || landmark.c <= 0) {
    const rest = FALLBACK_REST_POINTS[index] ?? [0, 0, 0];
    target.set(rest[0], rest[1], rest[2]);
    return;
  }

  target.set(
    (landmark.x - 0.5) * 2,
    (0.5 - landmark.y) * 2.2 + 0.55,
    -(landmark.z ?? 0) * 0.65,
  );
}

function PoseFallbackAvatar({ frame }: { frame?: PoseFrame }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(FALLBACK_POSE_CONNECTIONS.length * 2 * 3);
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return bufferGeometry;
  }, []);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  useFrame(() => {
    const lastFrame = frame ?? useCaptureStore.getState().lastFrame;
    const landmarks = lastFrame?.landmarks;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = position.array as Float32Array;

    for (let i = 0; i < FALLBACK_POSE_CONNECTIONS.length; i++) {
      const [from, to] = FALLBACK_POSE_CONNECTIONS[i];
      writeFallbackPoint(landmarks, from, _fallbackA);
      writeFallbackPoint(landmarks, to, _fallbackB);

      const offset = i * 6;
      array[offset] = _fallbackA.x;
      array[offset + 1] = _fallbackA.y;
      array[offset + 2] = _fallbackA.z;
      array[offset + 3] = _fallbackB.x;
      array[offset + 4] = _fallbackB.y;
      array[offset + 5] = _fallbackB.z;
    }

    position.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  return (
    <group>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#7dd3fc" transparent opacity={0.95} />
      </lineSegments>
      <mesh position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#f8fafc" emissive="#155e75" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

function robotNeutralPoint(joint: JointName, target: THREE.Vector3) {
  const point = ROBOT_NEUTRAL_POINTS[joint];
  target.set(point[0], point[1], point[2]);
}

function robotJointRadius(joint: JointName) {
  if (joint === "Head") return 0.14;
  if (joint === "Chest" || joint === "Hips") return 0.11;
  if (joint.includes("Shoulder") || joint.includes("UpperLeg")) return 0.085;
  if (joint.includes("Foot") || joint.includes("Hand") || joint.includes("Toes")) return 0.07;
  return 0.065;
}

function robotBoneRadius(child: JointName) {
  if (child === "Spine" || child === "Chest" || child === "Neck") return 0.075;
  if (child.includes("UpperLeg") || child.includes("LowerLeg")) return 0.06;
  if (child.includes("UpperArm") || child.includes("LowerArm")) return 0.046;
  if (child.includes("Foot") || child.includes("Toes")) return 0.04;
  return 0.052;
}

function robotMaterialColor(joint: JointName) {
  if (joint.includes("Hand") || joint.includes("Foot") || joint.includes("Toes")) {
    return "#111827";
  }
  if (
    joint.includes("Shoulder") ||
    joint.includes("UpperArm") ||
    joint.includes("LowerArm") ||
    joint.includes("UpperLeg") ||
    joint.includes("LowerLeg")
  ) {
    return "#273449";
  }
  return "#9ca3af";
}

function setRobotPointFromPose(
  pose: AvatarMotionCalibration["restPose"] | null,
  joint: JointName,
  target: THREE.Vector3,
) {
  if (!pose) {
    robotNeutralPoint(joint, target);
    return;
  }

  const root = pose.Hips;
  const point = pose[joint];
  target.set(
    (point.x - root.x) * ROBOT_SCENE_SCALE,
    (point.y - root.y) * ROBOT_SCENE_SCALE + ROBOT_BASE_Y,
    (point.z - root.z) * ROBOT_SCENE_SCALE,
  );
}

function updateRobotBone(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
  _robotMid.copy(start).add(end).multiplyScalar(0.5);
  _robotDir.copy(end).sub(start);
  const length = _robotDir.length();
  if (length < 1e-4) {
    mesh.visible = false;
    return;
  }

  mesh.visible = true;
  _robotDir.multiplyScalar(1 / length);
  _robotQuat.setFromUnitVectors(_robotUp, _robotDir);
  mesh.position.copy(_robotMid);
  mesh.quaternion.copy(_robotQuat);
  mesh.scale.set(radius, length, radius);
}

function ProceduralRobotAvatar({ frame }: { frame?: PoseFrame }) {
  const boneRefs = useRef(new Map<string, THREE.Mesh>());
  const jointRefs = useRef(new Map<JointName, THREE.Mesh>());
  const calibrationRef = useRef<AvatarMotionCalibration | null>(null);
  const calibrationSamplesRef = useRef<PoseFrame[]>([]);
  const lastPoseRef = useRef<AvatarMotionCalibration["restPose"] | null>(null);

  useFrame((_state, delta) => {
    const lastFrame = frame ?? useCaptureStore.getState().lastFrame;

    if (lastFrame) {
      if (!calibrationRef.current) {
        const samples = calibrationSamplesRef.current;
        if (samples[samples.length - 1]?.ts !== lastFrame.ts) {
          samples.push(lastFrame);
        }

        if (samples.length >= LIVE_CALIBRATION_SAMPLE_FRAMES) {
          try {
            calibrationRef.current = createAvatarMotionCalibration(samples, {
              calibrationFrames: LIVE_CALIBRATION_SAMPLE_FRAMES,
              preserveRootMotion: "auto",
              scaleMultiplier: 0.01,
              targetPose: "t-pose",
            });
          } catch (error) {
            if (__DEV__) {
              console.warn("[LiveAvatarViewer] robot calibration failed", error);
            }
            samples.splice(0, Math.max(0, samples.length - LIVE_CALIBRATION_SAMPLE_FRAMES + 1));
          }
        }
      }

      if (calibrationRef.current) {
        const solved = solveAvatarMotionFrame(lastFrame, calibrationRef.current);
        if (solved.poseQuality >= LIVE_MIN_SOLVE_QUALITY) {
          lastPoseRef.current = solved.pose;
        }
      }
    }

    const pose = lastPoseRef.current ?? calibrationRef.current?.restPose ?? null;
    const lerpFactor = Math.min(1, 18 * delta);

    for (const joint of JOINT_NAMES) {
      const mesh = jointRefs.current.get(joint);
      if (!mesh) continue;

      setRobotPointFromPose(pose, joint, _robotStart);
      mesh.position.lerp(_robotStart, lerpFactor);
    }

    for (const bone of ROBOT_BONES) {
      const mesh = boneRefs.current.get(bone.name);
      if (!mesh) continue;

      setRobotPointFromPose(pose, bone.parent, _robotStart);
      setRobotPointFromPose(pose, bone.name, _robotEnd);
      updateRobotBone(mesh, _robotStart, _robotEnd, robotBoneRadius(bone.name));
    }
  });

  return (
    <group>
      {ROBOT_BONES.map((bone) => (
        <mesh
          key={`robot-bone-${bone.name}`}
          ref={(mesh) => {
            if (mesh) boneRefs.current.set(bone.name, mesh);
            else boneRefs.current.delete(bone.name);
          }}
        >
          <cylinderGeometry args={[1, 1, 1, 18]} />
          <meshStandardMaterial
            color={robotMaterialColor(bone.name)}
            roughness={0.44}
            metalness={0.28}
          />
        </mesh>
      ))}

      {JOINT_NAMES.map((joint) => (
        <mesh
          key={`robot-joint-${joint}`}
          ref={(mesh) => {
            if (mesh) jointRefs.current.set(joint, mesh);
            else jointRefs.current.delete(joint);
          }}
          scale={[robotJointRadius(joint), robotJointRadius(joint), robotJointRadius(joint)]}
        >
          <sphereGeometry args={[1, 18, 18]} />
          <meshStandardMaterial
            color={joint === "Head" || joint === "Chest" || joint === "Hips" ? "#cbd5e1" : "#f97316"}
            roughness={0.38}
            metalness={0.22}
          />
        </mesh>
      ))}
    </group>
  );
}

function GroundShadow() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
      <circleGeometry args={[1.15, 48]} />
      <meshBasicMaterial color="#020617" transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}

function StudioGrid() {
  const geometry = useMemo(() => {
    const lineCount = Math.floor(GRID_SIZE / GRID_STEP) * 2 + 2;
    const positions = new Float32Array(lineCount * 2 * 3);
    let cursor = 0;
    const half = GRID_SIZE / 2;

    for (let value = -half; value <= half + 0.0001; value += GRID_STEP) {
      positions[cursor++] = -half;
      positions[cursor++] = -0.04;
      positions[cursor++] = value;
      positions[cursor++] = half;
      positions[cursor++] = -0.04;
      positions[cursor++] = value;

      positions[cursor++] = value;
      positions[cursor++] = -0.04;
      positions[cursor++] = -half;
      positions[cursor++] = value;
      positions[cursor++] = -0.04;
      positions[cursor++] = half;
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return bufferGeometry;
  }, []);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#334155" transparent opacity={0.45} />
    </lineSegments>
  );
}

const HEAD_ALIGN_INDICES = [
  MP33.NOSE,
  MP33.LEFT_EYE,
  MP33.RIGHT_EYE,
  MP33.LEFT_EAR,
  MP33.RIGHT_EAR,
] as const;

const FOOT_ALIGN_INDICES = [
  MP33.LEFT_ANKLE,
  MP33.RIGHT_ANKLE,
  MP33.LEFT_HEEL,
  MP33.RIGHT_HEEL,
  MP33.LEFT_FOOT_INDEX,
  MP33.RIGHT_FOOT_INDEX,
] as const;

const CENTER_ALIGN_INDICES = [
  MP33.LEFT_SHOULDER,
  MP33.RIGHT_SHOULDER,
  MP33.LEFT_HIP,
  MP33.RIGHT_HIP,
] as const;

function visibleLandmark(frame: PoseFrame, index: number, minConfidence = AVATAR_SCREEN_ALIGN_MIN_CONFIDENCE) {
  const landmark = lmAt(frame.landmarks, index);
  if (!landmark || (landmark.c ?? 0) < minConfidence) {
    return null;
  }
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }
  return landmark;
}

function averageVisibleX(frame: PoseFrame, indices: readonly number[]) {
  let total = 0;
  let count = 0;

  for (const index of indices) {
    const landmark = visibleLandmark(frame, index);
    if (!landmark) continue;
    total += landmark.x;
    count += 1;
  }

  return count > 0 ? total / count : null;
}

function screenAnchorFromPose(frame?: PoseFrame): ScreenAnchor | null {
  if (!frame) {
    return null;
  }

  const headYs: number[] = [];
  for (const index of HEAD_ALIGN_INDICES) {
    const landmark = visibleLandmark(frame, index);
    if (landmark) headYs.push(landmark.y);
  }

  const footYs: number[] = [];
  for (const index of FOOT_ALIGN_INDICES) {
    const landmark = visibleLandmark(frame, index);
    if (landmark) footYs.push(landmark.y);
  }

  if (headYs.length === 0 || footYs.length === 0) {
    return null;
  }

  const headY = Math.min(...headYs);
  const footY = Math.max(...footYs);
  const rawHeight = footY - headY;
  if (rawHeight < 0.12) {
    return null;
  }

  const centerX =
    averageVisibleX(frame, CENTER_ALIGN_INDICES) ??
    averageVisibleX(frame, [...HEAD_ALIGN_INDICES, ...FOOT_ALIGN_INDICES]);

  if (centerX === null) {
    return null;
  }

  const headPadding = Math.min(0.045, rawHeight * 0.08);
  const footPadding = Math.min(0.025, rawHeight * 0.04);
  const topY = Math.max(0, headY - headPadding);
  const bottomY = Math.min(1, footY + footPadding);
  const height = Math.max(
    AVATAR_SCREEN_MIN_HEIGHT,
    Math.min(AVATAR_SCREEN_MAX_HEIGHT, bottomY - topY),
  );

  return {
    centerX,
    topY,
    bottomY,
    height,
  };
}

function ScreenAlignedAvatarGroup({
  frame,
  children,
}: {
  frame?: PoseFrame;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ camera, viewport }, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const lastFrame = frame ?? useCaptureStore.getState().lastFrame;
    const anchor = screenAnchorFromPose(lastFrame);
    if (!anchor) return;

    const view = viewport.getCurrentViewport(camera, _overlayWorldOrigin);
    const bottomWorldY = camera.position.y + (0.5 - anchor.bottomY) * view.height;
    const centerWorldX = camera.position.x + (anchor.centerX - 0.5) * view.width;
    const targetHeightWorld = anchor.height * view.height * AVATAR_SCREEN_HEIGHT_MULTIPLIER;
    const targetScale = Math.max(0.01, targetHeightWorld / LOW_POLY_HUMANOID_ROBOT_PROFILE.heightMeters);
    const lerp = Math.min(1, AVATAR_SCREEN_ALIGN_LERP * delta);

    _overlayTargetPosition.set(centerWorldX, bottomWorldY, 0);
    _overlayTargetScale.set(targetScale, targetScale, targetScale);
    group.position.lerp(_overlayTargetPosition, lerp);
    group.scale.lerp(_overlayTargetScale, lerp);
  });

  return <group ref={groupRef}>{children}</group>;
}

// ────────────────────────────────────────────────────────────────────────────
// ToneMapper — AŞAMA 3: ACES Filmic tone mapping for cinematic colors
// ────────────────────────────────────────────────────────────────────────────

function ToneMapper() {
  const { gl } = useThree();

  useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.15;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl]);

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// LiveAvatarViewer — Public component
// ────────────────────────────────────────────────────────────────────────────

export function LiveAvatarViewer({ modelUrl, frame }: LiveAvatarViewerProps) {
  const uri = modelUrl?.trim() ? modelUrl.trim() : undefined;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas
        camera={{ position: [0, 1.2, CAMERA_DISTANCE], fov: 50 }}
        gl={{ alpha: true, antialias: true }}  /* AŞAMA 3: Transparent background for AR effect */
        style={{ backgroundColor: "transparent" }}
      >
        {/* AŞAMA 3: ACES Filmic Tone Mapping */}
        <ToneMapper />

        {/* AŞAMA 3: Professional 3-Point Lighting */}
        {/* Key Light — Main illumination from upper-right */}
        <directionalLight
          position={[3, 6, 4]}
          intensity={1.8}
          castShadow
          color="#FFF8F0"
        />
        {/* Fill Light — Soft colored light from lower-left to reduce harsh shadows */}
        <pointLight
          position={[-3, 1.5, -1]}
          intensity={0.6}
          color="#7DB8FF"
          decay={2}
        />
        {/* Rim / Back Light — Edge highlight to separate character from background */}
        <spotLight
          position={[-1, 4, -4]}
          intensity={1.2}
          angle={0.5}
          penumbra={0.8}
          color="#C8B8FF"
        />
        {/* Ambient fill so nothing is pitch black */}
        <ambientLight intensity={0.35} />

        <ScreenAlignedAvatarGroup frame={frame}>
          {/* The 3D Character */}
          {uri ? (
            <RemoteAvatarModel
              uri={uri}
              frame={frame}
              profile={LOW_POLY_HUMANOID_ROBOT_PROFILE}
            />
          ) : (
            <LocalRobotAvatarModel frame={frame} />
          )}

          <GroundShadow />
        </ScreenAlignedAvatarGroup>
        <StudioGrid />
      </Canvas>
    </View>
  );
}
