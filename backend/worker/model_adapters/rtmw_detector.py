#!/usr/bin/env python3
"""RTMW/RTMPose WholeBody adapter for MocapExpo.

The Node worker calls this script through RTMW_DETECTOR_SCRIPT. It emits the
existing mocap.pose_frames.v1 contract while preserving 133 whole-body
landmarks for downstream premium solve/reporting.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any


def fail(message: str, code: int = 2) -> None:
    sys.stderr.write(message + "\n")
    raise SystemExit(code)


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        item = float(value)
    except (TypeError, ValueError):
        return fallback
    if item != item or item in (float("inf"), float("-inf")):
        return fallback
    return item


@dataclass(frozen=True)
class SubjectSelection:
    index: int | None
    confidence: float


def env_float(name: str, fallback: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return fallback
    return finite(raw, fallback)


def select_subject(
    keypoints: Any,
    scores: Any,
    previous_center: tuple[float, float] | None,
) -> SubjectSelection:
    import numpy as np

    keypoints_np = np.asarray(keypoints)
    scores_np = np.asarray(scores)
    if keypoints_np.size == 0:
        return SubjectSelection(None, 0.0)
    if keypoints_np.ndim == 2:
        keypoints_np = keypoints_np[None, ...]
    if scores_np.ndim == 1:
        scores_np = scores_np[None, ...]
    if keypoints_np.ndim < 3 or keypoints_np.shape[0] == 0:
        return SubjectSelection(None, 0.0)

    best_index: int | None = None
    best_score = -1.0
    for index in range(keypoints_np.shape[0]):
        person_scores = scores_np[index] if index < scores_np.shape[0] else []
        visible = np.asarray(person_scores, dtype=float)
        confidence = float(np.nanmean(visible)) if visible.size else 0.0
        if previous_center is not None:
            points = keypoints_np[index]
            center = np.nanmean(points[:, :2], axis=0)
            distance = float(np.linalg.norm(center - np.asarray(previous_center)))
            confidence -= min(0.25, distance / 2000.0)
        if confidence > best_score:
            best_score = confidence
            best_index = index
    return SubjectSelection(best_index, max(0.0, best_score))


def landmarks_for_subject(
    keypoints: Any,
    scores: Any,
    subject_index: int,
    width: float,
    height: float,
) -> tuple[list[dict[str, float]], tuple[float, float] | None]:
    import numpy as np

    keypoints_np = np.asarray(keypoints)
    scores_np = np.asarray(scores)
    if keypoints_np.ndim == 2:
        keypoints_np = keypoints_np[None, ...]
    if scores_np.ndim == 1:
        scores_np = scores_np[None, ...]

    points = keypoints_np[subject_index]
    person_scores = scores_np[subject_index] if subject_index < scores_np.shape[0] else []
    out: list[dict[str, float]] = []
    for index, point in enumerate(points):
        score = finite(person_scores[index] if index < len(person_scores) else 0.0)
        x_px = finite(point[0])
        y_px = finite(point[1])
        z_value = finite(point[2]) if len(point) > 2 else 0.0
        out.append(
            {
                "x": x_px / max(width, 1.0),
                "y": y_px / max(height, 1.0),
                "z": z_value,
                "visibility": score,
                "presence": score,
            }
        )

    center_np = np.nanmean(points[:, :2], axis=0) if len(points) else None
    center = (float(center_np[0]), float(center_np[1])) if center_np is not None else None
    return out, center


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--detector-version", required=True)
    parser.add_argument("--output-schema", default="mocap.pose_frames.v1")
    args = parser.parse_args()

    try:
        import cv2
        from rtmlib import Wholebody
    except Exception as exc:  # pragma: no cover - depends on model image
        fail(
            "RTMW adapter dependencies are missing. Install "
            "backend/worker/requirements.model-rtmw.txt in the model worker image. "
            f"Original error: {exc}"
        )

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        fail(f"Could not open video: {args.input}")

    fps = finite(cap.get(cv2.CAP_PROP_FPS), 30.0) or 30.0
    width = finite(cap.get(cv2.CAP_PROP_FRAME_WIDTH), 1.0) or 1.0
    height = finite(cap.get(cv2.CAP_PROP_FRAME_HEIGHT), 1.0) or 1.0
    min_score = env_float("RTMW_MIN_SCORE", 0.2)
    backend = os.environ.get("RTMW_BACKEND", "onnxruntime")
    device = os.environ.get("RTMW_DEVICE", "cpu")
    mode = os.environ.get("RTMW_MODE", "balanced")

    try:
        model = Wholebody(
            to_openpose=False,
            mode=mode,
            backend=backend,
            device=device,
        )
    except Exception as exc:  # pragma: no cover - depends on model image
        fail(f"Failed to initialize RTMW Wholebody model: {exc}")

    frames = []
    detected = 0
    low_confidence = 0
    confidence_sum = 0.0
    frame_index = 0
    previous_center: tuple[float, float] | None = None

    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break

        timestamp_ms = finite(cap.get(cv2.CAP_PROP_POS_MSEC), (frame_index / fps) * 1000.0)
        try:
            keypoints, scores = model(frame_bgr)
        except Exception as exc:
            fail(f"RTMW inference failed at frame {frame_index}: {exc}")

        selection = select_subject(keypoints, scores, previous_center)
        wholebody_landmarks: list[dict[str, float]] = []
        confidence = selection.confidence
        if selection.index is not None and confidence >= min_score:
            wholebody_landmarks, previous_center = landmarks_for_subject(
                keypoints,
                scores,
                selection.index,
                width,
                height,
            )
            detected += 1
            confidence_sum += confidence
            if confidence < 0.45:
                low_confidence += 1
        else:
            previous_center = None

        frames.append(
            {
                "frameIndex": frame_index,
                "timestampMs": round(timestamp_ms, 3),
                "landmarkSchema": "coco_wholebody_133",
                "landmarks": wholebody_landmarks,
                "wholeBodyLandmarks": wholebody_landmarks,
                "poseConfidence": confidence,
                "detectorVersion": args.detector_version,
            }
        )
        frame_index += 1

    cap.release()
    average = confidence_sum / detected if detected else 0.0
    payload = {
        "schema": args.output_schema,
        "detector": {
            "name": "rtmw_wholebody",
            "version": args.detector_version,
            "landmarkSchema": "coco_wholebody_133",
            "backend": backend,
            "device": device,
            "mode": mode,
        },
        "frames": frames,
        "quality": {
            "frameCount": len(frames),
            "detectedFrameCount": detected,
            "lowConfidenceFrameCount": low_confidence,
            "averagePoseConfidence": average,
        },
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))


if __name__ == "__main__":
    main()
