# Triangulation Backend Implementation Plan

## Purpose

This document defines the work needed to turn the current triangulation prototype into a production backend reconstruction pipeline for dual-camera and pro multi-view capture.

The goal is not only to label a take as `dual_camera` or `multi_view`, but to actually use multiple recorded videos to improve 3D motion reconstruction through synchronized per-camera observations, calibrated projection matrices, DLT triangulation, quality metrics, and validated downstream WHAM/SMPL export artifacts.

This document is written as an implementation brief for NotebookLM and future engineering agents.

## Current Reality

The project already has several important pieces:

- Mobile native recording exists for iOS and Android.
- Mobile upload supports single, dual, and pro 4-camera capture metadata.
- Backend can wait for multiple expected videos before starting a job.
- Backend normalizes multiple uploaded videos for dual/pro takes.
- Domain triangulation math exists in TypeScript.
- Live dual-camera LAN prototype exists with host/guest frame matching.
- Export/result screens already understand `single_camera`, `dual_camera`, and `multi_view` as source labels.

However, the current backend worker does not yet perform true multi-camera reconstruction.

The backend currently passes all normalized video paths to the WHAM adapter, but the Python adapter uses only the first video for actual WHAM inference. Therefore, dual/pro jobs are currently multi-video grouped and labeled, but not truly triangulated from multiple camera views.

## Existing Relevant Files

### Mobile Native Capture

- `ios/MocapExpo/pose/PoseEngineModule.swift`
- `ios/MocapExpo/pose/PoseCameraSession.swift`
- `ios/MocapExpo/pose/VideoRecorder.swift`
- `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseEngineModule.kt`
- `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseCameraSession.kt`
- `src/features/capture/data/NativeCameraEngine.ts`
- `src/features/capture/hooks/useRecorder.ts`
- `src/features/capture/domain/CaptureMetadataBuilder.ts`

### Mobile Dual/Pro Capture

- `src/features/capture/screens/MultiViewSetupScreen.tsx`
- `src/features/capture/screens/CaptureScreen.tsx`
- `src/features/capture/hooks/useMultiViewCapture.ts`
- `src/features/capture/state/multiViewStore.ts`
- `src/infra/networking/PeerHost.ts`
- `src/infra/networking/PeerGuest.ts`
- `src/infra/networking/TimeSync.ts`

### Triangulation And Calibration

- `src/domain/mocap/pipeline/triangulation/Triangulator.ts`
- `src/domain/mocap/pipeline/triangulation/FrameMatcher.ts`
- `src/domain/mocap/pipeline/calibration/StereoCalibration.ts`
- `src/domain/mocap/models/MultiViewPoseFrame.ts`

### Backend Worker

- `backend/src/worker/processJob.ts`
- `backend/src/worker/export/premiumMotionSolver.ts`
- `backend/worker/model_adapters/wham_solver.py`
- `backend/src/worker/types.ts`
- `backend/src/worker/export/exportValidation.ts`
- `backend/src/worker/export/retargetPresets.ts`

### Backend API And Upload

- `backend/src/services/uploadService.ts`
- `backend/src/services/processingService.ts`
- `backend/src/services/captureSessionService.ts`
- `backend/src/infra/db/repositories.ts`
- `backend/src/domain/types.ts`

### QA

- `backend/src/qa/goldenE2e.ts`
- `backend/qa/golden-samples.example.json`

## Existing Technical Assets

### Triangulator

`Triangulator.ts` implements:

- Projection matrix model: `P = K * [R | t]`
- DLT triangulation from two 2D observations
- Per-landmark confidence filtering
- Per-landmark reprojection error
- Average reprojection error
- Basic camera intrinsic helper from FOV
- Projection matrix builder

This is useful and should be reused or ported into backend worker code.

### FrameMatcher

`FrameMatcher.ts` implements:

- Remote frame buffering
- Clock offset correction
- Nearest timestamp matching
- Match/drop stats
- Tolerance-based pairing

This is useful for both live LAN prototype and backend frame matching, although backend matching may need richer sync sources such as audio clap markers and video frame timestamps.

### StereoCalibration

`StereoCalibration.ts` implements a simplified calibration path:

- Collect matched 2D point correspondences
- Estimate fundamental matrix
- Build/estimate intrinsics
- Compute essential matrix
- Decompose into rotation and translation
- Build projection matrices
- Score calibration quality

This is a reference implementation. For production backend use, it should be hardened with stronger validation, actual camera metadata when available, and robust outlier rejection.

## Main Gap

The missing production piece is a backend multi-video reconstruction stage between video normalization and WHAM/SMPL solving.

Today the worker roughly does this:

```text
uploaded videos
  -> normalize each video
  -> call WHAM adapter with all video paths
  -> Python adapter uses video[0]
  -> solved motion from primary camera only
  -> cleanup/export
```

The target pipeline should be:

```text
uploaded videos
  -> normalize each video
  -> extract per-camera 2D pose/keypoints
  -> synchronize per-camera frames
  -> estimate/load camera calibration
  -> triangulate matched observations into 3D landmarks
  -> write reconstruction artifacts and metrics
  -> feed improved 3D signal into motion solve/export path
  -> quality report includes true multi-view metrics
```

## Target Architecture

## Stage 1: Multi-Video Ingestion

The worker should keep current behavior:

- Load all uploaded videos for a take.
- Block processing until `expectedVideoCount` is satisfied.
- Sort videos by `deviceIndex`.
- Normalize every selected video.
- Store each normalized video artifact:
  - `normalized/device_0.mp4`
  - `normalized/device_1.mp4`
  - `normalized/device_2.mp4`
  - `normalized/device_3.mp4`

This is already mostly implemented in `backend/src/worker/processJob.ts`.

## Stage 2: Per-Camera Pose Extraction

For each normalized video, the backend must extract 2D pose observations.

Output artifact per camera:

```text
takes/{takeId}/jobs/{jobId}/pose_frames_device_{deviceIndex}.json
```

Suggested schema:

```json
{
  "schema": "mocap.pose_frames_device.v1",
  "takeId": "take_123",
  "jobId": "job_123",
  "deviceIndex": 0,
  "deviceRole": "primary",
  "sourceVideo": {
    "storageKey": "takes/.../source.mp4",
    "normalizedStorageKey": "takes/.../normalized/device_0.mp4",
    "fps": 30,
    "width": 1920,
    "height": 1080,
    "durationMs": 10000
  },
  "detector": {
    "name": "vitpose_or_wham_tracking",
    "version": "v1",
    "landmarkSchema": "body_33_or_wham_internal"
  },
  "frames": [
    {
      "frameIndex": 0,
      "timestampMs": 0,
      "landmarks": [
        { "x": 0.5, "y": 0.4, "z": 0, "visibility": 0.95 }
      ],
      "poseConfidence": 0.92
    }
  ],
  "quality": {
    "frameCount": 300,
    "detectedFrameCount": 292,
    "lowConfidenceFrameCount": 8,
    "averagePoseConfidence": 0.89
  }
}
```

Important decision:

- If WHAM can expose tracked 2D keypoints per frame, reuse that.
- If WHAM only returns SMPL/world outputs, add a dedicated 2D detector adapter.
- Keep the detector output independent from final SMPL solving so triangulation can be tested directly.

## Stage 3: Synchronization

Frame sync must align observations across videos.

Sync sources, in priority order:

1. Audio clap/marker sync if available.
2. Capture metadata timestamps and `clockOffsetMs`.
3. Video frame timestamps.
4. Manual fallback offset if provided.

Output should include a sync report:

```json
{
  "schema": "mocap.multiview_sync.v1",
  "takeId": "take_123",
  "jobId": "job_123",
  "referenceDeviceIndex": 0,
  "devices": [
    {
      "deviceIndex": 1,
      "offsetMs": -18.3,
      "confidence": 0.91,
      "method": "audio_marker",
      "matchedFrameCount": 281,
      "averageTimeDeltaMs": 4.6
    }
  ]
}
```

Dual-camera matching:

- Use device 0 as reference.
- Match device 1 frames into reference timeline.
- Use tolerance initially around 20-35 ms.

Pro 4-camera matching:

- Use front/device 0 as reference by default.
- Match every other camera to reference timeline.
- Allow best-pair per landmark when not all views see a body part.

## Stage 4: Calibration And Projection Matrices

The worker needs projection matrices for each camera.

Input sources:

- Capture metadata:
  - `deviceIndex`
  - `deviceRole`
  - `camera.position`
  - `camera.intrinsics`
  - `approxCameraAngle`
  - `calibrationClipId`
- Stereo/pro calibration clips when available.
- FOV fallback when intrinsics are missing.

Output artifact:

```text
takes/{takeId}/jobs/{jobId}/camera_calibration.json
```

Suggested schema:

```json
{
  "schema": "mocap.camera_calibration.v1",
  "takeId": "take_123",
  "jobId": "job_123",
  "source": "metadata_and_fov_fallback",
  "intrinsicsSource": "capture_metadata_or_fov",
  "devices": [
    {
      "deviceIndex": 0,
      "deviceRole": "primary",
      "intrinsic": [1, 0, 0.5, 0, 1, 0.5, 0, 0, 1],
      "rotation": [1, 0, 0, 0, 1, 0, 0, 0, 1],
      "translation": [0, 0, 0],
      "projection": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
    }
  ],
  "quality": {
    "score": 0.78,
    "averageReprojectionErrorPx": 4.2,
    "baseline": 1.8,
    "convergenceAngle": 72
  },
  "warnings": [
    "camera_intrinsics_fov_fallback_used"
  ]
}
```

Minimum acceptable V1:

- Use real intrinsics when metadata provides them.
- Else use FOV-based approximate intrinsics.
- Use device role and approximate angle to initialize extrinsics.
- Record every fallback in warnings and quality metrics.

Production V2:

- Use calibration clips and robust bundle adjustment.
- Add outlier rejection.
- Validate positive depth and reprojection error distribution.

## Stage 5: DLT Triangulation

Dual-camera:

- For each matched frame pair:
  - For each landmark:
    - Require minimum confidence in both views.
    - Triangulate with DLT.
    - Compute reprojection error.
    - Reject if reprojection error exceeds threshold.
    - Reject if point has invalid depth.

Pro 4-camera:

- For each timestamp group:
  - For each landmark:
    - Collect all views with sufficient confidence.
    - Prefer best pair by:
      - confidence
      - baseline/convergence angle
      - reprojection error
      - visibility
    - Optionally run multi-view least squares when 3+ views are valid.
    - Fall back to best single-camera depth estimate only if needed, and mark it as fallback.

Output artifact:

```text
takes/{takeId}/jobs/{jobId}/dual_reconstruction.json
takes/{takeId}/jobs/{jobId}/multi_view_reconstruction.json
```

Suggested schema:

```json
{
  "schema": "mocap.multiview_reconstruction.v1",
  "takeId": "take_123",
  "jobId": "job_123",
  "source": "dual_camera",
  "frameCount": 280,
  "landmarkSchema": "body_33",
  "frames": [
    {
      "frameIndex": 0,
      "timestampMs": 0,
      "matchedDevices": [0, 1],
      "averageTimeDeltaMs": 4.1,
      "landmarks3D": [
        {
          "x": 0.12,
          "y": 1.45,
          "z": 2.1,
          "visibility": 0.93,
          "source": "triangulated",
          "views": [0, 1],
          "reprojectionErrorPx": 3.2
        }
      ],
      "metrics": {
        "triangulatedLandmarkRatio": 0.84,
        "fallbackLandmarkRatio": 0.08,
        "averageReprojectionErrorPx": 3.9
      }
    }
  ],
  "metrics": {
    "matchedFrameCount": 280,
    "droppedFrameCount": 14,
    "averageTimeDeltaMs": 5.2,
    "reprojectionErrorPx": 4.1,
    "reprojectionP95Px": 9.7,
    "triangulatedLandmarkRatio": 0.81,
    "fallbackLandmarkRatio": 0.11,
    "calibrationQualityScore": 0.76
  },
  "warnings": []
}
```

## Stage 6: Pose Frames Artifact For Downstream Solver

The worker already uses `PoseFramesArtifact` as a source for downstream solve metadata. For multi-view jobs, the final `pose_frames.json` should be built from reconstruction output.

For dual/pro:

- `frames[].landmarks` can keep the reference camera 2D landmarks.
- `frames[].worldLandmarks` should contain triangulated 3D landmarks.
- `detector.name` should clearly indicate multi-view reconstruction.
- `quality` should include detected and triangulated ratios.

Example:

```json
{
  "schema": "mocap.pose_frames.v1",
  "takeId": "take_123",
  "jobId": "job_123",
  "detector": {
    "name": "backend_multiview_triangulation",
    "version": "v1",
    "landmarkSchema": "body_33"
  },
  "frames": [
    {
      "frameIndex": 0,
      "timestampMs": 0,
      "landmarks": [],
      "worldLandmarks": [
        { "x": 0.12, "y": 1.45, "z": 2.1, "visibility": 0.93 }
      ],
      "poseConfidence": 0.88,
      "detectorVersion": "backend_multiview_triangulation_v1"
    }
  ]
}
```

## Stage 7: Motion Solving Strategy

There are two possible paths:

### Path A: Use Triangulated 3D As Quality/Constraint Signal

Keep WHAM as the main motion solver, but run it on the primary video and use triangulated 3D landmarks for:

- quality metrics
- validation
- scale stabilization
- root trajectory correction
- future SMPLify constraints

This is easier and lower risk.

### Path B: Use Triangulated 3D As Solver Input

Feed reconstructed 3D landmarks into a solver that can fit skeleton/SMPL directly from 3D observations.

This gives the strongest multi-view value but requires a real 3D fitting stage.

Recommended implementation order:

1. Implement Path A first.
2. Emit real reconstruction artifacts and quality reports.
3. Add 3D-constrained fitting later as Path B.

## Stage 8: Quality Report Integration

`quality_report.json` must include multi-view metrics when source is `dual_camera` or `multi_view`.

Required metrics:

- `syncOffsetMs`
- `syncConfidence`
- `matchedFrameCount`
- `droppedFrameCount`
- `averageTimeDeltaMs`
- `reprojectionErrorPx`
- `reprojectionP95Px`
- `triangulatedLandmarkRatio`
- `fallbackLandmarkRatio`
- `calibrationQualityScore`
- `intrinsicsFallbackUsed`
- `multiViewQualityGain`

Suggested warning codes:

- `camera_intrinsics_missing`
- `camera_intrinsics_fov_fallback_used`
- `calibration_quality_low`
- `sync_confidence_low`
- `triangulation_coverage_low`
- `reprojection_error_high`
- `single_camera_solver_fallback_used`

## Stage 9: Result Screen Integration

The result screen already has source labels. It should surface:

- source: single / dual / multi-view
- matched frames
- average sync delta
- reprojection average and p95
- triangulated landmark ratio
- fallback ratio
- calibration quality
- intrinsics fallback status
- whether WHAM used only primary camera or multi-view constraints

## Implementation Work Packages

## WP1: Backend Type Definitions

Add backend types for:

- per-camera pose artifact
- sync report
- camera calibration report
- multi-view reconstruction artifact
- triangulation metrics

Likely file:

- `backend/src/worker/types.ts`

Acceptance criteria:

- All new artifacts have explicit schemas.
- Quality metrics are typed.
- No `any` is needed in worker pipeline for reconstruction objects.

## WP2: Per-Camera Pose Extraction Adapter

Implement backend function:

```ts
extractPoseFramesForVideo(input: {
  takeId: string;
  jobId: string;
  source: ProcessedSource;
  outputDir: string;
}): Promise<PerCameraPoseArtifact>
```

Likely new files:

- `backend/src/worker/pose/poseExtraction.ts`
- `backend/worker/model_adapters/pose_detector.py`

Acceptance criteria:

- Single camera produces one per-camera pose artifact.
- Dual camera produces two per-camera pose artifacts.
- Pro mode produces four per-camera pose artifacts.
- Artifacts are uploaded to object storage.
- Detector failures are reported per device.

## WP3: Backend Frame Matching And Sync

Implement backend frame matching:

```ts
matchMultiCameraFrames(input: {
  reference: PerCameraPoseArtifact;
  others: PerCameraPoseArtifact[];
  metadata: CaptureMetadata[];
}): MultiViewMatchedFrameSet[]
```

Likely new files:

- `backend/src/worker/reconstruction/frameSync.ts`

Acceptance criteria:

- Dual matching works against device 0.
- Pro matching produces timestamp groups.
- Sync metrics are emitted.
- Low-confidence sync creates warnings.

## WP4: Calibration Builder

Implement:

```ts
buildCameraCalibration(input: {
  videos: CaptureVideo[];
  metadata: CaptureMetadata[];
  poseArtifacts: PerCameraPoseArtifact[];
}): CameraCalibrationArtifact
```

Likely new files:

- `backend/src/worker/reconstruction/cameraCalibration.ts`

Acceptance criteria:

- Projection matrices are produced for every selected camera.
- Metadata intrinsics are used when present.
- FOV fallback is explicit.
- Calibration quality score is computed.
- Invalid calibration fails or falls back with a clear warning.

## WP5: Backend Triangulation Module

Port or share triangulation logic.

Options:

- Copy TypeScript domain logic into backend worker module.
- Move shared math into a common package path usable by backend and app.
- Keep backend-specific implementation to avoid Metro/backend coupling.

Recommended V1:

- Add backend-specific module:
  - `backend/src/worker/reconstruction/triangulation.ts`

Acceptance criteria:

- Unit test triangulates a synthetic point from two cameras.
- Reprojection error is finite and below threshold for synthetic data.
- Low-confidence landmarks are skipped.
- Invalid projection matrices fail safely.

## WP6: Reconstruction Artifact Writer

Implement:

```ts
reconstructMultiViewPose(input: {
  source: "dual_camera" | "multi_view";
  matchedFrames: MultiViewMatchedFrameSet[];
  calibration: CameraCalibrationArtifact;
}): MultiViewReconstructionArtifact
```

Likely file:

- `backend/src/worker/reconstruction/multiViewReconstruction.ts`

Acceptance criteria:

- Dual mode writes `dual_reconstruction.json`.
- Pro mode writes `multi_view_reconstruction.json`.
- Artifact contains frame-level and aggregate metrics.
- Storage/export records are created.

## WP7: Worker Pipeline Integration

Modify `backend/src/worker/processJob.ts`.

Current path:

```text
normalize videos
-> WHAM solve
```

Target path:

```text
normalize videos
-> if single: current WHAM path
-> if dual/pro:
   -> per-camera pose extraction
   -> sync
   -> calibration
   -> triangulation
   -> pose_frames.json from reconstruction
   -> WHAM/SMPL solve with source label and future constraints
```

Acceptance criteria:

- Single-camera behavior remains unchanged.
- Dual/pro jobs produce additional reconstruction artifacts.
- Failed reconstruction has clear error codes.
- If fallback to primary WHAM is allowed, it is explicit in quality report.

## WP8: Python Adapter Cleanup

`backend/worker/model_adapters/wham_solver.py` currently uses only `args.video[0]`.

Decide and document behavior:

- For V1, keep WHAM primary-video behavior, but do not pretend WHAM consumed all videos.
- Add metadata fields:
  - `primaryVideoUsed`
  - `additionalVideosProvided`
  - `multiViewConstraintsUsed`

Acceptance criteria:

- For `dual_camera` / `multi_view`, output metrics clearly state whether only the primary video was used by WHAM.
- No misleading multi-view claim is made unless reconstruction/constraints are actually used.

## WP9: Quality Report Upgrade

Modify:

- `backend/src/worker/export/exportValidation.ts`
- `backend/src/worker/types.ts`

Acceptance criteria:

- Multi-view metrics appear in `quality_report.json`.
- Result screen can display these metrics.
- Golden QA can assert these metrics for dual/pro samples.

## WP10: Golden QA

Extend:

- `backend/src/qa/goldenE2e.ts`
- `backend/qa/golden-samples.example.json`

Acceptance criteria:

- Dual sample asserts:
  - `smpl_parameters_json` exists
  - `dual_reconstruction_json` exists
  - `matchedFrameCount > 0`
  - `triangulatedLandmarkRatio >= threshold`
  - `reprojectionErrorPx <= threshold`

- Pro sample asserts:
  - `multi_view_reconstruction_json` exists
  - at least 4 videos were processed
  - best-pair or multi-view triangulation metrics exist

## WP11: Mobile Metadata Hardening

Ensure every capture upload includes:

- capture mode
- capture session id
- device index
- device role
- camera position
- orientation
- width/height/fps/duration
- local clock offset
- calibration clip id when applicable
- approximate camera angle for pro mode
- intrinsics when available

Relevant files:

- `src/features/capture/hooks/useRecorder.ts`
- `src/features/capture/domain/CaptureMetadataBuilder.ts`
- `src/features/upload/data/SignedUrlUploadManager.ts`

Acceptance criteria:

- Backend receives complete metadata for every uploaded video.
- Metadata validator rejects malformed dual/pro uploads early.
- Android and iOS produce equivalent capture metadata.

## WP12: Device QA

Real-device test matrix:

- iOS single camera
- Android single camera
- iOS + iOS dual
- Android + Android dual
- iOS + Android dual
- Pro 4-camera mixed roles if devices are available

Test checks:

- Preview starts.
- Recording starts/stops.
- Upload completes.
- Backend waits for all expected videos.
- Sync metrics are non-zero.
- Reconstruction artifact exists.
- Result page shows dual/pro metrics.
- Export artifacts open successfully.

## Suggested Error Codes

Add explicit worker error codes:

- `multi_view_pose_extraction_failed`
- `multi_view_sync_failed`
- `camera_calibration_failed`
- `camera_projection_invalid`
- `triangulation_failed`
- `triangulation_coverage_low`
- `reprojection_error_high`
- `multi_view_reconstruction_invalid`
- `metadata_intrinsics_required`

## Suggested Artifact Formats

Add export formats:

- `pose_frames_device_json`
- `camera_calibration_json`
- `multi_view_sync_json`
- `dual_reconstruction_json`
- `multi_view_reconstruction_json`

## Acceptance Criteria For The Whole Project

The target is complete when all are true:

1. Single-camera jobs still pass existing backend flow.
2. Dual jobs require two videos and process both.
3. Pro jobs require four videos and process all four.
4. Per-camera pose artifacts are produced.
5. Frame sync report is produced.
6. Camera calibration artifact is produced.
7. Dual/pro reconstruction artifact is produced.
8. `pose_frames.json` for dual/pro contains triangulated 3D world landmarks or explicitly marked fallback data.
9. Quality report includes sync, calibration, reprojection, and triangulation coverage metrics.
10. Result screen surfaces multi-view metrics.
11. Golden QA asserts reconstruction artifacts and metric thresholds.
12. Real-device QA is completed on at least one dual-camera setup.

## Recommended Implementation Order

1. Add backend types and artifact schemas.
2. Add backend triangulation module with synthetic unit tests.
3. Add per-camera pose artifact format.
4. Add frame matching/sync module.
5. Add calibration builder with metadata/FOV fallback.
6. Add reconstruction artifact writer.
7. Integrate reconstruction stage into `WorkerJobProcessor`.
8. Update quality report and result screen.
9. Update golden QA assertions.
10. Run real-device dual capture QA.
11. Add pro 4-camera best-pair triangulation.

## Important Product Boundary

This plan creates a real multi-view reconstruction foundation. It does not automatically equal full Move.ai-level performance.

Move.ai-level robustness would still need:

- calibrated multi-view datasets
- stronger camera calibration
- robust occlusion handling
- bundle adjustment
- multi-person disambiguation
- learned 3D pose priors
- direct SMPL fitting from multi-view 2D/3D constraints

The correct near-term target is:

```text
production-grade dual/pro reconstruction foundation
with measurable sync, reprojection, coverage, and quality metrics
```

## Current Truth Statement

The project currently has triangulation math and a live dual-camera prototype, but backend production multi-video triangulation is not fully implemented yet.

The backend can group and normalize multiple videos, but the WHAM adapter currently uses the first video for inference. The next major milestone is to add an explicit backend reconstruction stage that extracts per-camera 2D observations, synchronizes frames, builds projection matrices, triangulates landmarks, writes reconstruction artifacts, and feeds the downstream motion/export pipeline with honest quality metrics.
