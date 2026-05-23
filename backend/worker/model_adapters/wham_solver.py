#!/usr/bin/env python3
"""WHAM/SMPL premium motion adapter for MocapExpo.

The Node worker calls this script through WHAM_SOLVER_SCRIPT. The script loads
an external WHAM checkout via WHAM_REPO_DIR or --wham-repo, runs the official
WHAM demo pipeline on the primary normalized video, and converts SMPL pose
output into the mocap.solved_motion.v1 frame contract consumed by the backend
exporter.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any


SKELETON_JOINTS = [
    "Hips",
    "Spine",
    "Chest",
    "Neck",
    "Head",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
]

SMPL_TO_MOCAP = {
    "Hips": 0,
    "Spine": 3,
    "Chest": 9,
    "Neck": 12,
    "Head": 15,
    "LeftShoulder": 13,
    "LeftArm": 16,
    "LeftForeArm": 18,
    "LeftHand": 20,
    "RightShoulder": 14,
    "RightArm": 17,
    "RightForeArm": 19,
    "RightHand": 21,
    "LeftUpLeg": 1,
    "LeftLeg": 4,
    "LeftFoot": 7,
    "RightUpLeg": 2,
    "RightLeg": 5,
    "RightFoot": 8,
}


def fail(message: str, code: int = 2) -> None:
    sys.stderr.write(message + "\n")
    raise SystemExit(code)


def install_numpy_legacy_aliases() -> None:
    """Restore NumPy aliases still used by older WHAM/MMCV dependencies."""
    try:
        import numpy as np
    except Exception:
        return

    aliases = {
        "bool": bool,
        "complex": complex,
        "float": float,
        "int": int,
        "object": object,
        "str": str,
    }
    for name, value in aliases.items():
        if name not in np.__dict__:
            setattr(np, name, value)


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        item = float(value)
    except (TypeError, ValueError):
        return fallback
    if item != item or item in (float("inf"), float("-inf")):
        return fallback
    return item


def axis_angle_to_matrix(vector: list[float]) -> list[list[float]]:
    x, y, z = (finite(vector[0]), finite(vector[1]), finite(vector[2]))
    theta = math.sqrt(x * x + y * y + z * z)
    if theta < 1e-8:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    x /= theta
    y /= theta
    z /= theta
    c = math.cos(theta)
    s = math.sin(theta)
    t = 1.0 - c
    return [
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ]


def matrix_to_euler_xyz(matrix: Any) -> list[float]:
    r00 = finite(matrix[0][0])
    r10 = finite(matrix[1][0])
    r20 = finite(matrix[2][0])
    r21 = finite(matrix[2][1])
    r22 = finite(matrix[2][2])
    r01 = finite(matrix[0][1])
    r11 = finite(matrix[1][1])
    sy = math.sqrt(r00 * r00 + r10 * r10)
    singular = sy < 1e-6
    if not singular:
        x = math.atan2(r21, r22)
        y = math.atan2(-r20, sy)
        z = math.atan2(r10, r00)
    else:
        x = math.atan2(-finite(matrix[1][2]), r11)
        y = math.atan2(-r20, sy)
        z = math.atan2(-r01, r00)
    return [math.degrees(x), math.degrees(y), math.degrees(z)]


def rotation_to_euler(value: Any) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, (list, tuple)) and len(value) == 3:
        if all(isinstance(row, (list, tuple)) for row in value):
            return matrix_to_euler_xyz(value)
        return matrix_to_euler_xyz(axis_angle_to_matrix(list(value)))
    if isinstance(value, (list, tuple)) and len(value) == 9:
        return matrix_to_euler_xyz([value[0:3], value[3:6], value[6:9]])
    return [0.0, 0.0, 0.0]


def coerce_array(value: Any) -> Any:
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    if hasattr(value, "cpu"):
        value = value.cpu().numpy()
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def sanitize_numeric(value: Any) -> Any:
    value = coerce_array(value)
    if isinstance(value, dict):
        return {str(key): sanitize_numeric(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_numeric(item) for item in value]
    if isinstance(value, (int, float)):
        return finite(value)
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    return None


def sanitize_array(value: Any) -> list[Any]:
    normalized = sanitize_numeric(value)
    return normalized if isinstance(normalized, list) else []


def first_present(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def read_pose_metadata(path: str | None) -> dict[str, Any]:
    if not path:
        return {
            "fps": 30.0,
            "durationMs": 0.0,
            "frameCount": 0,
        }
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    source = payload.get("sourceVideo") or {}
    return {
        "fps": finite(source.get("fps"), 30.0) or 30.0,
        "durationMs": finite(source.get("durationMs"), 0.0),
        "frameCount": len(payload.get("frames") or []),
    }


def video_metadata(path: str | None, fallback_fps: float) -> dict[str, float]:
    if not path:
        return {
            "fps": fallback_fps,
            "durationMs": 0.0,
            "frameCount": 0.0,
        }
    try:
        import cv2

        cap = cv2.VideoCapture(path)
        fps = finite(cap.get(cv2.CAP_PROP_FPS), fallback_fps) or fallback_fps
        frame_count = finite(cap.get(cv2.CAP_PROP_FRAME_COUNT), 0.0)
        cap.release()
        duration_ms = (frame_count / max(fps, 1.0)) * 1000.0 if frame_count > 0 else 0.0
        return {
            "fps": fps,
            "durationMs": duration_ms,
            "frameCount": frame_count,
        }
    except Exception:
        return {
            "fps": fallback_fps,
            "durationMs": 0.0,
            "frameCount": 0.0,
        }


def choose_subject(results: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(results, dict) or not results:
        fail("WHAM returned no tracked subjects.")
    best_id = None
    best_payload = None
    best_length = -1
    for subject_id, payload in results.items():
        raw_frames = first_present(payload, "frame_ids", "frame_id")
        frames = raw_frames if raw_frames is not None else []
        length = len(coerce_array(frames))
        if length > best_length:
            best_id = str(subject_id)
            best_payload = payload
            best_length = length
    if best_payload is None:
        fail("WHAM returned subjects without frame ids.")
    return best_id or "0", best_payload


def extract_rotations(subject: dict[str, Any]) -> list[list[Any]]:
    pose_world = coerce_array(subject.get("pose_world"))
    pose = coerce_array(subject.get("pose"))
    if isinstance(pose_world, list) and pose_world:
        return [
            [frame[index : index + 3] for index in range(0, min(len(frame), 72), 3)]
            for frame in pose_world
        ]
    if isinstance(pose, list) and pose:
        return [
            [frame[index : index + 3] for index in range(0, min(len(frame), 72), 3)]
            for frame in pose
        ]

    root = coerce_array(first_present(subject, "poses_root_world", "poses_root_cam"))
    body = coerce_array(subject.get("poses_body"))
    if not isinstance(root, list) or not isinstance(body, list):
        fail("WHAM output does not contain pose_world, pose, or poses_body rotations.")

    frames = []
    for index, body_frame in enumerate(body):
        root_frame = root[index] if index < len(root) else [0.0, 0.0, 0.0]
        body_items = list(body_frame)
        frames.append([root_frame, *body_items])
    return frames


def extract_translations(subject: dict[str, Any], length: int, scale: float) -> list[list[float]]:
    source = coerce_array(first_present(subject, "trans_world", "trans"))
    translations: list[list[float]] = []
    if isinstance(source, list):
        for item in source[:length]:
            vector = coerce_array(item)
            translations.append(
                [
                    finite(vector[0]) * scale if len(vector) > 0 else 0.0,
                    finite(vector[1]) * scale if len(vector) > 1 else 0.0,
                    finite(vector[2]) * scale if len(vector) > 2 else 0.0,
                ]
            )
    while len(translations) < length:
        translations.append([0.0, 0.0, 0.0])
    return translations


def count_vertices(vertices: list[Any]) -> int:
    if not vertices:
        return 0
    first = vertices[0]
    if isinstance(first, list) and first and isinstance(first[0], list):
        return len(first)
    return len(vertices)


def build_mesh_payload(subject: dict[str, Any]) -> dict[str, Any] | None:
    vertices = sanitize_array(first_present(subject, "verts_world", "vertices_world", "verts", "vertices"))
    faces = sanitize_array(first_present(subject, "faces", "smpl_faces"))
    if not vertices and not faces:
        return None
    payload: dict[str, Any] = {}
    if vertices:
        payload["vertexCount"] = count_vertices(vertices)
    if faces:
        payload["faceCount"] = len(faces)
    return payload


def build_smpl_parameters(
    subject: dict[str, Any],
    fps: float,
    root_scale: float,
    frames: list[dict[str, Any]],
) -> dict[str, Any]:
    rotations = extract_rotations(subject)
    frame_count = len(frames)
    translations = extract_translations(subject, frame_count, root_scale)
    body_pose = []
    global_orient = []
    for rotation_frame in rotations[:frame_count]:
        global_orient.append(sanitize_array(rotation_frame[0] if rotation_frame else [0.0, 0.0, 0.0]))
        body_pose.append([sanitize_array(item) for item in rotation_frame[1:24]])

    joints3d = sanitize_array(
        first_present(subject, "joints_world", "joints3d", "joints", "kp3d", "keypoints3d")
    )
    betas = sanitize_array(first_present(subject, "betas", "shape", "smpl_betas"))
    if betas and isinstance(betas[0], list):
        betas = betas[0]
    camera = sanitize_numeric(
        first_present(subject, "camera", "cam", "pred_cam", "cam_t", "intrinsics", "cam_intrinsics")
    )
    mesh = build_mesh_payload(subject)
    smplify_payload = sanitize_numeric(subject.get("smplify"))
    smplify_enabled = isinstance(smplify_payload, dict) and smplify_payload.get("enabled") is True

    return {
        "schema": "mocap.smpl_parameters.v1",
        "source": "wham",
        "model": {
            "family": "SMPL",
        },
        "fps": fps,
        "frameCount": frame_count,
        "bodyPose": body_pose,
        "globalOrient": global_orient,
        "betas": betas,
        "translation": translations,
        "camera": camera if isinstance(camera, dict) else None,
        "joints3d": joints3d if joints3d else None,
        "mesh": mesh,
        "smplify": {
            "enabled": smplify_enabled,
            "status": (
                smplify_payload.get("status")
                if isinstance(smplify_payload, dict) and smplify_payload.get("status")
                else "not_run"
            ),
            "iterations": (
                smplify_payload.get("iterations")
                if isinstance(smplify_payload, dict) and smplify_payload.get("iterations") is not None
                else None
            ),
            "finalLoss": (
                smplify_payload.get("finalLoss")
                if isinstance(smplify_payload, dict) and smplify_payload.get("finalLoss") is not None
                else None
            ),
            "reason": None if smplify_enabled else "SMPLify was not enabled by the WHAM adapter runtime.",
        },
        "frames": [
            {
                "frameIndex": frame["frameIndex"],
                "timestampMs": frame["timestampMs"],
                "bodyPose": body_pose[index] if index < len(body_pose) else [],
                "globalOrient": global_orient[index] if index < len(global_orient) else [],
                "translation": translations[index] if index < len(translations) else frame["rootTranslation"],
                "joints3d": joints3d[index] if isinstance(joints3d, list) and index < len(joints3d) else None,
                "camera": camera if isinstance(camera, dict) else None,
            }
            for index, frame in enumerate(frames)
        ],
    }


def build_frames(
    subject: dict[str, Any],
    fps: float,
    root_scale: float,
) -> list[dict[str, Any]]:
    rotations = extract_rotations(subject)
    raw_frame_ids = first_present(subject, "frame_ids", "frame_id")
    frame_ids = coerce_array(raw_frame_ids if raw_frame_ids is not None else [])
    frame_count = len(rotations)
    translations = extract_translations(subject, frame_count, root_scale)
    frames = []

    for index, rotation_frame in enumerate(rotations):
        frame_index = int(frame_ids[index]) if index < len(frame_ids) else index
        joints: dict[str, list[float]] = {}
        for joint_name in SKELETON_JOINTS:
            smpl_index = SMPL_TO_MOCAP[joint_name]
            rotation = rotation_frame[smpl_index] if smpl_index < len(rotation_frame) else None
            joints[joint_name] = rotation_to_euler(rotation)
        frames.append(
            {
                "frameIndex": frame_index,
                "timestampMs": round((frame_index / max(fps, 1.0)) * 1000.0, 3),
                "rootTranslation": translations[index],
                "joints": joints,
            }
        )
    return frames


def run_wham(args: argparse.Namespace, output_dir: Path) -> tuple[Any, dict[str, Any]]:
    repo_dir = Path(args.wham_repo or os.environ.get("WHAM_REPO_DIR", "")).expanduser()
    if not repo_dir:
        fail("WHAM_REPO_DIR or --wham-repo must point to an installed WHAM checkout.")
    if not repo_dir.exists():
        fail(f"WHAM repo directory does not exist: {repo_dir}")

    sys.path.insert(0, str(repo_dir))
    previous_cwd = Path.cwd()
    os.chdir(repo_dir)
    video = args.video[0]
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        install_numpy_legacy_aliases()

        import argparse as wham_argparse
        import joblib

        import demo as wham_demo

        cfg = wham_demo.get_cfg_defaults()
        config_path = Path(args.wham_config or "configs/yamls/demo.yaml")
        if not config_path.is_absolute():
            config_path = repo_dir / config_path
        cfg.merge_from_file(str(config_path))

        smpl_batch_size = cfg.TRAIN.BATCH_SIZE * cfg.DATASET.SEQLEN
        smpl = wham_demo.build_body_model(cfg.DEVICE, smpl_batch_size)
        network = wham_demo.build_network(cfg, smpl)
        network.eval()

        # WHAM's official demo.run reads this global when optional SMPLify is
        # enabled. The adapter always disables SMPLify for deterministic worker
        # runtime, so provide the expected global when demo.py is imported.
        wham_demo.args = wham_argparse.Namespace(run_smplify=False)
        wham_demo.run(
            cfg,
            video,
            str(output_dir),
            network,
            args.calib,
            run_global=not args.estimate_local_only,
            save_pkl=True,
            visualize=False,
        )
        results = joblib.load(output_dir / "wham_output.pkl")
        tracking_results = joblib.load(output_dir / "tracking_results.pth")
        slam_results = joblib.load(output_dir / "slam_results.pth")
        overlay_preview_generated = False
        overlay_preview_error = None
        if args.render_overlay_preview:
            try:
                from lib.vis.run_vis import run_vis_on_demo

                with __import__("torch").no_grad():
                    run_vis_on_demo(
                        cfg,
                        video,
                        results,
                        str(output_dir),
                        network.smpl,
                        vis_global=not args.estimate_local_only,
                    )
                overlay_preview_generated = (output_dir / "output.mp4").exists()
            except Exception as exc:  # pragma: no cover - optional preview renderer
                overlay_preview_error = str(exc)
    except Exception as exc:  # pragma: no cover - depends on WHAM image
        fail(f"WHAM inference failed: {exc}")
    finally:
        os.chdir(previous_cwd)

    metadata = {
        "trackingSubjectCount": len(tracking_results) if hasattr(tracking_results, "__len__") else 0,
        "slamFrameCount": len(slam_results) if hasattr(slam_results, "__len__") else 0,
        "runGlobal": not args.estimate_local_only,
        "whamConfig": str(config_path),
        "overlayPreviewRequested": args.render_overlay_preview,
        "overlayPreviewGenerated": overlay_preview_generated,
        **({"overlayPreviewError": overlay_preview_error} if overlay_preview_error else {}),
    }
    return results, metadata


def load_wham_output_pkl(path: str) -> tuple[Any, dict[str, Any]]:
    try:
        install_numpy_legacy_aliases()

        import joblib
    except Exception as exc:  # pragma: no cover - depends on model image
        fail(f"Could not import joblib to load WHAM output: {exc}")
    try:
        results = joblib.load(path)
    except Exception as exc:
        fail(f"Could not load WHAM output pkl {path}: {exc}")
    metadata = {
        "trackingSubjectCount": len(results) if hasattr(results, "__len__") else 0,
        "loadedFromPkl": True,
    }
    return results, metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pose")
    parser.add_argument("--output", required=True)
    parser.add_argument("--solver-version", required=True)
    parser.add_argument("--source", required=True, choices=["single_camera", "dual_camera", "multi_view"])
    parser.add_argument("--preset", default="")
    parser.add_argument("--video", action="append")
    parser.add_argument("--wham-repo")
    parser.add_argument("--wham-config")
    parser.add_argument("--wham-output-pkl")
    parser.add_argument("--calib")
    parser.add_argument("--estimate-local-only", action="store_true")
    parser.add_argument("--render-overlay-preview", action="store_true")
    parser.add_argument("--root-scale", type=float, default=100.0)
    parser.add_argument("--take-id", default="manual_take")
    parser.add_argument("--job-id", default="manual_job")
    args = parser.parse_args()

    pose_metadata = read_pose_metadata(args.pose)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    work_dir = output_path.parent / "wham_work"
    work_dir.mkdir(parents=True, exist_ok=True)

    primary_video = args.video[0] if args.video else None
    video_info = video_metadata(primary_video, pose_metadata["fps"])
    fps = video_info["fps"] or pose_metadata["fps"]
    if args.wham_output_pkl:
        results, wham_metadata = load_wham_output_pkl(args.wham_output_pkl)
    else:
        if not primary_video:
            fail("--video is required when WHAM inference is run directly.")
        results, wham_metadata = run_wham(args, work_dir)
    subject_id, subject = choose_subject(results)
    frames = build_frames(subject, fps, args.root_scale)
    if not frames:
        fail("WHAM returned no solved frames.")

    duration_ms = (
        pose_metadata["durationMs"]
        or video_info["durationMs"]
        or (len(frames) / max(fps, 1.0)) * 1000.0
    )
    metrics = {
        "whamSubjectId": subject_id,
        "whamFrameCount": len(frames),
        "inputPoseFrameCount": pose_metadata["frameCount"],
        "sourceVideoFrameCount": video_info["frameCount"],
        "source": args.source,
        **wham_metadata,
    }
    smpl = build_smpl_parameters(subject, fps, args.root_scale, frames)
    payload = {
        "schema": "mocap.solved_motion.v1",
        "takeId": args.take_id,
        "jobId": args.job_id,
        "solver": {
            "name": "wham",
            "version": args.solver_version,
            "source": args.source,
            "premium": True,
            "metrics": metrics,
        },
        "skeleton": {
            "name": "mocap_humanoid_v1",
            "rotationOrder": "XYZ",
            "coordinateSystem": "right_handed_y_up",
        },
        "fps": fps,
        "frameCount": len(frames),
        "durationMs": round(duration_ms, 3),
        "adjustedJointRotationCount": 0,
        "warnings": [],
        "metrics": metrics,
        "smpl": smpl,
        "frames": frames,
        "validation": {
            "ok": True,
            "warnings": [],
            "errors": [],
        },
    }
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))


if __name__ == "__main__":
    main()
