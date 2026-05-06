#!/usr/bin/env python3
import argparse
import json
import sys


def fail(message: str, code: int = 2):
    sys.stderr.write(message + "\n")
    raise SystemExit(code)


def landmark_to_dict(landmark):
    return {
        "x": float(landmark.x),
        "y": float(landmark.y),
        "z": float(landmark.z),
        "visibility": float(getattr(landmark, "visibility", 0.0)),
        "presence": float(getattr(landmark, "presence", 0.0)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--detector-version", required=True)
    args = parser.parse_args()

    try:
        import cv2
        import mediapipe as mp
    except Exception as exc:
        fail(
            "MediaPipe worker dependencies are missing. "
            "Install backend/worker/requirements.txt in the worker image. "
            f"Original error: {exc}"
        )

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        fail(f"Could not open video: {args.input}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_index = 0
    detected = 0
    low_confidence = 0
    confidence_sum = 0.0
    frames = []

    with mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=2,
        smooth_landmarks=False,
        enable_segmentation=False,
        min_detection_confidence=0.45,
        min_tracking_confidence=0.45,
    ) as pose:
        while True:
            ok, image_bgr = cap.read()
            if not ok:
                break

            timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            if not timestamp_ms or timestamp_ms < 0:
                timestamp_ms = (frame_index / fps) * 1000.0

            image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            result = pose.process(image_rgb)
            landmarks = []
            world_landmarks = []
            confidence = 0.0

            if result.pose_landmarks:
                landmarks = [landmark_to_dict(item) for item in result.pose_landmarks.landmark]
                confidence = sum(item["visibility"] for item in landmarks) / max(1, len(landmarks))
                detected += 1
                confidence_sum += confidence
                if confidence < 0.45:
                    low_confidence += 1

            if result.pose_world_landmarks:
                world_landmarks = [
                    landmark_to_dict(item)
                    for item in result.pose_world_landmarks.landmark
                ]

            frames.append(
                {
                    "frameIndex": frame_index,
                    "timestampMs": round(float(timestamp_ms), 3),
                    "landmarks": landmarks,
                    "worldLandmarks": world_landmarks if world_landmarks else None,
                    "poseConfidence": confidence,
                    "detectorVersion": args.detector_version,
                }
            )
            frame_index += 1

    cap.release()
    average = confidence_sum / detected if detected else 0.0
    payload = {
        "schema": "mocap.pose_frames.v1",
        "detector": {
            "name": "mediapipe_pose",
            "version": args.detector_version,
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
