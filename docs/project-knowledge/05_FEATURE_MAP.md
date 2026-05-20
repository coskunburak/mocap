# 05_FEATURE_MAP

## Feature Summary Table

| Feature | User-facing purpose | Main screens/components | State/services | Completion |
| --- | --- | --- | --- | --- |
| App shell and navigation | Open capture/review/projects/export workflows | `RootNavigator`, bottom tabs, stack screens | React Navigation | Implemented |
| Solo capture | Record body motion with one device | `CaptureScreen`, `CameraView`, `OverlaySkeleton`, `RecordControls` | `useWhamCapture`, `useRecorder`, `captureStore` | Implemented |
| Native camera preview | Live camera preview for WHAM video capture | `CameraView`, native `PosePreviewView`, `NativeCameraEngine.ts` | `PoseEngineModule` Swift/Kotlin | Implemented |
| Native video recording | Save original video for backend production path | `useRecorder`, `NativeCameraEngine` | `VideoRecorder.swift`, `PoseCameraSession.kt` | Implemented |
| Local take persistence | Keep local capture metadata and frames | Projects/review/export screens consume local takes | `takeRepoFs`, `takeRepoFs.reader` | Implemented |
| Live 3D avatar preview | Visualize current or replayed motion | `LiveAvatarViewer`, robot GLB asset | `AvatarMotion`, Three.js | Implemented |
| Review hub | List takes needing review | `ReviewHubScreen`, `TakeRow` | `takeRepoFs` | Implemented |
| Motion preview | Play current/local capture on avatar and skeleton | `MotionPreviewScreen` | `readTakeFrames`, `analyzeTakeReview` | Implemented |
| Take review | Trim, clean/inspect, approve, note, save review | `TakeReviewScreen` | `takeRepoFs.updateTakeMeta`, `TakeReviewAnalyzer` | Implemented |
| Projects | Group local takes by project id | `ProjectsListScreen`, `ProjectDetailScreen`, `ProjectCard` | `takeRepoFs` | Implemented local-only |
| Local debug export | Generate local JSON/BVH/glTF/GLB/FBX/USD | `ExportScreen`, `ExportsListScreen` debug action | `TakeExporter`, `useExportTake` | Implemented, debug/reference |
| Backend upload | Upload video and metadata using signed URLs | `UploadProgressScreen` | `SignedUrlUploadManager`, `MocapSessionService` | Implemented |
| Processing status | Poll backend worker job state, retry/cancel | `ProcessingStatusScreen` | `ApiMocapSessionService` | Implemented |
| Backend export result | Display/download backend artifacts and reports | `ExportResultScreen` | `ApiExportService`, signed download URLs | Implemented |
| Dual-camera LAN capture | Host/guest landmark stream, time sync, calibration, live triangulation | `MultiViewSetupScreen`, `StereoCalibrationWizard`, capture debug overlays | `useMultiViewCapture`, `multiViewStore`, `PeerHost`, `PeerGuest` | Partial, needs device QA |
| Pro 4-camera mode | Backend session with four device slots | `MultiViewSetupScreen` Pro 4 tab | `CaptureSessionService`, `multiViewStore` | Partial/scaffolded |
| Backend API | Manage projects/takes/sessions/uploads/jobs/exports | No direct screen, consumed by upload/result/status | Fastify services/repositories | Implemented |
| Worker processing | Convert videos to WHAM/SMPL solved motion and artifacts | Status/result screens show output | `WorkerJobProcessor` | Implemented with WHAM only |
| Analytics/observability | Product analytics and crash reporting | None found | Job timeline/logs only | Not confirmed |
| Monetization | Subscription/paywall/premium gating | None found | None | Not confirmed |

## App Shell And Navigation

- **Purpose**: Provide tab and stack navigation across capture, review, projects, exports, and modal-ish workflow screens.
- **Screens/components**: `RootNavigator`, `TabLabel`, `AppProviders`, `ErrorBoundary`.
- **Entry points**: `index.ts`, `App.tsx`, `src/app/App.tsx`.
- **Risks**: Params are mostly untyped (`any`). Route names should stay centralized in `routes.ts`.

## Solo Capture

- **Purpose**: Start camera preview, countdown, record source video, stop, and route to motion preview/upload.
- **Main screen**: `src/features/capture/screens/CaptureScreen.tsx`.
- **Hooks/state**: `useWhamCapture`, `useRecorder`, `useCaptureStore`.
- **Services**: `NativeCameraEngine`, `takeRepoFs`.
- **Data models**: `Take`, `CaptureMetadata`.
- **Navigation entry**: Bottom tab `routes.Capture`.
- **Completion**: Implemented.
- **Known risks**:
  - `useWhamCapture.startRecording` currently forwards only `takeName`, `projectId`, `chunkFrames`, `trackingProfile`, and `calibration` to `useRecorder.startRecording`, even though `CaptureScreen` passes capture mode/device/session fields. This can prevent dual/pro capture metadata from being persisted correctly.
  - Camera position option in `NativeCameraEngine.startVideoRecording` currently receives `"back"` from `useRecorder` regardless of `CaptureScreen` front/back UI selection.

## Native Camera And Video

- **Purpose**: Native camera preview and original video recording for WHAM upload.
- **iOS files**: `PoseEngineModule.swift`, `PoseCameraSession.swift`, `PosePreviewView.swift`, `VideoRecorder.swift`.
- **Android files**: `PoseEngineModule.kt`, `PoseCameraSession.kt`, `PosePreviewViewManager.kt`.
- **Bridge files**: `NativeCameraEngine.ts`, `NativeCameraEngine.ts`.
- **Dependencies**: CameraX on Android, AVFoundation on iOS.
- **Completion**: Implemented.
- **Known risks**:
  - Native module rebuild required when bridge methods change.
  - Recording and preview share camera resources and need real-device QA.

## Dual-Camera LAN Capture

- **Purpose**: Pair host/guest devices over local TCP, sync clocks, stream landmarks, calibrate stereo, triangulate live frames.
- **Main screen**: `MultiViewSetupScreen`.
- **Main components**: `StereoCalibrationWizard`, `RemotePoseMini`, `MultiViewDebugPanel`.
- **State**: `multiViewStore`.
- **Services**: `PeerHost`, `PeerGuest`, `TimeSync`, `FrameMatcher`, `Triangulator`.
- **Data models**: `MultiViewPoseFrame`, `StereoCalibrationResult`.
- **Navigation entry**: Capture nav sheet -> `routes.MultiViewSetup`; stack route `MultiViewSetup`.
- **Completion**: Partial.
- **Known risks**:
  - Requires devices on same LAN and platform TCP behavior QA.
  - Calibration overlay appears only for host when connection is ready and stereo calibration is absent.
  - Local live triangulated frames are a prototype/reference path; production reconstruction is backend video-based.

## Pro 4-Camera Mode

- **Purpose**: Register four devices to one backend capture session with front/right/back/left placement and shared metadata.
- **Main screen**: `MultiViewSetupScreen` Pro 4 tab.
- **Services**: `container.mocapSessionService.createCaptureSession`, `joinCaptureSession`.
- **Backend files**: `CaptureSessionService`, `CaptureSessionRepository`, migrations.
- **Completion**: Partial/scaffolded.
- **Known risks**:
  - Capture metadata propagation from `CaptureScreen` through `useWhamCapture` to `useRecorder` appears incomplete.
  - Product UX for four simultaneous devices and calibration clips needs real-device testing.

## Local Persistence And Projects

- **Purpose**: Store local takes, group by project id, display recent sessions.
- **Screens**: `ProjectsListScreen`, `ProjectDetailScreen`, shared `TakeRow`.
- **Repository**: `takeRepoFs`.
- **Models**: `Take`, `NewTakeMeta`, `TakeRemoteProcessing`, `TakeReview`.
- **Completion**: Implemented.
- **Known risks**:
  - File-system schema migrations are limited. `TAKE_SCHEMA_VERSION` exists, but no migration framework was found.
  - Legacy MMKV repository exists and can confuse future agents.

## Review And Motion Preview

- **Purpose**: Preview motion, inspect quality, trim, choose raw/cleaned mode, approve or mark needs-work.
- **Screens**: `ReviewHubScreen`, `MotionPreviewScreen`, `TakeReviewScreen`.
- **Domain**: `TakeReviewAnalyzer`, `PoseCleanupPipeline`, `LiveAvatarViewer`.
- **Completion**: Implemented.
- **Known risks**:
  - Analysis is local and may differ from backend quality report.
  - Large frame sets can be expensive to load into JS memory.

## Local Debug Export

- **Purpose**: Generate local motion handoff packages from locally stored pose frames.
- **Screens/components**: `ExportScreen`, `ExportsListScreen`, `ShareButton`, `ExportOptions`.
- **Domain**: `TakeExporter`, `AnimationBake`, `BVHWriter`, `GltfWriter`, `FbxWriter`, `UsdWriter`, `ExportValidator`.
- **Formats**: JSON, BVH, glTF, GLB, FBX, USD.
- **Completion**: Implemented.
- **Known risks**:
  - Production path should prefer backend exports.
  - Local export can be compute/memory heavy on device.
  - Local debug bundle action is feature-flagged by `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG`.

## Backend Upload And Processing

- **Purpose**: Upload original video and capture metadata to backend storage, start processing, show job state.
- **Screens**: `UploadProgressScreen`, `ProcessingStatusScreen`.
- **Services**: `SignedUrlUploadManager`, `MocapSessionService`, backend `UploadService`, `ProcessingService`.
- **Repositories**: `TakeRepository`, `UploadRepository`, `JobRepository`.
- **Completion**: Implemented.
- **Known risks**:
  - Auth is dev/scaffolded.
  - Signed URLs and storage credentials must never be logged or copied.
  - Polling interval is hardcoded in screen logic.

## Backend Export Result

- **Purpose**: List backend-generated export artifacts, read quality/report JSON, play WHAM overlay video, request reprocessing presets.
- **Screen**: `ExportResultScreen`.
- **Service**: `ExportService` and API download-url endpoint.
- **Artifacts consumed**: quality report, preview summary, pipeline report, solved motion, dual/multi reconstruction reports, WHAM overlay preview.
- **Completion**: Implemented.
- **Known risks**:
  - Screen defines local TypeScript copies of backend artifact schemas. Keep in sync with `backend/src/worker/types.ts`.

## Backend API

- **Purpose**: Orchestrate users, projects, takes, capture sessions, device registration, uploads, processing jobs, and export downloads.
- **Routes**: `backend/src/http/routes.ts`.
- **Services**: `ProjectService`, `TakeService`, `CaptureSessionService`, `UploadService`, `ProcessingService`, `ExportService`.
- **Completion**: Implemented.
- **Known risks**:
  - CORS and auth are not production-hardened.
  - No automated API tests confirmed.

## Worker Pipeline

- **Purpose**: Turn uploaded video(s) into WHAM/SMPL solved motion, quality reports, and BVH.
- **Main file**: `backend/src/worker/processJob.ts`.
- **Model adapters**: `wham_solver.py`.
- **Completion**: Implemented with WHAM-only model configuration.
- **Known risks**:
  - Runtime requires FFmpeg/ffprobe and Python dependencies.
  - WHAM production requires licensed assets and GPU runtime not vendored in repo.
  - Worker cleans temp directories; artifact registration must complete before success state.

## Analytics Events

No analytics event facade, naming convention, or SDK usage was confirmed in source. UI copy mentions analytics in one empty-state string, but no implementation was found.
