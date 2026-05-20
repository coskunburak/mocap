# Sprint 03-05 Production Implementation

Source plan:

- `docs/new_plan/new_plan.md`
- `docs/new_plan/sprints/sprint-03-mobile-upload-processing-status.md`
- `docs/new_plan/sprints/sprint-04-worker-v1-pose-extraction.md`
- `docs/new_plan/sprints/sprint-05-backend-export-v1.md`
- `docs/new_plan/work_packages/wp-08-mobile-api-client-env-config.md`
- `docs/new_plan/work_packages/wp-09-upload-manager.md`
- `docs/new_plan/work_packages/wp-10-processing-status-ux.md`
- `docs/new_plan/work_packages/wp-11-worker-queue-job-consumer.md`
- `docs/new_plan/work_packages/wp-12-video-normalization-frame-extraction.md`
- `docs/new_plan/work_packages/wp-13-removed_pose_runtime-pose-extraction.md`
- `docs/new_plan/work_packages/wp-14-backend-export-core-v1.md`
- `docs/new_plan/work_packages/wp-15-skeleton-definition-rotation-solve.md`
- `docs/new_plan/work_packages/wp-17-export-validation-blender-smoke-test.md`
- `docs/new_plan/work_packages/wp-18-result-preview-export-result-ux.md`
- `docs/new_plan/work_packages/wp-20-cost-operations-observability.md`

## Production Flow

```text
Native recording stop
  -> local Take has video + mocap.capture.v1 metadata
  -> UploadProgressScreen uploads metadata JSON and source video with signed URLs
  -> Backend marks upload complete and creates processing job
  -> ProcessingStatusScreen polls job state
  -> Worker claims queued job from Postgres queue
  -> Worker downloads source video from object storage
  -> FFmpeg normalizes the video
  -> removed pose runtime Python detector emits pose_frames.json
  -> Skeleton core emits solved_motion.json
  -> BVH writer emits result.bvh
  -> Quality report and validation artifacts are stored
  -> ExportResultScreen lists/downloads backend export files
```

## Work Package Mapping

| Work package | Implementation |
| --- | --- |
| WP08 | `src/app/config/env.ts`, `src/infra/api/ApiClient.ts`, typed `MocapApiClient` retry/error handling |
| WP09 | `SignedUrlUploadManager`, metadata/video upload split, progress callback, retry and local remote-state persistence |
| WP10 | `ProcessingStatusScreen`, backend status labels, polling, retry/cancel actions |
| WP11 | Postgres-backed queue claim via `JobRepository.claimNextQueued()` and `backend/src/worker/index.ts` |
| WP12 | `probeVideo()` and `normalizeVideo()` FFmpeg/FFprobe pipeline |
| WP13 | `backend/worker/pose_detector.py` removed pose runtime detector and `pose_frames.json` schema |
| WP14 | Worker export artifacts: `pose_frames.json`, `solved_motion.json`, `quality_report.json`, `result.bvh` |
| WP15 | `mocap_humanoid_v1` skeleton definition, finite-guarded landmark-to-rotation solve |
| WP17 | Lightweight BVH validation plus optional headless Blender smoke test via `BLENDER_PATH` |
| WP18 | `ExportResultScreen` lists backend export files and opens signed download URLs |
| WP20 | Duration/FPS/width limits, structured worker logs, timeline events, retry/cancel controls |

## Runtime Requirements

Backend API:

```bash
npm --prefix backend run migrate
npm --prefix backend run dev
```

Worker:

```bash
python3 -m pip install -r backend/worker/requirements.txt
npm --prefix backend run worker:dev
```

Optional Blender validation:

```bash
BLENDER_PATH=/path/to/blender REQUIRE_BLENDER_SMOKE_TEST=true npm --prefix backend run worker:dev
```

If `REQUIRE_BLENDER_SMOKE_TEST=false`, Blender failures become warnings in `quality_report.json`. If it is `true`, the job fails before exports are marked ready.

## Production Boundaries

- Mobile production export does not call the local `TakeExporter`.
- Local mobile export remains behind `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG=true`.
- Mobile pose frames remain a preview/quality/debug signal, not the final animation source.
- Single-camera world landmarks are still model-estimated depth, not multi-view reconstruction. Dual/pro camera reconstruction remains Sprint 8-10 scope.
