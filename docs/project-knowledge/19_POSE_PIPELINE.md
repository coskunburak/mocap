# 19_POSE_PIPELINE

## Purpose

MocapExpo production motion capture is video-first and WHAM-only. The mobile app records source video and capture metadata, the backend creates a processing job, and the worker runs WHAM/SMPL/SMPLify to produce motion and export artifacts.

There is no supported alternate detector or built-in pose-to-motion fallback path.

## Source Of Truth Files

| Area | Files |
| --- | --- |
| Mobile camera/upload capture | `src/features/capture/hooks/useWhamCapture.ts`, `src/features/capture/hooks/useRecorder.ts`, `src/domain/mocap/pipeline/pose/NativeCameraEngine.ts` |
| Native camera bridge | `ios/MocapExpo/pose/PoseEngineModule.swift`, `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseEngineModule.kt` |
| Capture metadata | `src/domain/mocap/models/CaptureMetadata.ts`, `src/features/capture/domain/CaptureMetadataBuilder.ts` |
| Backend job API | `backend/src/http/routes.ts`, `backend/src/services/processingService.ts`, `backend/src/domain/stateMachine.ts` |
| Worker orchestration | `backend/src/worker/processJob.ts`, `backend/src/worker/video/videoPipeline.ts` |
| WHAM adapter | `backend/src/worker/export/premiumMotionSolver.ts`, `backend/worker/model_adapters/wham_solver.py` |
| SMPL contracts | `backend/src/worker/types.ts` |
| Result UI | `src/features/upload/screens/ProcessingStatusScreen.tsx`, `src/features/exports/screens/ExportResultScreen.tsx` |

## Production Flow

1. `CaptureScreen.tsx` starts the native camera preview and video recording through `useWhamCapture`.
2. `useRecorder.ts` creates a local take and writes `mocap.capture.v1` metadata with the recorded source video reference.
3. Upload screens send the original video and metadata to backend storage through signed URLs.
4. Backend processing creates a queued job. Valid active states are `queued`, `ingesting`, `extracting_frames`, `solving_motion`, `cleaning`, and `exporting`.
5. Worker downloads the video, probes it, and normalizes it with FFmpeg.
6. Worker invokes the configured WHAM adapter on the normalized video.
7. WHAM output is normalized into `mocap.pose_frames.v1`, `mocap.smpl_parameters.v1`, `mocap.solved_motion.v1`, cleanup, quality, preview, pipeline report, optional overlay, and BVH artifacts.
8. Mobile result screens consume backend export records and WHAM/SMPL artifacts only.

## SMPL Artifact Shape

`smpl_parameters_json` is the WHAM-centered body model artifact. It can include:

- `bodyPose`
- `globalOrient`
- `betas`
- `translation`
- `camera`
- `joints3d`
- `mesh`
- `smplify`
- per-frame SMPL parameters

`solved_motion_json` remains the cleaned animation artifact used for preview/export, and includes WHAM solver metadata plus SMPL references when available.

## Removed Paths

The repository no longer supports native or backend detector inference, detector runners/adapters, detector fallback flags, local pose-frame recording as a production path, or pipeline selection between WHAM and any pose detector.

Generic landmark/pose helper types can still exist for legacy local preview or avatar math, but they are not a production motion capture source and must not be wired into backend processing.
