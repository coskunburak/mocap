# Native Video Recording Gap

## Gap

Before Sprint 1, `PoseCameraSession` produced camera preview frames for removed pose runtime inference but did not write durable video files. This blocked the backend-core architecture because the backend worker requires original video, not estimated pose frames.

## Decision

iOS uses `AVAssetWriter` attached to the existing `AVCaptureVideoDataOutput` sample buffer stream.

Android uses CameraX `Recorder`/`VideoCapture` bound alongside `Preview` and `ImageAnalysis`.

## Requirements

1. Preview remains active while recording.
2. Pose preview keeps emitting quality frames while recording.
3. Stop recording returns local URI, duration, fps, width, height, file size, codec, and timestamps.
4. Failed or zero-byte recordings reject before upload.
5. Recording state transitions are explicit: `idle`, `preparing`, `recording`, `stopping`, `failed`.

