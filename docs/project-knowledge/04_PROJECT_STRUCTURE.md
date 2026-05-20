# 04_PROJECT_STRUCTURE

## Readable Project Tree Summary

Generated/build folders intentionally omitted: `.git`, `node_modules`, `ios/Pods`, build outputs, `.expo`, local artifacts, caches.

```text
.
├── App.tsx
├── index.ts
├── app.json
├── package.json
├── tsconfig.json
├── metro.config.js
├── src/
│   ├── app/
│   ├── assets/
│   ├── domain/mocap/
│   ├── features/
│   ├── infra/
│   ├── ui/
│   ├── types/
│   └── utils/
├── backend/
│   ├── migrations/
│   ├── scripts/
│   ├── src/
│   ├── worker/
│   ├── qa/
│   ├── docker-compose.yml
│   └── package.json
├── ios/
│   ├── MocapExpo/
│   ├── Podfile
│   └── MocapExpo.xcodeproj / MocapExpo.xcworkspace
├── android/
│   ├── app/
│   ├── build.gradle
│   └── settings.gradle
├── assets/
└── docs/
```

## Entry Points

| Path | Layer | Purpose |
| --- | --- | --- |
| `index.ts` | App entry | Registers the Expo root component |
| `App.tsx` | App entry | Loads `src/app/App` through guarded `require` |
| `src/app/App.tsx` | App shell | Wraps `RootNavigator` in `AppProviders` |
| `src/app/providers/AppProviders.tsx` | App shell | Gesture handler root, safe area, status bar, error boundary |
| `src/app/navigation/RootNavigator.tsx` | Navigation | Bottom tabs and stack route graph |
| `backend/src/index.ts` | Backend API entry | Builds Fastify server and handles shutdown |
| `backend/src/worker/index.ts` | Worker entry | Polls queued processing jobs |

## Core Folders

| Folder/file | Responsibility | Main classes/functions | Layer |
| --- | --- | --- | --- |
| `src/app/config/env.ts` | Mobile runtime config and flags | `env` | Core config |
| `src/app/di/container.ts` | API/service/upload manager construction | `container` | Core DI |
| `src/app/navigation/` | Route names and navigator | `RootNavigator`, `routes` | Core navigation |
| `src/app/providers/` | App-level providers and crash fallback | `AppProviders`, `ErrorBoundary` | Core UI |
| `src/ui/theme/` | Colors, spacing, typography | `colors`, `spacing`, `typography`, `radii` | Design system |
| `src/ui/components/` | Reusable UI primitives | `Button`, `Card`, `Modal`, `Screen` | Design system |
| `src/infra/api/` | Mobile backend API adapter | `ApiClient`, `HttpMocapApiClient` | Infrastructure |
| `src/infra/persistence/` | Local take persistence | `takeRepoFs`, `readTakeFrames`, `readTakeMeta`, legacy `takeRepo` | Infrastructure |
| `src/infra/networking/` | Dual-camera LAN protocol | `PeerHost`, `PeerGuest`, `PeerProtocol`, `TimeSync` | Infrastructure |
| `src/domain/mocap/models/` | Domain data types | `Take`, `PoseFrame`, `CaptureMetadata`, `MultiViewPoseFrame` | Domain |
| `src/domain/mocap/pipeline/` | Mocap math and transforms | calibration, triangulation, filter, cleanup, retarget, export | Domain |

## Feature Folders

| Folder | Purpose | Important files | Completion |
| --- | --- | --- | --- |
| `src/features/capture/` | Live capture, native preview, recording, dual/pro setup | `CaptureScreen.tsx`, `MultiViewSetupScreen.tsx`, `useWhamCapture.ts`, `useRecorder.ts`, `captureStore.ts`, `multiViewStore.ts` | Implemented/partial for multi-camera |
| `src/features/upload/` | Upload original video and metadata, show progress | `SignedUrlUploadManager.ts`, `UploadProgressScreen.tsx`, `ProcessingStatusScreen.tsx` | Implemented |
| `src/features/review/` | Review queue, motion preview, take review | `ReviewHubScreen.tsx`, `MotionPreviewScreen.tsx`, `TakeReviewScreen.tsx` | Implemented |
| `src/features/projects/` | Project grouping from local takes | `ProjectsListScreen.tsx`, `ProjectDetailScreen.tsx`, `ProjectCard.tsx`, `TakeRow.tsx` | Implemented local grouping |
| `src/features/exports/` | Export queue, local debug export, backend result screen | `ExportsListScreen.tsx`, `ExportScreen.tsx`, `ExportResultScreen.tsx` | Implemented |
| `src/features/takes/` | Shared take helpers | `takeStatus.ts`, `useExportTake.ts` | Implemented |

## Domain Pipeline Folders

| Folder | Purpose | Main files |
| --- | --- | --- |
| `pipeline/pose/` | JS wrapper for native camera capture | `NativeCameraEngine.ts` |
| `pipeline/filter/` | Smoothing landmarks | `PoseSmoother.ts`, `OneEuroFilter.ts` |
| `pipeline/calibration/` | Capture readiness and stereo calibration | `CalibrationAnalyzer.ts`, `StereoCalibration.ts` |
| `pipeline/triangulation/` | Frame matching and 3D triangulation | `FrameMatcher.ts`, `Triangulator.ts` |
| `pipeline/review/` | Review analysis and recommendations | `TakeReviewAnalyzer.ts` |
| `pipeline/cleanup/` | Local cleanup path | `PoseCleanupPipeline.ts` |
| `pipeline/retarget/` | Retargeting math and presets | `RetargetSolver.ts`, `BoneMap.ts`, `Quaternion.ts`, `RotationMath.ts` |
| `pipeline/avatar/` | Live avatar motion solve | `AvatarMotion.ts` |
| `pipeline/export/` | Local debug/reference export writers | `TakeExporter.ts`, `AnimationBake.ts`, writers and validators |

## Backend Structure

| Folder/file | Purpose | Layer |
| --- | --- | --- |
| `backend/src/config.ts` | Backend env parsing, limits, worker config | Configuration |
| `backend/src/server.ts` | Fastify setup, CORS, error handler | API core |
| `backend/src/http/routes.ts` | Route registration | API routes |
| `backend/src/http/auth.ts` | Dev bearer token handling | Auth scaffold |
| `backend/src/services/` | Business logic and validation | Service layer |
| `backend/src/infra/db/` | PostgreSQL pool and repositories | Data layer |
| `backend/src/infra/storage/` | S3-compatible object storage adapter | Data layer |
| `backend/src/domain/` | Backend domain types/errors/state machine | Backend domain |
| `backend/src/worker/` | Job processor, WHAM solve, cleanup, export | Worker |
| `backend/worker/` | WHAM Python adapter and Docker assets | Worker runtime |
| `backend/migrations/` | SQL schema migrations | Database |
| `backend/qa/` and `backend/src/qa/` | Golden and WHAM QA runners | QA tooling |

## Native Platform Folders

| Folder | Purpose | Important files |
| --- | --- | --- |
| `ios/MocapExpo/pose/` | Swift native camera, preview, video recording bridge | `PoseEngineModule.swift`, `PoseCameraSession.swift`, `VideoRecorder.swift` |
| `ios/Podfile` | iOS dependencies | Build config |
| `android/app/src/main/java/com/anonymous/MocapExpo/pose/` | Kotlin native camera, preview, video recording bridge | `PoseEngineModule.kt`, `PoseCameraSession.kt` |
| `android/app/build.gradle` | Android dependencies, CameraX, signing, build config | Build config |

## Configuration Folders

| Path | Purpose | Notes |
| --- | --- | --- |
| `app.json` | Expo app config, bundle ids, dark style, plugin list | No secrets should be stored here |
| `metro.config.js` | Metro asset extension config | Adds GLB/GLTF/FBX |
| `tsconfig.json` | Root TS strict config | Excludes backend |
| `backend/tsconfig.json` | Backend TS config | CommonJS output to `dist` |
| `backend/docker-compose.yml` | Local Postgres/MinIO development infra | Contains development-only credentials; do not reuse production values |
| `backend/.env*` | Backend env examples and local env | Sensitive values must not be exposed |

## Test Folders And QA Tooling

| Path | Purpose | Status |
| --- | --- | --- |
| `backend/src/qa/goldenE2e.ts` | Backend golden E2E runner | Active script |
| `backend/src/qa/whamFixtureJob.ts` | WHAM fixture validation | Active script |
| `backend/src/qa/whamLiveApiJob.ts` | Live API WHAM validation | Active script |
| `backend/qa/golden-samples.example.json` | Example golden sample manifest | Example/test resource |
| Root app test folders | Not found | Not confirmed |
| Backend unit test folders | Not found | Not confirmed |

## Tooling Folders

| Path | Purpose |
| --- | --- |
| `docs/new_plan/` | Roadmap, sprint plans, work packages |
| `docs/migration/` | Migration notes from local/mobile export toward backend-core |
| `docs/processing/` | Worker/job state docs |
| `docs/deployment/` | RunPod/WHAM worker deployment docs |
| `docs/project-knowledge/` | NotebookLM-oriented project knowledge package |

## Files Future Agents Should Inspect First

1. `docs/project-knowledge/18_PROJECT_STATUS_CHECKPOINT.md`
2. `docs/project-knowledge/13_AI_AGENT_GUIDE.md`
3. `src/app/navigation/RootNavigator.tsx`
4. `src/features/capture/screens/CaptureScreen.tsx`
5. `src/features/capture/hooks/useWhamCapture.ts`
6. `src/features/capture/hooks/useRecorder.ts`
7. `src/infra/api/MocapApiClient.ts`
8. `backend/src/http/routes.ts`
9. `backend/src/worker/processJob.ts`
10. `backend/src/config.ts`
