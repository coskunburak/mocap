# 01_PROJECT_OVERVIEW

## App Identity

| Item | Current repository evidence |
| --- | --- |
| App name | `MocapExpo`, from `app.json`, `package.json`, and native project names |
| Platform | React Native mobile app targeting iOS and Android, with native Swift and Kotlin camera modules |
| Framework | Expo SDK 54, React Native 0.81, React 19, TypeScript |
| Backend | Node.js Fastify API plus a separate TypeScript worker and Python model adapters under `backend/` |
| Domain | Markerless motion capture, pose reconstruction, motion cleanup, review, and export |

## Main Purpose

MocapExpo is a mobile-first markerless motion capture application. The mobile app captures original video, stores local takes, uploads production sources to a backend, tracks processing jobs, previews solved motion, and exposes export files such as BVH and JSON artifacts.

The production path is a backend-core mocap pipeline where original video plus capture metadata become the source of truth and WHAM/SMPL/SMPLify is the only supported solver stack.

## Target Users

Inferred from product docs and UI copy:

| User group | Likely need |
| --- | --- |
| Animators and 3D artists | Capture body motion and export animation data for DCC tools |
| Game developers | Generate humanoid BVH or related formats for engines and pipelines |
| Small studios and creators | Use phones instead of dedicated mocap suits or optical stages |
| Internal QA/operators | Validate capture quality, backend worker output, and model deployment readiness |

## Business And Product Goal

The repository points to a production-grade markerless mocap direction:

- Capture with one phone, two phones, or a planned/partial four-camera setup.
- Upload original video and metadata to a backend.
- Process video with WHAM/SMPL/SMPLify, cleanup, and export validation.
- Return downloadable motion artifacts and quality reports to the app.

Monetization is not confirmed in repository. No subscription, paywall, StoreKit, RevenueCat, Stripe, or in-app purchase integration was found.

## Main User Flows

| Flow | Current implementation evidence | Status |
| --- | --- | --- |
| App launch | `index.ts` -> `App.tsx` -> `src/app/App.tsx` -> `RootNavigator` | Implemented |
| Solo capture | `CaptureScreen`, `useWhamCapture`, `useRecorder`, native `PoseEngineModule`, `NativeCameraEngine` | Implemented |
| Dual-camera LAN setup | `MultiViewSetupScreen`, `PeerHost`, `PeerGuest`, `TimeSync`, `useMultiViewCapture` | Partial, requires live device QA |
| Pro 4-camera backend session | `MultiViewSetupScreen` creates/joins backend capture sessions with four slots | Partial/scaffolded in mobile UI and backend |
| Local take storage | `takeRepoFs` stores `meta.json` plus JSONL chunks under Expo FileSystem document directory | Implemented |
| Review and preview | `ReviewHubScreen`, `MotionPreviewScreen`, `TakeReviewScreen`, `LiveAvatarViewer` | Implemented |
| Backend upload | `UploadProgressScreen`, `SignedUrlUploadManager`, backend upload API | Implemented |
| Processing status | `ProcessingStatusScreen`, backend jobs, worker DB polling | Implemented |
| Export result view | `ExportResultScreen`, export list/download-url API, `expo-video` overlay preview | Implemented |
| Local debug export | `TakeExporter`, local format writers, gated in UI by `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG` | Implemented as debug/reference path |

## Main Features

- Native camera preview and recording on iOS/Android.
- Native camera preview and video recording bridge.
- Live 2D skeleton overlay including pose, face, and hand overlays when available.
- Live 3D robot avatar retargeting with React Three Fiber and a local GLB asset.
- Zustand capture state for tracking readiness, FPS, thresholds, and profile.
- File-system take persistence with chunked JSONL pose frame storage.
- Review workflow with raw/cleaned playback, trim ranges, approval status, quality score, and notes.
- Local export writers for JSON, BVH, glTF, GLB, FBX, and USD.
- Backend API for projects, takes, capture sessions, uploads, processing jobs, retries, cancelation, export listing, and signed download URLs.
- Backend worker pipeline for video ingest, normalization, WHAM/SMPL/SMPLify solve, cleanup, BVH export, Blender smoke test, and quality reports.
- S3-compatible object storage integration, intended for MinIO locally and S3-compatible production storage.
- Optional/production deployment docs for WHAM GPU worker and RunPod.

## Current Maturity Level

Current maturity is active productionization, not fully release-hardened.

Evidence:

- Core app, backend, worker, native modules, upload, processing, and export result paths exist.
- Roadmap docs describe backend-core migration work, some of which is now implemented.
- There are no confirmed unit test suites in the root app or backend.
- Authentication is a lightweight bearer-token-to-user-id mechanism, not production auth.
- Android release configuration currently signs release builds with debug signing config.
- A local `backend/.env` exists in the working copy; values must not be copied into docs or prompts.

## Important App Modules

| Module | Purpose | Key paths |
| --- | --- | --- |
| App shell | Providers, error boundary, navigation | `src/app/App.tsx`, `src/app/providers/*`, `src/app/navigation/*` |
| Capture | Camera preview, recording, quality, dual/pro UI | `src/features/capture/*` |
| Domain mocap | Models, smoothing, calibration, triangulation, cleanup, retarget, export | `src/domain/mocap/*` |
| Persistence | Local take metadata and frame chunks | `src/infra/persistence/TakeRepo.fs.ts`, `src/infra/persistence/takeRepoFs.reader.ts` |
| API client | Mobile backend contract | `src/infra/api/ApiClient.ts`, `src/infra/api/MocapApiClient.ts` |
| Upload | Signed URL upload orchestration | `src/features/upload/*` |
| Review | Motion preview and take review UI | `src/features/review/*` |
| Exports | Backend result UI and local debug export UI | `src/features/exports/*`, `src/domain/mocap/pipeline/export/*` |
| Backend API | Fastify routes/services/repositories | `backend/src/server.ts`, `backend/src/http/routes.ts`, `backend/src/services/*`, `backend/src/infra/db/*` |
| Worker | Processing pipeline and model adapters | `backend/src/worker/*`, `backend/worker/*` |

## External Services Used

| Service/category | Evidence | Current status |
| --- | --- | --- |
| PostgreSQL | `backend/migrations/*.sql`, `backend/src/infra/db/postgres.ts` | Active backend database |
| S3-compatible storage | `backend/src/infra/storage/objectStorage.ts` | Active for uploads/exports |
| MinIO | `backend/docker-compose.yml` | Local development storage |
| WHAM/SMPL/SMPLify | `backend/src/worker/export/premiumMotionSolver.ts`, `backend/worker/model_adapters/wham_solver.py`, deployment docs | Required backend motion path |
| RunPod | `docs/deployment/runpod_wham_worker.md`, worker Docker files | Deployment path documented |
| Firebase/Supabase/Appwrite | No usage found | Not confirmed in repository |
| Analytics/crash reporting | No SDK usage found | Not confirmed in repository |

## What This App Is Not

- Not a simple camera filter or social media effect app.
- Not currently a consumer subscription app.
- Not currently a fully authenticated SaaS product.
- Not currently a web app, despite Expo web script support.
- Not currently a pure local-only tool, because the production path is backend-owned.

## Current Source Of Truth

For implementation status, source code is the source of truth:

- `src/`
- `backend/src/`
- native modules under `ios/MocapExpo/pose/` and `android/app/src/main/java/com/anonymous/MocapExpo/pose/`
- `package.json`, `backend/package.json`, `app.json`, native build files, migrations

Roadmap files under `docs/new_plan/`, `docs/migration/`, and production plans are useful for direction but must not be treated as implemented unless the source files confirm it.

## Important Files To Inspect First

| Area | Inspect first |
| --- | --- |
| App entry | `index.ts`, `App.tsx`, `src/app/App.tsx` |
| Navigation | `src/app/navigation/RootNavigator.tsx`, `src/app/navigation/routes.ts` |
| Dependency container | `src/app/di/container.ts` |
| Runtime env | `src/app/config/env.ts`, `backend/src/config.ts` |
| Capture flow | `src/features/capture/screens/CaptureScreen.tsx`, `src/features/capture/hooks/useWhamCapture.ts`, `src/features/capture/hooks/useRecorder.ts` |
| Native camera/pose | `src/domain/mocap/pipeline/pose/NativeCameraEngine.ts`, iOS/Android native pose files |
| Persistence | `src/infra/persistence/TakeRepo.fs.ts`, `src/infra/persistence/takeRepoFs.reader.ts` |
| Backend contract | `src/infra/api/MocapApiClient.ts`, `backend/src/http/routes.ts` |
| Worker pipeline | `backend/src/worker/processJob.ts` |
| Export/result UI | `src/features/exports/screens/ExportResultScreen.tsx` |

## What Future Agents Should Understand Before Editing

- Production mocap source is intended to be original video plus `mocap.capture.v1` metadata, not mobile-estimated pose chunks.
- Local pose frame storage and local `TakeExporter` are still active and useful, but are debug/reference surfaces for production decisions.
- Any API contract change must update both `src/infra/api/MocapApiClient.ts` and `backend/src/http/routes.ts`/service validators.
- Capture metadata touches native recording, `useRecorder`, upload, backend validation, reconstruction, and worker artifact reports.
- Dual/pro capture has multiple mode names: mobile `dual-camera`/`pro-4-camera` and backend/API `dual`/`pro_4_camera`.
- Do not expose values from `backend/.env`, signed URLs, storage credentials, tokens, certificates, or signing files.
