# 07_BACKEND_AND_INTEGRATIONS

## Integration Summary

| Integration | Purpose | Main configuration | Service/classes | Status |
| --- | --- | --- | --- | --- |
| Custom Fastify backend | Projects, takes, sessions, uploads, jobs, exports | `backend/src/config.ts`, `backend/src/http/routes.ts` | Backend services/repositories | Active |
| PostgreSQL | Persistent backend records and worker queue | `DATABASE_URL` read by `backend/src/config.ts` | `pool`, repositories | Active |
| S3-compatible storage | Video, metadata, normalized video, exports | S3 env names in `backend/src/config.ts` | `ObjectStorage` | Active |
| MinIO | Local S3-compatible development storage | `backend/docker-compose.yml` | Same `ObjectStorage` path | Active local |
| Mobile API client | App-to-backend calls | `src/app/config/env.ts` | `ApiClient`, `HttpMocapApiClient` | Active |
| Upload signed URLs | Direct mobile-to-storage PUT uploads | Backend upload routes, `ObjectStorage.signedPutUrl` | `SignedUrlUploadManager`, `UploadService` | Active |
| Native camera | Preview and original video recording on device | Native iOS/Android build files | `PoseEngineModule`, `PoseCameraSession`, `VideoRecorder` | Active |
| WHAM/SMPL/SMPLify | Required production motion solver | WHAM env names in `backend/src/config.ts` | `premiumMotionSolver.ts`, `wham_solver.py` | Active |
| FFmpeg/ffprobe | Worker video normalization/probing | `FFMPEG_PATH`, `FFPROBE_PATH` | `videoPipeline.ts` | Active requirement |
| Blender | Optional export smoke validation | `BLENDER_PATH`, `REQUIRE_BLENDER_SMOKE_TEST` | `blenderSmokeTest.ts` | Optional |
| RunPod | WHAM GPU deployment path | deployment docs and worker Docker files | `runpod-wham-handler.py`, Dockerfiles | Documented/scaffolded |
| React Native TCP | Dual-camera host/guest LAN protocol | package deps/native build | `PeerHost`, `PeerGuest` | Active prototype |
| Firebase/Supabase/Appwrite | Not confirmed | none found | none | Not confirmed |
| Payments/subscriptions | Not confirmed | none found | none | Not confirmed |
| Push notifications | Not confirmed | none found | none | Not confirmed |

## Custom Backend API

Purpose:

- Own backend records for projects, takes, capture sessions, upload sessions, processing jobs, and export files.
- Enforce upload state and expected video count before worker processing.
- Issue signed upload and download URLs.

Configuration files:

- `backend/src/config.ts`
- `backend/src/server.ts`
- `backend/src/http/routes.ts`
- `backend/migrations/*.sql`

Route groups:

| Route | Purpose |
| --- | --- |
| `GET /health` | Health check |
| `POST /api/projects`, `GET /api/projects` | Project create/list |
| `POST /api/projects/:projectId/takes` | Backend take creation |
| `POST /api/projects/:projectId/capture-sessions` | Multi-device capture session creation |
| `POST /api/capture-sessions/join` | Join by token |
| `GET /api/capture-sessions/:captureSessionId` | Capture session/device status |
| `POST /api/capture-sessions/:captureSessionId/devices/register` | Device registration |
| `GET /api/takes/:takeId` | Backend take lookup |
| `POST /api/takes/:takeId/uploads/init` | Create upload session and signed URLs |
| `POST /api/takes/:takeId/uploads/complete` | Validate uploaded objects and metadata |
| `POST /api/takes/:takeId/process` | Create processing job |
| `GET /api/jobs/:jobId` | Job status/timeline |
| `POST /api/jobs/:jobId/retry` | Retry failed/canceled job |
| `POST /api/jobs/:jobId/cancel` | Cancel active job |
| `GET /api/takes/:takeId/exports` | Export file list |
| `GET /api/exports/:exportId/download-url` | Signed download URL |

Error handling:

- Backend throws `ApiError` variants from `backend/src/domain/errors.ts`.
- `server.ts` converts them to structured JSON with `code`, `message`, optional details, and request id.
- Unknown errors become `internal_error`.

Security notes:

- Auth is not production-grade. `auth.ts` treats a bearer token as a user id and has a dev fallback.
- CORS currently allows any origin.
- Do not expose bearer tokens, `.env` values, signed URLs, storage keys, or private backend URLs.

## PostgreSQL

Purpose:

- Backend source of truth for project/take/session/upload/job/export records.
- Worker queue via `processing_jobs`.
- Job timeline via `job_timeline_events`.

Configuration:

- `DATABASE_URL` is required by `backend/src/config.ts`.
- SQL migrations live in `backend/migrations/`.
- Migration runner: `backend/scripts/migrate.cjs`.

Core repository:

- `backend/src/infra/db/postgres.ts`
- `backend/src/infra/db/repositories.ts`

Tables:

- `users`
- `projects`
- `takes`
- `capture_sessions`
- `capture_devices`
- `upload_sessions`
- `capture_videos`
- `processing_jobs`
- `job_timeline_events`
- `export_files`
- `audit_logs`

Retry/offline behavior:

- Worker uses `for update skip locked` to claim queued jobs.
- No external queue service is confirmed.
- If worker is down, queued jobs remain in DB.

## S3-Compatible Object Storage

Purpose:

- Store original uploaded video.
- Store uploaded capture metadata.
- Store normalized videos.
- Store worker artifacts and exports.

Configuration:

- S3 endpoint/region/bucket/access key/secret/TTL/timeout are read in `backend/src/config.ts`.
- Local MinIO is defined in `backend/docker-compose.yml`.

Service:

- `backend/src/infra/storage/objectStorage.ts`

Data flow:

1. Backend creates object keys through `videoStorageKey`, `metadataStorageKey`, `artifactStorageKey`.
2. Backend issues signed PUT URLs.
3. Mobile uploads metadata JSON and video directly to storage.
4. Backend validates object presence/size on upload completion.
5. Worker downloads source objects and uploads output artifacts.
6. App requests signed download URLs for export files.

Security notes:

- Signed URLs are temporary credentials. Do not log or store them in docs.
- Object keys are not secrets, but can reveal project/take/job structure.
- Storage credentials are secrets and must stay in environment/config files only.

## Mobile Backend Client

Purpose:

- Typed API adapter used by mobile app.

Files:

- `src/infra/api/ApiClient.ts`
- `src/infra/api/MocapApiClient.ts`
- `src/domain/mocap/services/MocapSessionService.ts`
- `src/domain/mocap/services/ExportService.ts`
- `src/app/di/container.ts`

Error handling:

- `ApiClientError` includes HTTP status, backend code, request id, details, retryable flag.
- GET requests are retried on timeout/network/408/429/5xx.
- POST/PUT upload flows use explicit retry behavior in `SignedUrlUploadManager`.

Security notes:

- The token provider reads mobile env config and sends `Authorization: Bearer <token>`.
- Current backend treats this token as a user id. Do not assume production authentication.

## Signed URL Upload

Purpose:

- Avoid sending large videos through Fastify.
- Let mobile upload original source video and metadata directly to object storage.

Files:

- `src/features/upload/data/SignedUrlUploadManager.ts`
- `src/features/upload/domain/UploadManager.ts`
- `backend/src/services/uploadService.ts`

Data flow:

1. Validate local take has `video.localUri` and `captureMetadata`.
2. Ensure/create backend project and backend take.
3. Initialize upload for device index/role and content metadata.
4. Upload sanitized metadata JSON.
5. Upload video using Expo FileSystem upload task.
6. Complete upload with sizes and metadata.
7. If all expected videos are uploaded, create processing job.

Retry behavior:

- Upload manager retries entire attempts with fresh signed URLs.
- Some upload failures are non-retryable, such as missing local file or missing metadata.

## Native Camera Integration

Purpose:

- Live camera preview and source video recording for WHAM upload.

iOS:

- `ios/MocapExpo/pose/PoseEngineModule.swift`
- `ios/MocapExpo/pose/PoseCameraSession.swift`
- `ios/MocapExpo/pose/VideoRecorder.swift`
- `ios/Podfile`

Android:

- `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseEngineModule.kt`
- `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseCameraSession.kt`
- `android/app/build.gradle`

Bridge:

- `src/domain/mocap/pipeline/pose/NativeCameraEngine.ts`

Data flow:

- Native emits camera status events and records the source video.
- `useWhamCapture` coordinates readiness, countdown, and recording state.

## Backend WHAM/SMPL/SMPLify

- `backend/src/worker/export/premiumMotionSolver.ts`
- `backend/worker/model_adapters/wham_solver.py`
- `docs/deployment/runpod_wham_worker.md`

Security/licensing notes:

- WHAM repo, checkpoints, SMPL assets, and related licensed assets are not vendored in this repo.
- Production WHAM runtime requires external setup. Do not add licensed assets or private model files to the repo.
- `WHAM_PRECOMPUTED_OUTPUT_PKL` is documented as QA/demo-only and must not be enabled for production worker deployments.

## Worker Reconstruction And Export

Purpose:

- Convert uploaded videos into production artifacts.

Key files:

- `backend/src/worker/processJob.ts`
- `backend/src/worker/export/premiumMotionSolver.ts`
- `backend/src/worker/cleanup/motionCleanup.ts`
- `backend/src/worker/export/bvhWriter.ts`
- `backend/src/worker/export/exportValidation.ts`

Artifacts:

- `smpl_parameters_json`
- `raw_solved_motion_json`
- `solved_motion_json`
- `cleanup_report_json`
- `quality_report_json`
- `preview_summary_json`
- `motion_pipeline_report_json`
- `wham_overlay_preview_mp4`
- `bvh`

## Third-Party SDKs Not Confirmed

The following were searched and not confirmed in repository source:

- Firebase Auth/Analytics/Crashlytics/Remote Config.
- Supabase.
- Appwrite.
- Stripe.
- RevenueCat.
- StoreKit/IAP.
- Expo notifications, FCM, APNs push integration.
- Sentry, Bugsnag, or another crash reporting SDK.

## What Not To Expose

Never expose:

- `backend/.env` values.
- Database URLs.
- S3 access keys or secret keys.
- Signed upload/download URLs.
- Bearer tokens.
- Private backend URLs.
- Certificates, provisioning profiles, `.p8`, `.p12`, keystores, or signing passwords.
- Licensed WHAM/SMPL asset paths if they identify private infrastructure.
