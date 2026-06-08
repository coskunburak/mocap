# MocapExpo Triangulation Backend Production Pipeline Guide

## Source And Scope

This guide turns the current triangulation prototype into a production-ready backend multi-camera reconstruction pipeline plan.

Primary reference:

- NotebookLM source: `Triangulation Backend Implementation Plan`
- Repo reality checked against the current MocapExpo codebase on 2026-05-23.

Core rule:

- The existing single-camera WHAM/SMPL/FFmpeg backend flow must not break.
- Existing endpoints, `WorkerJobProcessor` behavior, job status flow, storage artifact creation, export records, and current `quality_report.json` output must stay backward compatible.
- Multi-camera reconstruction must run only through an explicit multi-camera branch, feature flag, job mode, or input schema.

---

# 1. Current State Summary

## Ready Pieces

- Backend API route structure is already in place.
  - `backend/src/http/routes.ts`
  - Current endpoints cover projects, takes, capture sessions, uploads, processing jobs, retry/cancel, exports, and signed download URLs.

- Backend domain/job/upload/export models are already in place.
  - `backend/src/domain/types.ts`
  - `backend/src/infra/db/repositories.ts`
  - `backend/migrations/001_initial_schema.sql`
  - `backend/migrations/002_dual_camera_sessions.sql`

- Backend can wait for all expected videos before processing.
  - `backend/src/services/processingService.ts`
  - `backend/src/services/uploadService.ts`
  - `Take.expectedVideoCount`
  - `CaptureVideo.deviceIndex`

- Worker can collect uploaded videos, sort by `deviceIndex`, normalize multiple videos, and write normalized artifacts.
  - `backend/src/worker/processJob.ts`
  - `backend/src/worker/video/videoPipeline.ts`
  - Current keys:
    - `takes/{takeId}/jobs/{jobId}/normalized.mp4` for single camera
    - `takes/{takeId}/jobs/{jobId}/normalized/device_{deviceIndex}.mp4` for dual/pro

- WHAM/SMPL/BVH/export flow is production-oriented.
  - `backend/src/worker/export/premiumMotionSolver.ts`
  - `backend/worker/model_adapters/wham_solver.py`
  - `backend/src/worker/export/bvhWriter.ts`
  - `backend/src/worker/export/exportValidation.ts`
  - `backend/src/worker/cleanup/motionCleanup.ts`

- S3/object storage abstraction is ready.
  - `backend/src/infra/storage/objectStorage.ts`
  - Supports signed upload/download, JSON upload, file upload, text upload, and take/job artifact keys.

- Current quality report exists.
  - `backend/src/worker/export/exportValidation.ts`
  - `backend/src/worker/types.ts`
  - Current schema: `mocap.quality_report.v1`

- Mobile capture metadata schema and builder exist.
  - `src/domain/mocap/models/CaptureMetadata.ts`
  - `src/features/capture/domain/CaptureMetadataBuilder.ts`
  - `src/features/capture/hooks/useRecorder.ts`
  - `src/features/upload/data/SignedUrlUploadManager.ts`

- Existing mobile dual/pro prototype pieces exist.
  - `src/features/capture/screens/MultiViewSetupScreen.tsx`
  - `src/features/capture/hooks/useMultiViewCapture.ts`
  - `src/features/capture/state/multiViewStore.ts`
  - `src/infra/networking/PeerHost.ts`
  - `src/infra/networking/PeerGuest.ts`
  - `src/infra/networking/TimeSync.ts`

- Existing triangulation/calibration math exists in app/domain code.
  - `src/domain/mocap/pipeline/triangulation/Triangulator.ts`
  - `src/domain/mocap/pipeline/triangulation/FrameMatcher.ts`
  - `src/domain/mocap/pipeline/calibration/StereoCalibration.ts`
  - `src/domain/mocap/models/MultiViewPoseFrame.ts`

## Dual Camera Reconstruction Durumu

Mevcut repo davranışı:

- Tek kamera WHAM yapısı korunmuştur. Solo jobs ve `selectedVideoCount <= 1` single-camera WHAM production yolunda kalır.
- Dual camera tarafında backend reconstruction stage eklenmiştir.
- Dual camera hattı per-camera 2D pose extraction, frame sync, camera calibration, DLT triangulation, `dual_reconstruction.json`, `multi_view_reconstruction.json` ve quality metric üretir.
- Worker, dual/pro diagnostic reconstruction başarılı olduğunda `pose_frames_device_json`, `multi_view_sync_json`, `camera_calibration_json`, `dual_reconstruction_json`, `multi_view_reconstruction_json` ve uyumlu olduğunda diagnostic `pose_frames_json` artifact'lerini yazabilir.
- `quality_report_json` artık `QualityReport.multiView` altında additive multi-view metric'leri içerebilir.
- Result screen, single-camera ekranını bozmadan Multi-View Diagnostics bölümünü gösterebilir.
- Calibration, sync veya keypoint verisi eksikse sistem fake başarı üretmez; status/fallback reason açıkça raporlanır.
- Final animation primary WHAM'dan geliyorsa `quality_report_json` bunu `primaryCameraFallbackUsed: true` ve `finalAnimationSource: "primary_wham"` ile belirtir.
- Accepted optimized dual output final olursa `quality_report_json` `finalAnimationSource: "true_dual_solve"`, `reconstructionUsedForConstraints: true`, `optimizedBvhAvailable: true` ve `optimizedSolvedMotionAvailable: true` alanlarını taşır.
- `motion_pipeline_report_json.finalAnimationSource` final BVH kaynağını açıkça belirtir.

## Prototype / Future Remaining Pieces

- Live dual-camera capture ve real-device QA hâlâ fiziksel cihaz doğrulaması ister.
- Audio/native sync production seviyesine taşınmamıştır.
- Gerçek calibration clip, AprilTag/checkerboard veya human-pose calibration solver hâlâ sonraki fazdır.
- Triangulated 3D constraints WHAM'in içine multi-view loss olarak bağlanmamıştır.
- WHAM primary video initialization / motion prior olarak kalır.
- Separate `kinematic_post_fit` optimizer triangulated joint track'i constraint/correction layer olarak kullanabilir.
- Accepted optimized dual solve yalnızca strict gate'ler, optimized solved motion validation, optimized BVH validation ve artifact persistence başarıyla tamamlanınca final BVH olabilir.
- Current optimizer full SMPL-space değildir ve optimized SMPL parameters üretmez.
- Mevcut dual/pro stage Move.ai seviyesinde kalite iddiası değildir; real-device QA tamamlanmadan production quality improvement iddia edilmemelidir.

## Why Backend Multi-Video Reconstruction Is Not Complete Yet

Backend artık dual/pro işler için diagnostic reconstruction artifact ve metric üretebilir. Ancak final motion solving hâlâ primary WHAM yolundadır. Worker normalized video paths listesini WHAM adapter'a geçirir, fakat Python WHAM adapter actual WHAM inference için ilk videoyu kullanır:

- `backend/src/worker/processJob.ts` passes multiple paths via `normalizedVideoPaths`.
- `backend/worker/model_adapters/wham_solver.py` selects `args.video[0]` for actual WHAM inference.

Therefore, dual/pro jobs are currently:

- multi-video grouped,
- multi-video normalized,
- labeled as `dual_camera` or `multi_view`,
- can produce diagnostic multi-view reconstruction artifacts and metrics,
- but final BVH is not yet generated from a true dual-camera solve.

Target production path artık kısmen diagnostic olarak kuruludur; eksik olan bölüm bu path'in final WHAM/SMPL solve'a gerçek constraint veya direct fitting girdisi olarak bağlanmasıdır:

```text
normalized videos
  -> per-camera 2D pose extraction
  -> frame synchronization
  -> camera calibration/projection matrix generation
  -> DLT triangulation
  -> reconstruction artifacts
  -> triangulated joint track
  -> WHAM primary-video initialization
  -> separate kinematic post-fit optimizer
  -> strict acceptance gates
  -> optimized final BVH only if accepted
  -> primary WHAM fallback otherwise
```

## Existing Single-Camera WHAM Pipeline Points To Preserve

These must stay backward compatible:

- Existing API endpoints in `backend/src/http/routes.ts`.
- Existing job states:
  - `queued`
  - `ingesting`
  - `extracting_frames`
  - `solving_motion`
  - `cleaning`
  - `exporting`
  - `succeeded`
  - `failed`
  - `canceled`
- Existing single-camera artifact keys and export formats:
  - `smpl_parameters_json`
  - `raw_solved_motion_json`
  - `solved_motion_json`
  - `cleanup_report_json`
  - `quality_report_json`
  - `preview_summary_json`
  - `motion_pipeline_report_json`
  - `wham_overlay_preview_mp4`
  - `bvh`
- Existing `quality_report.v1` shape for single-camera consumers.
- Existing WHAM/SMPL/BVH validation behavior.
- Existing mobile upload/process/result flow.

## Main Files To Touch

Backend:

- `backend/src/worker/types.ts`
- `backend/src/worker/processJob.ts`
- `backend/src/config.ts`
- `backend/src/worker/export/exportValidation.ts`
- `backend/src/worker/export/premiumMotionSolver.ts`
- `backend/worker/model_adapters/wham_solver.py`
- `backend/src/services/validators.ts`
- `backend/src/infra/db/repositories.ts`
- `backend/migrations/*.sql`

New backend modules:

- `backend/src/worker/pose/poseExtraction.ts`
- `backend/src/worker/reconstruction/frameSync.ts`
- `backend/src/worker/reconstruction/cameraCalibration.ts`
- `backend/src/worker/reconstruction/triangulation.ts`
- `backend/src/worker/reconstruction/multiViewReconstruction.ts`

Mobile/UI hardening:

- `src/domain/mocap/models/CaptureMetadata.ts`
- `src/features/capture/domain/CaptureMetadataBuilder.ts`
- `src/features/capture/hooks/useRecorder.ts`
- `src/features/upload/data/SignedUrlUploadManager.ts`
- `src/features/exports/screens/ExportResultScreen.tsx`
- `src/infra/api/MocapApiClient.ts`

QA:

- `backend/src/qa/goldenE2e.ts`
- `backend/src/qa/whamFixtureJob.ts`
- `backend/src/qa/whamLiveApiJob.ts`
- `backend/qa/golden-samples.example.json`

## Single-Camera Protection Guards

- Keep single-camera protected, but set `ENABLE_MULTI_VIEW_RECONSTRUCTION=true` explicitly in the worker runtime when production dual/pro reconstruction QA is being run.
- If `take.captureMode === "solo"`, run the current WHAM path unchanged.
- If feature flag is disabled, dual/pro must continue primary WHAM fallback and report `multi_view_reconstruction_disabled`.
- If feature flag is enabled, reports must show the reconstruction branch was entered, even when pose extraction/sync/calibration/triangulation later fails safely.
- Do not add new mandatory fields to existing single-camera API requests.
- Keep `QualityReport.schema` as `mocap.quality_report.v1`.
- Add multi-view metrics as optional/additive fields.
- Keep current job state names; use timeline metrics/messages for reconstruction subtasks.
- Run single-camera fixture/regression tests after each worker integration step.

---

# 2. WP1-WP12 Sprint/Task Breakdown

## Task 1.1 - Backend Reconstruction Type Contracts

Amaç:

- Multi-camera pipeline artifacts need explicit typed contracts before implementation.
- Worker code should not rely on `any` for reconstruction objects.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/types.ts`

Beklenen çıktı/artifact:

- `PerCameraPoseArtifact`
- `MultiViewSyncReport`
- `CameraCalibrationArtifact`
- `CameraProjection`
- `MultiViewMatchedFrameSet`
- `MultiViewReconstructionArtifact`
- `MultiViewQualityMetrics`
- Optional `QualityReport.multiView`

Kabul kriterleri:

- All new artifact schemas are explicitly typed.
- `npm --prefix backend run typecheck` passes.
- Existing single-camera types remain compatible.
- No reconstruction object requires untyped `any`.

Riskler:

- Changing existing `QualityReport.metrics` too aggressively can break mobile result parsing.
- Use additive fields first.

## Task 2.1 - Per-Camera Pose Extraction Adapter

Amaç:

- True triangulation requires 2D observations from every camera.
- Current WHAM solve returns primary video motion, not per-camera 2D pose artifacts.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/pose/poseExtraction.ts`
- `backend/worker/model_adapters/pose_detector.py`
- optionally `backend/src/config.ts`

Beklenen çıktı/artifact:

- `takes/{takeId}/jobs/{jobId}/pose_frames_device_{deviceIndex}.json`
- Export format: `pose_frames_device_json`

Kabul kriterleri:

- Single camera can produce one per-camera pose artifact when the adapter is invoked.
- Dual camera produces two per-camera pose artifacts.
- Pro mode produces four per-camera pose artifacts.
- Detector failures are reported per device.
- Artifacts are uploaded to object storage.

Riskler:

- If WHAM cannot expose tracked 2D keypoints, a separate detector runtime is required.
- Detector runtime can become a GPU dependency separate from WHAM.
- Must not run this adapter in the existing single-camera WHAM path unless explicitly enabled.

## Task 3.1 - Backend Frame Matching And Sync

Amaç:

- Per-camera frame observations must be aligned to a reference timeline before triangulation.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/reconstruction/frameSync.ts`

Beklenen çıktı/artifact:

- `takes/{takeId}/jobs/{jobId}/multi_view_sync.json`
- Export format: `multi_view_sync_json`

Kabul kriterleri:

- Dual matching uses device 0 as reference.
- Pro matching produces timestamp groups against device 0/front.
- Matching uses tolerance initially around 20-35 ms.
- Sync report includes matched frame count, dropped frame count, offsets, method, confidence, and average time delta.
- Low-confidence sync emits `sync_confidence_low`.

Riskler:

- Device clock offsets may be missing or inaccurate.
- Audio marker support may not exist yet.
- Wrong sync can produce plausible but incorrect 3D points.

## Task 4.1 - Camera Calibration Builder

Amaç:

- DLT triangulation requires projection matrices for every camera.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/reconstruction/cameraCalibration.ts`
- `backend/src/services/validators.ts`
- `src/domain/mocap/models/CaptureMetadata.ts`

Beklenen çıktı/artifact:

- `takes/{takeId}/jobs/{jobId}/camera_calibration.json`
- Export format: `camera_calibration_json`

Kabul kriterleri:

- Projection matrix is produced for every selected camera.
- Metadata intrinsics are used when present.
- FOV/default fallback is explicit when intrinsics are missing.
- Calibration quality score is computed.
- Invalid projection matrices fail with `camera_projection_invalid`.
- Missing required calibration data fails only when the selected pipeline requires calibration.

Riskler:

- Approximate extrinsics from roles/angles are weak.
- FOV fallback may produce high reprojection error.
- Calibration quality must be reported honestly.

## Task 5.1 - Backend DLT Triangulation Module

Amaç:

- Move triangulation from mobile prototype logic into backend worker-owned code.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/reconstruction/triangulation.ts`
- optional test/probe file under backend QA/test path

Beklenen çıktı/artifact:

- Backend-specific triangulation utility.
- Synthetic triangulation test.

Kabul kriterleri:

- Synthetic point from two cameras triangulates with finite coordinates.
- Reprojection error is finite and below threshold for synthetic data.
- Low-confidence landmarks are skipped.
- Invalid projection matrices fail safely.

Riskler:

- Importing mobile domain code directly can couple backend to Metro/app assumptions.
- Recommended V1 is backend-specific copy/port.

## Task 6.1 - Reconstruction Artifact Writer

Amaç:

- Combine per-camera poses, sync groups, and calibration into frame-level 3D reconstruction.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/reconstruction/multiViewReconstruction.ts`
- `backend/src/worker/types.ts`
- `backend/src/infra/db/repositories.ts`

Beklenen çıktı/artifact:

- `takes/{takeId}/jobs/{jobId}/dual_reconstruction.json`
- `takes/{takeId}/jobs/{jobId}/multi_view_reconstruction.json`
- Export formats:
  - `dual_reconstruction_json`
  - `multi_view_reconstruction_json`

Kabul kriterleri:

- Dual mode writes `dual_reconstruction.json`.
- Pro mode writes `multi_view_reconstruction.json`.
- Artifact contains frame-level metrics and aggregate metrics.
- Aggregate metrics include matched frames, dropped frames, reprojection average/P95, triangulated ratio, fallback ratio, and calibration quality.
- Storage/export records are created.

Riskler:

- Current `export_files` has unique `(job_id, format)`.
- Per-camera artifacts with the same format may collide unless artifact identity is extended.

## Task 7.1 - Worker Pipeline Integration

Amaç:

- Add the production reconstruction branch into `WorkerJobProcessor` without changing single-camera behavior.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/processJob.ts`
- `backend/src/config.ts`
- `backend/src/infra/storage/objectStorage.ts`

Beklenen çıktı/artifact:

```text
normalize videos
  -> if single: current WHAM path
  -> if dual/pro + reconstruction enabled:
       -> per-camera pose extraction
       -> sync
       -> calibration
       -> triangulation
       -> reconstruction artifacts
       -> pose_frames.json from reconstruction
       -> WHAM primary-video solve with honest metrics
```

Kabul kriterleri:

- Single-camera behavior remains unchanged.
- Dual/pro jobs produce additional reconstruction artifacts.
- Failed reconstruction has explicit error codes.
- If fallback to primary WHAM is allowed, it is explicit in quality report.

Riskler:

- Changing the `poseArtifact` consumed by cleanup can break BVH generation.
- Reconstruction should be isolated and optional first.

## Task 8.1 - Python WHAM Adapter Honesty Cleanup

Amaç:

- WHAM must not appear to consume all cameras when it only uses the primary video.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/worker/model_adapters/wham_solver.py`
- `backend/src/worker/export/premiumMotionSolver.ts`
- `backend/src/worker/types.ts`

Beklenen çıktı/artifact:

- Solver metrics:
  - `primaryVideoUsed`
  - `additionalVideosProvided`
  - `multiViewConstraintsUsed`
  - `source`

Kabul kriterleri:

- For `dual_camera` and `multi_view`, output metrics clearly say whether WHAM used only the primary video.
- No misleading multi-view claim is made unless reconstruction or constraints are actually used.

Riskler:

- Product/UI copy can overstate the solve quality.
- Metrics must make Path A vs Path B clear.

## Task 9.1 - Quality Report Multi-View Upgrade

Amaç:

- Add true multi-view metrics to `quality_report.json`.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/worker/export/exportValidation.ts`
- `backend/src/worker/types.ts`
- `src/features/exports/screens/ExportResultScreen.tsx`

Beklenen çıktı/artifact:

- `QualityReport.multiView`
- Numeric mirrors in `QualityReport.metrics` for existing mobile-friendly display.

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

Suggested warnings:

- `camera_intrinsics_missing`
- `camera_intrinsics_fov_fallback_used`
- `calibration_quality_low`
- `sync_confidence_low`
- `triangulation_coverage_low`
- `reprojection_error_high`
- `single_camera_solver_fallback_used`

Kabul kriterleri:

- Single-camera quality report remains valid.
- Dual/pro quality reports include multi-view metrics.
- Result screen can display those metrics.
- Golden QA can assert those metrics.

Riskler:

- Changing the score formula too early can regress single-camera.
- Start with additive reporting; adjust score later.

## Task 10.1 - Golden QA

Amaç:

- Prevent regressions and verify reconstruction artifacts.

Değiştirilecek/Oluşturulacak dosyalar:

- `backend/src/qa/goldenE2e.ts`
- `backend/qa/golden-samples.example.json`
- optionally `backend/src/qa/whamFixtureJob.ts`

Beklenen çıktı/artifact:

- Golden QA assertions for dual/pro reconstruction.

Kabul kriterleri:

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

Riskler:

- Real dual/pro fixtures may not exist initially.
- Synthetic or recorded fixture strategy is needed.

## Task 11.1 - Mobile Metadata Hardening

Amaç:

- Reconstruction depends on complete, consistent metadata from every device.

Değiştirilecek/Oluşturulacak dosyalar:

- `src/domain/mocap/models/CaptureMetadata.ts`
- `src/features/capture/domain/CaptureMetadataBuilder.ts`
- `src/features/capture/hooks/useRecorder.ts`
- `src/features/upload/data/SignedUrlUploadManager.ts`
- `backend/src/services/validators.ts`

Beklenen çıktı/artifact:

- Stronger `mocap.capture.v1` validation.
- Backend rejects malformed dual/pro metadata early.

Required metadata:

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

Kabul kriterleri:

- Backend receives complete metadata for every uploaded video.
- Metadata validator rejects malformed dual/pro uploads early.
- Android and iOS produce equivalent capture metadata.

Riskler:

- Existing local capture sessions may use `cap_` ids while backend sessions use `cs_`.
- Dual/pro upload coordination must keep route take id and metadata take id aligned.

## Task 12.1 - Real Device QA

Amaç:

- Validate the full production behavior outside synthetic tests.

Değiştirilecek/Oluşturulacak dosyalar:

- QA checklist/docs.
- Potentially `backend/qa/golden-samples.example.json`.

Beklenen çıktı/artifact:

- Real-device QA report.

Test matrix:

- iOS single camera
- Android single camera
- iOS + iOS dual
- Android + Android dual
- iOS + Android dual
- Pro 4-camera mixed roles if devices are available

Kabul kriterleri:

- Preview starts.
- Recording starts/stops.
- Upload completes.
- Backend waits for all expected videos.
- Sync metrics are non-zero for dual/pro.
- Reconstruction artifact exists.
- Result page shows dual/pro metrics.
- Export artifacts open successfully.

Riskler:

- Network time sync and camera placement vary per environment.
- Intrinsics may be missing on one platform.
- Pro mode may require staged rollout after dual is stable.

---

# 3. Implementation Order

## Recommended Order

1. Add backend reconstruction types and artifact schemas.
   - Start with `backend/src/worker/types.ts`.
   - Add schemas without changing current single-camera artifacts.

2. Add artifact/export DB support for multi-camera artifacts.
   - Current `export_files` unique constraint is `(job_id, format)`.
   - Per-camera artifacts can collide if they share the same format.
   - Add `artifact_name` and optional `metadata jsonb`, or encode device index in format.
   - Preferred migration:
     - add `artifact_name text`
     - backfill `artifact_name = format`
     - unique `(job_id, artifact_name)`
     - keep `format` for UI grouping.

3. Add feature flags.
   - `ENABLE_MULTI_VIEW_RECONSTRUCTION`
   - `ALLOW_PRIMARY_WHAM_FALLBACK`
   - Local backend and RunPod worker env must match for production dual QA.
   - `ALLOW_PRIMARY_WHAM_FALLBACK=true` should remain enabled during QA.

4. Add backend triangulation module with synthetic unit tests.
   - `backend/src/worker/reconstruction/triangulation.ts`
   - Unit-testable without storage, database, or WHAM.

5. Add per-camera pose artifact format and adapter interface.
   - `backend/src/worker/pose/poseExtraction.ts`
   - Adapter can initially target a stub/synthetic fixture for tests, then real detector.

6. Add frame matching/sync module.
   - `backend/src/worker/reconstruction/frameSync.ts`
   - Unit-test timestamp matching and offset behavior.

7. Add calibration builder.
   - `backend/src/worker/reconstruction/cameraCalibration.ts`
   - Unit-test intrinsics path and FOV fallback path.

8. Add reconstruction artifact writer.
   - `backend/src/worker/reconstruction/multiViewReconstruction.ts`
   - Unit-test dual synthetic reconstruction end to end.

9. Integrate reconstruction into `WorkerJobProcessor`.
   - Only after modules are independently tested.
   - Keep single-camera branch unchanged.

10. Update WHAM adapter metrics.
   - `primaryVideoUsed`
   - `additionalVideosProvided`
   - `multiViewConstraintsUsed`

11. Update quality report.
   - Add multi-view metrics only when source is `dual_camera` or `multi_view`.
   - Do not change single-camera scoring in the first implementation.

12. Add export artifact registration.
   - Register pose, sync, calibration, and reconstruction artifacts.

13. Update mobile/API result surface.
   - Result screen should show multi-view metrics.
   - Existing export list/download flow can remain.

14. Run single-camera regression.
   - `npm --prefix backend run typecheck`
   - `npm --prefix backend run qa:wham-fixture`
   - `npm --prefix backend run qa:wham-live-api` when infrastructure is available.

15. Add dual/pro golden QA assertions.

16. Run real-device QA.

---

# 4. Backend Technical Plan

## 4.1 Per-Camera Pose Extraction

### Multi-Camera Job Input Schema

Source of truth:

- `Take.captureMode`
  - `solo`
  - `dual`
  - `pro_4_camera`
- `Take.expectedVideoCount`
- Uploaded `CaptureVideo[]`
- Per-video `captureMetadata`

Suggested explicit process input:

```json
{
  "pipelineMode": "auto",
  "multiView": {
    "enabled": true,
    "fallbackToPrimaryWham": true
  }
}
```

Valid `pipelineMode` values:

- `auto`
- `single_camera_wham`
- `multi_view_reconstruction`

Default behavior:

- `solo` uses current WHAM path.
- `dual` or `pro_4_camera` uses reconstruction only when enabled in the actual worker runtime.
- If disabled, behavior remains current primary-WHAM fallback, but reports must state this.
- If enabled but adapter/calibration/triangulation is not ready, reports must state the concrete failure reason and keep final BVH on primary WHAM unless gates pass.

### Camera/Video/Metadata Relation

Each `CaptureVideo` should map to:

```ts
{
  deviceIndex: number;
  deviceRole: string;
  videoStorageKey: string;
  metadataStorageKey: string;
  normalizedStorageKey: string;
  captureMetadata: CaptureMetadata;
}
```

Required metadata for reconstruction:

- `deviceIndex`
- `deviceRole`
- `captureMode`
- `recordingStartedAt`
- `recordingEndedAt`
- `durationMs`
- `video.fps`
- `video.width`
- `video.height`
- `camera.position`
- `camera.intrinsics`
- `sync.clockOffsetMs`
- `sync.syncMethod`
- `approxCameraAngle` for pro mode
- `calibrationClipId` when applicable

### Pose Extraction Call

Suggested TypeScript API:

```ts
extractPoseFramesForVideo(input: {
  takeId: string;
  jobId: string;
  source: ProcessedSource;
  outputDir: string;
  detector: {
    name: "wham_tracking" | "vitpose" | "mediapipe_pose" | "fixture";
    minConfidence: number;
  };
}): Promise<PerCameraPoseArtifact>
```

Implementation decision:

- If WHAM exposes tracked 2D keypoints, reuse WHAM output.
- If not, use a dedicated 2D detector adapter.
- Keep detector output independent from final SMPL solving so triangulation can be tested directly.

### Pose Output Format

Suggested artifact:

```json
{
  "schema": "mocap.pose_frames_device.v1",
  "takeId": "take_123",
  "jobId": "job_123",
  "cameraId": "device_0",
  "deviceIndex": 0,
  "deviceRole": "front",
  "sourceVideo": {
    "storageKey": "takes/take_123/original/device_0.mov",
    "normalizedStorageKey": "takes/take_123/jobs/job_123/normalized/device_0.mp4",
    "fps": 30,
    "width": 1280,
    "height": 720,
    "durationMs": 10000
  },
  "detector": {
    "name": "vitpose_or_wham_tracking",
    "version": "v1",
    "landmarkSchema": "body_33"
  },
  "frames": [
    {
      "frameIndex": 0,
      "timestampMs": 0,
      "keypoints2d": [
        { "x": 0.5, "y": 0.4 }
      ],
      "confidence": [0.95],
      "poseConfidence": 0.92
    }
  ],
  "quality": {
    "frameCount": 300,
    "detectedFrameCount": 292,
    "missingFrameCount": 8,
    "lowConfidenceFrameCount": 6,
    "averagePoseConfidence": 0.89
  },
  "warnings": []
}
```

### Frame Timestamp Handling

Timestamp source priority:

1. Detector frame timestamp if available.
2. Video PTS if exposed by detector/ffprobe.
3. `frameIndex / fps`.
4. Metadata recording offset.

Rules:

- Timestamp should be in milliseconds.
- Store timestamps per camera before sync.
- Never assume identical frame counts across cameras.

### Confidence Handling

- Per-keypoint confidence controls triangulation eligibility.
- Per-frame `poseConfidence` controls frame-level quality.
- Recommended V1 thresholds:
  - `minKeypointConfidence = 0.3`
  - `minPoseConfidence = 0.4`

### Missing Frame / Low Confidence Behavior

- Missing frames are excluded from sync groups.
- Low-confidence keypoints remain in artifact but are skipped during triangulation.
- Low-confidence frames increment `lowConfidenceFrameCount`.
- If a device detector fails entirely:
  - fail reconstruction with `multi_view_pose_extraction_failed`, or
  - fallback to primary WHAM only if fallback is explicitly allowed.

### Artifact Registration

Storage key:

```text
takes/{takeId}/jobs/{jobId}/pose_frames_device_{deviceIndex}.json
```

Export record:

```ts
{
  format: "pose_frames_device_json",
  artifactName: `pose_frames_device_${deviceIndex}_json`,
  metadata: { deviceIndex, deviceRole }
}
```

If DB is not migrated yet, use unique formats temporarily:

- `pose_frames_device_0_json`
- `pose_frames_device_1_json`
- `pose_frames_device_2_json`
- `pose_frames_device_3_json`

## 4.2 Frame Synchronization

Suggested API:

```ts
matchMultiCameraFrames(input: {
  reference: PerCameraPoseArtifact;
  others: PerCameraPoseArtifact[];
  metadata: CaptureMetadata[];
  toleranceMs: number;
}): {
  matchedFrames: MultiViewMatchedFrameSet[];
  syncReport: MultiViewSyncReport;
}
```

Output:

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
      "method": "metadata_clock_offset",
      "matchedFrameCount": 281,
      "droppedFrameCount": 14,
      "averageTimeDeltaMs": 4.6
    }
  ],
  "metrics": {
    "matchedFrameCount": 281,
    "droppedFrameCount": 14,
    "averageTimeDeltaMs": 4.6,
    "syncConfidence": 0.91
  },
  "warnings": []
}
```

Dual behavior:

- Device 0 is reference.
- Device 1 frames are matched to reference.
- Tolerance starts at 20-35 ms.

Pro behavior:

- Device 0/front is reference.
- Every other camera is matched to reference.
- A timestamp group can contain 2-4 cameras.
- Reconstruction can use best-pair per landmark.

## 4.3 Camera Calibration / Projection Matrices

Suggested API:

```ts
buildCameraCalibration(input: {
  videos: CaptureVideo[];
  metadata: CaptureMetadata[];
  poseArtifacts: PerCameraPoseArtifact[];
}): CameraCalibrationArtifact
```

Output:

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
      "deviceRole": "front",
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

Minimum V1:

- Use metadata intrinsics when available.
- Use FOV fallback when intrinsics are missing.
- Use `deviceRole` and `approxCameraAngle` for initial extrinsics.
- Write fallback warnings and quality metrics.

Production V2:

- Use calibration clips.
- Add robust bundle adjustment.
- Add outlier rejection.
- Validate positive depth and reprojection error distribution.

## 4.4 DLT Triangulation

Suggested API:

```ts
reconstructMultiViewPose(input: {
  source: "dual_camera" | "multi_view";
  matchedFrames: MultiViewMatchedFrameSet[];
  calibration: CameraCalibrationArtifact;
  minConfidence: number;
  maxReprojectionErrorPx: number;
}): MultiViewReconstructionArtifact
```

Dual-camera rules:

- For each matched frame pair:
  - For each landmark:
    - require minimum confidence in both views,
    - triangulate with DLT,
    - compute reprojection error,
    - reject high reprojection error,
    - reject invalid depth.

Pro 4-camera rules:

- For each timestamp group:
  - collect all valid views for each landmark,
  - prefer best pair by confidence, baseline/convergence angle, reprojection error, and visibility,
  - optionally run multi-view least squares when 3+ views are valid,
  - fallback only if explicit and mark fallback source.

Output:

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

## 4.5 Pose Frames Artifact For Downstream Solver

For dual/pro, build final `mocap.pose_frames.v1` from reconstruction:

- `frames[].landmarks`: reference camera 2D landmarks.
- `frames[].worldLandmarks`: triangulated 3D landmarks.
- `detector.name`: `backend_multiview_triangulation`.
- `quality`: detected and triangulated ratios.

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

## 4.6 Motion Solving Strategy

Recommended V1: Path A.

Path A:

- Keep WHAM as primary motion solver.
- Run WHAM on the primary normalized video.
- Use triangulated 3D as quality/constraint signal.
- Use reconstruction for:
  - quality metrics,
  - validation,
  - scale stabilization,
  - root trajectory correction later,
  - future SMPLify constraints.

Path B later:

- Feed reconstructed 3D landmarks into a direct skeleton/SMPL fitting solver.
- This is stronger but requires a real 3D fitting stage.

## 4.7 Quality Report Integration

Single-camera:

- Existing score and report remain unchanged.

Dual/pro:

- Add multi-view metrics when reconstruction exists.
- If reconstruction fails and fallback is allowed, report:
  - `single_camera_solver_fallback_used`
  - `primaryVideoUsed`
  - `additionalVideosProvided`
  - `multiViewConstraintsUsed: false`

Suggested optional structure:

```json
{
  "inputSource": {
    "source": "dual_camera"
  },
  "multiView": {
    "enabled": true,
    "reconstructionUsed": true,
    "primaryVideoWhamFallbackUsed": true,
    "metrics": {
      "syncOffsetMs": -18.3,
      "syncConfidence": 0.91,
      "matchedFrameCount": 280,
      "droppedFrameCount": 14,
      "averageTimeDeltaMs": 5.2,
      "reprojectionErrorPx": 4.1,
      "reprojectionP95Px": 9.7,
      "triangulatedLandmarkRatio": 0.81,
      "fallbackLandmarkRatio": 0.11,
      "calibrationQualityScore": 0.76,
      "intrinsicsFallbackUsed": 1,
      "multiViewQualityGain": 0
    }
  }
}
```

## 4.8 Export Artifact Registration

Suggested formats:

- `pose_frames_device_json`
- `camera_calibration_json`
- `multi_view_sync_json`
- `dual_reconstruction_json`
- `multi_view_reconstruction_json`

Storage keys:

```text
takes/{takeId}/jobs/{jobId}/pose_frames_device_{deviceIndex}.json
takes/{takeId}/jobs/{jobId}/camera_calibration.json
takes/{takeId}/jobs/{jobId}/multi_view_sync.json
takes/{takeId}/jobs/{jobId}/dual_reconstruction.json
takes/{takeId}/jobs/{jobId}/multi_view_reconstruction.json
```

## 4.9 API Surface

Initial implementation:

- Keep existing process endpoint:
  - `POST /api/takes/:takeId/process`
- Existing mobile clients continue working.
- Pipeline selection can be inferred from:
  - `take.captureMode`
  - feature flag
  - preset

Later explicit API:

```json
{
  "preset": "humanoid_bvh_dual_v1",
  "pipelineMode": "multi_view_reconstruction",
  "fallbackToPrimaryWham": true
}
```

Backend validation:

- Reject `pipelineMode: "multi_view_reconstruction"` for `solo`.
- Reject dual if less than 2 uploaded videos.
- Reject pro if less than 4 uploaded videos.

---

# 5. Error Codes

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
- `single_camera_solver_fallback_used`

---

# 6. Acceptance Criteria For The Whole Project

The project is complete when all are true:

1. Single-camera jobs still pass the existing backend flow.
2. Dual jobs require two videos and process both.
3. Pro jobs require four videos and process all four.
4. Per-camera pose artifacts are produced.
5. Frame sync report is produced.
6. Camera calibration artifact is produced.
7. Dual/pro reconstruction artifact is produced.
8. `pose_frames.json` for dual/pro contains triangulated 3D world landmarks or explicitly marked fallback data.
9. `quality_report.json` includes sync, calibration, reprojection, and triangulation coverage metrics.
10. Result screen surfaces multi-view metrics.
11. Golden QA asserts reconstruction artifacts and metric thresholds.
12. Real-device QA is completed on at least one dual-camera setup.

---

# 7. Product Boundary

This plan creates a real multi-view reconstruction foundation.

It does not automatically equal Move.ai-level robustness.

Move.ai-level quality would still need:

- calibrated multi-view datasets,
- stronger camera calibration,
- robust occlusion handling,
- bundle adjustment,
- multi-person disambiguation,
- learned 3D pose priors,
- direct SMPL fitting from multi-view 2D/3D constraints.

Near-term target:

```text
production-grade dual/pro reconstruction foundation
with measurable sync, reprojection, coverage, and quality metrics
while preserving the existing single-camera WHAM pipeline
```
