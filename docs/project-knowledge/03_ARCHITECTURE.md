# 03_ARCHITECTURE

## Overall Architecture Pattern

MocapExpo uses a layered mobile app plus backend-core architecture:

| Layer | Responsibility | Representative files |
| --- | --- | --- |
| App shell | Providers, error boundary, navigation theme, route graph | `src/app/*` |
| Feature UI | Screens and feature-specific components | `src/features/*` |
| Feature state/hooks | Capture orchestration, recording, multi-view sessions, upload UX | `src/features/capture/hooks/*`, `src/features/capture/state/*`, `src/features/upload/*` |
| Domain models/pipeline | Mocap models, smoothing, calibration, triangulation, cleanup, retarget, export | `src/domain/mocap/*` |
| Infrastructure | API client, local persistence, networking, logger | `src/infra/*` |
| Native platform | Camera, pose inference, preview view, video recording | `ios/MocapExpo/pose/*`, `android/app/src/main/java/com/anonymous/MocapExpo/pose/*` |
| Backend API | Project/take/session/upload/job/export orchestration | `backend/src/http/*`, `backend/src/services/*` |
| Backend worker | Heavy processing, reconstruction, solve, cleanup, export validation | `backend/src/worker/*`, `backend/worker/*` |

The repository is not a pure frontend app. The production mocap path spans mobile, backend API, storage, database, worker, and optional GPU model runtime.

## Source Of Truth Split

| Data type | Current source of truth | Notes |
| --- | --- | --- |
| Production capture input | Original video plus `mocap.capture.v1` metadata | Intended source of truth for backend processing |
| Local preview state | Zustand stores | `captureStore`, `multiViewStore` |
| Local debug/review data | Expo FileSystem take folders | `takeRepoFs` writes `meta.json` and chunked JSONL frames |
| Backend records | PostgreSQL | Projects, takes, capture sessions, uploads, jobs, export files |
| Binary artifacts | S3-compatible object storage | Videos, normalized video, pose JSON, solved motion, BVH, quality reports |
| Roadmap | Markdown docs under `docs/` | Not implementation truth until source confirms |

## Layer Responsibilities

### UI Layer

Screens should compose UI, navigation, and feature hooks. They should not duplicate backend contracts or persistence formats.

Key files:

- `src/features/capture/screens/CaptureScreen.tsx`
- `src/features/capture/screens/MultiViewSetupScreen.tsx`
- `src/features/review/screens/*`
- `src/features/upload/screens/*`
- `src/features/exports/screens/*`
- `src/features/projects/screens/*`

### State And Orchestration

Zustand stores hold transient capture and multi-view state:

- `captureStore.ts`: engine/capture status, tracking readiness, latest frame, FPS, thresholds, profile.
- `multiViewStore.ts`: capture mode, host/guest/pro fields, connection state, time sync, calibration, remote frame, triangulation stats.

Hooks coordinate native modules and stores:

- `useWhamCapture.ts`: native camera capture lifecycle, frame smoothing, tracking lock, recorder integration.
- `useRecorder.ts`: local take creation, frame chunk flushing, native video recording, capture metadata build.
- `useMultiViewCapture.ts`: host/guest TCP lifecycle, frame matching, triangulation.

### Domain Layer

Domain code owns mocap concepts and transformation logic:

- Models: `Take`, `PoseFrame`, `CaptureMetadata`, `MultiViewPoseFrame`, `Skeleton`.
- Filtering: One Euro smoother and pose smoother.
- Calibration: capture readiness and stereo calibration.
- Triangulation: timestamp matching and DLT triangulation.
- Review: take analysis, cleanup recommendations, retarget readiness.
- Export: local debug/reference writers and validators.

### Infrastructure Layer

Infrastructure adapts external systems:

- API: `ApiClient.ts`, `MocapApiClient.ts`.
- Persistence: `TakeRepo.fs.ts`, `takeRepoFs.reader.ts`.
- Networking: `PeerHost.ts`, `PeerGuest.ts`, `PeerProtocol.ts`, `TimeSync.ts`.
- File sharing: `TakeExporter.shareFile`.

### Backend API Layer

Fastify routes are thin and delegate to services:

- `backend/src/http/routes.ts`
- `backend/src/services/projectService.ts`
- `backend/src/services/takeService.ts`
- `backend/src/services/captureSessionService.ts`
- `backend/src/services/uploadService.ts`
- `backend/src/services/processingService.ts`
- `backend/src/services/exportService.ts`

Repositories encapsulate PostgreSQL access in `backend/src/infra/db/repositories.ts`.

### Backend Worker Layer

The worker claims queued jobs from the database and executes the processing pipeline in `backend/src/worker/processJob.ts`.

High-level stages:

1. Claim queued job.
2. Download uploaded source videos from object storage.
3. Probe and normalize video with FFmpeg.
4. Run pose detection unless direct WHAM solve is configured.
5. Reconstruct dual-camera or multi-view pose when enough videos exist.
6. Attempt WHAM premium solve when configured, otherwise use built-in humanoid solver.
7. Clean motion and apply foot-locking.
8. Write BVH and validation artifacts.
9. Store exports and mark job/take/session complete.

## Data Flow

### Solo Production Capture

1. `CaptureScreen` starts native camera capture through `useWhamCapture`.
2. `useRecorder.startRecording` creates a local `Take` and starts native video recording through `NativeCameraEngine`.
3. Native iOS/Android records video while pose frames may be persisted locally when `captureFlags.localFrameRecording` is enabled.
4. `useRecorder.stopRecording` stops native video, builds `CaptureMetadata`, validates it, finalizes local frames, and updates local take metadata.
5. `MotionPreviewScreen` or review flow routes to `UploadProgressScreen` when backend processing is enabled and the take has video plus metadata.
6. `SignedUrlUploadManager` creates/uses backend project/take records, gets signed upload URLs, uploads metadata and video, completes upload, then starts a processing job if all expected videos are uploaded.
7. `ProcessingStatusScreen` polls `/api/jobs/:jobId` and updates local `take.remote`.
8. `ExportResultScreen` lists backend export files and fetches signed download URLs.

### Dual/Pro Capture

Dual live capture uses LAN landmark streaming:

- Host: `PeerHost`, `FrameMatcher`, `Triangulator`, `StereoCalibrationWizard`.
- Guest: `PeerGuest`, frame streaming to host, command handling.
- Store: `multiViewStore`.

Backend production dual/pro capture uses uploaded videos:

- `CaptureSessionService` creates/join sessions.
- `UploadService` enforces device registration, device index, role, capture mode, and expected video count.
- Worker selects two videos for `dual` or four videos for `pro_4_camera`.
- Worker emits `smpl_parameters_json` or `smpl_parameters_json`.

## UI Flow

Navigation is centralized in `RootNavigator.tsx`:

- Bottom tabs: Capture, Review, Projects, Exports.
- Stack screens: ProjectDetail, MotionPreview, Review, UploadProgress, ProcessingStatus, Export, ExportResult, MultiViewSetup.

Route constants live in `src/app/navigation/routes.ts`. Future agents should use route constants instead of string duplication where possible.

## State Flow

| State | Owner | Persistence |
| --- | --- | --- |
| Live capture status | `useCaptureStore` | In memory only |
| Live multi-view connection | `useMultiViewStore` | In memory only |
| Recording counters | `useRecorder` refs and local React state | In memory until flushed |
| Local take metadata | `takeRepoFs` | Expo FileSystem |
| Local frame chunks | `takeRepoFs` | JSONL chunk files |
| Remote job status mirror | `take.remote` in local meta | Expo FileSystem |
| Backend job status | `processing_jobs` table | PostgreSQL |

## Dependency Direction

Expected dependency direction:

```text
screens/hooks -> domain services/interfaces -> infra adapters
screens/hooks -> domain models/pipeline
infra adapters -> external systems
backend routes -> services -> repositories/storage
worker -> repositories/storage/model adapters/export code
```

Future agents should avoid making domain models import screens, React Navigation, native modules, backend route handlers, or concrete storage clients.

## Dependency Injection Strategy

Mobile DI is a manual singleton:

- `src/app/di/container.ts` constructs `HttpMocapApiClient`, `ApiMocapSessionService`, `ApiExportService`, and `SignedUrlUploadManager`.
- `env.ts` supplies API base URL, timeout, token provider value, upload retries, and feature flags.

There is no React context for DI yet. Screens import the container directly. If future agents introduce testability improvements, keep the container boundary stable and avoid creating parallel API client singletons.

Backend DI is constructor-based with default concrete repositories/services. This allows injecting fakes for tests, but no automated unit tests are currently confirmed.

## Navigation/Routing Strategy

- Navigation is centralized in `RootNavigator.tsx`.
- Route names are defined in `routes.ts`.
- Params are currently typed locally as `any` or local `RouteParams` objects rather than a global typed navigator.
- Future navigation work should introduce a typed param list instead of adding more `any` params.

## Error Handling Strategy

| Area | Strategy |
| --- | --- |
| App UI crashes | `ErrorBoundary` logs and shows a reset UI |
| Native camera bridge | JS wrappers throw if native module/method missing; native modules reject promises with error codes |
| API client | `ApiClientError` includes status, code, requestId, details, retryable |
| Upload | `UploadManagerError` includes code and retryable flag; failed remote state is mirrored into local take metadata |
| Backend API | `ApiError` maps to structured JSON errors with requestId |
| Worker | Worker catches errors, writes failed job state, updates take/session failed |
| Export validation | Throws on invalid local export, worker fails job on invalid solved motion/BVH/Blender smoke test |

## Logging Strategy

- Mobile uses `console.log`, `console.warn`, and `console.error` throughout entry loading, native bridge, capture, export, and networking code.
- Backend Fastify logger is enabled.
- Worker logs JSON lines with level, message, service, timestamp, and data.
- Processing jobs append timeline events in PostgreSQL.
- No external log aggregation, analytics, or crash reporting integration is confirmed.

## Async/Concurrency Strategy

| Area | Strategy |
| --- | --- |
| Native frame processing | iOS/Android use dedicated module/inference queues and drop/constrain in-flight frames |
| JS pose stream | Event listeners update Zustand and recorder refs; stale closure risks are managed with refs |
| Recording flush | `useRecorder` serializes chunk flushes and schedules follow-up flushes |
| Upload | Sequential metadata/video upload with retries at attempt level |
| Backend API | Async Fastify handlers |
| Worker | Single polling loop per worker process; DB `for update skip locked` prevents duplicate claims |
| Model adapters | Spawn external commands with timeouts |

## Offline/Cache Strategy

- Local takes are retained in Expo FileSystem and can be reviewed locally.
- Upload can be retried with fresh signed URLs while the original local recording remains on device.
- Processing is not offline. Backend, database, object storage, worker, and network are required.
- No formal cache invalidation or background sync framework is confirmed.

## Testing Strategy

Current strategy is weak:

- Root has `typecheck` and `bundle:check`.
- Backend has `typecheck`, `build`, and QA scripts for golden/WHAM flows.
- No root unit test runner, backend unit test runner, snapshot tests, UI tests, or CI workflows were confirmed.
- Worker artifacts include quality reports and Blender smoke test output, which are operational validation mechanisms but not a complete automated test suite.

## Build/Configuration Strategy

- Root mobile scripts are in `package.json`.
- Backend scripts are in `backend/package.json`.
- Expo config is in `app.json`.
- Metro asset config includes GLB/GLTF/FBX in `metro.config.js`.
- iOS uses CocoaPods and removed native vision pod.
- Android uses Gradle, CameraX, and debug signing. Release currently references debug signing config and must not be treated as production release signing.

## Environment Management

Mobile environment variables are read from `globalThis.process.env` in:

- `src/app/config/env.ts`
- `src/features/capture/config/captureFlags.ts`

Backend environment variables are read in:

- `backend/src/config.ts`

Sensitive config exists locally. Future agents must not print or copy actual `.env` values.

## Architecture Rules Future Agents Must Not Break

### What Should Stay Centralized

- Route names in `src/app/navigation/routes.ts`.
- Backend client contract in `src/infra/api/MocapApiClient.ts`.
- API service construction in `src/app/di/container.ts`.
- Capture metadata schema and validation in `CaptureMetadata.ts` and backend validators.
- Backend route registration in `backend/src/http/routes.ts`.
- Processing job state updates through `JobRepository.updateState`.
- Object storage key construction through `objectStorage.ts`.

### What Should Not Be Duplicated

- Do not duplicate API endpoint strings across screens.
- Do not create a second local take repository without a migration plan.
- Do not duplicate capture mode mapping rules. Keep mobile/backend mode translation explicit.
- Do not duplicate upload retry logic outside `SignedUrlUploadManager`.
- Do not duplicate worker artifact schemas outside `backend/src/worker/types.ts` and the consumer UI types.

### What Not To Bypass

- Do not bypass `validateCaptureMetadata` before upload completion.
- Do not bypass `ObjectStorage.assertObject` unless using the explicit backend config flag for known environments.
- Do not start processing before all expected videos are uploaded.
- Do not write worker exports directly without registering `export_files`.
- Do not expose signed upload/download URLs in docs or logs.

### Files To Inspect Before Major Behavior Changes

| Behavior | Inspect first |
| --- | --- |
| Capture lifecycle | `CaptureScreen.tsx`, `useWhamCapture.ts`, `useRecorder.ts`, native `PoseEngineModule` files |
| Video recording | `NativeCameraEngine.ts`, `VideoRecorder.swift`, `PoseCameraSession.kt` |
| Metadata/upload | `CaptureMetadata.ts`, `CaptureMetadataBuilder.ts`, `SignedUrlUploadManager.ts`, `UploadService.ts` |
| Backend job states | `ProcessingStatusScreen.tsx`, `ProcessingService.ts`, `JobRepository`, `processJob.ts` |
| Dual/pro capture | `MultiViewSetupScreen.tsx`, `multiViewStore.ts`, `useMultiViewCapture.ts`, backend capture session service |
| Worker artifacts | `backend/src/worker/types.ts`, `processJob.ts`, `ExportResultScreen.tsx` |
| Export formats | `TakeExporter.ts`, backend `writeBvh`, worker export validation |
