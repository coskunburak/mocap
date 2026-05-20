# 06_DATA_MODELS_AND_STATE

## Model And State Overview

The project has three major data domains:

1. Mobile local capture models under `src/domain/mocap/models/`.
2. Mobile UI/runtime state in Zustand stores and React component state.
3. Backend persistent models and worker artifact schemas under `backend/src/domain/` and `backend/src/worker/types.ts`.

## Main Domain Models

| Type | File path | Purpose | Created by | Consumed by | Risks |
| --- | --- | --- | --- | --- | --- |
| `Take` | `src/domain/mocap/models/Take.ts` | Local capture/session metadata | `newTake`, `takeRepoFs.createTake`, `useRecorder` | Projects, review, export, upload, status | Schema version exists but migrations are not confirmed |
| `PoseFrame` | `src/domain/mocap/models/PoseFrame.ts` | Legacy local/debug frame shape | Readers, triangulation prototypes | Overlay/avatar debug utilities | Not a production motion source |
| `CaptureMetadata` | `src/domain/mocap/models/CaptureMetadata.ts` | Production upload metadata schema `mocap.capture.v1` | `CaptureMetadataBuilder`, `useRecorder` | Upload manager and backend validation | Must stay aligned with backend validators |
| `MultiViewPoseFrame` | `src/domain/mocap/models/MultiViewPoseFrame.ts` | Local live dual-camera matched/triangulated frame | `useMultiViewCapture.processLocalFrame` | Recorder and motion preview reader | Local prototype path; backend production uses videos |
| `StereoCalibrationResult` | `MultiViewPoseFrame.ts` | Camera projection/calibration data | `StereoCalibrationWizard` / `calibrateStereo` | `useMultiViewCapture`, take metadata | Calibration quality requires real device validation |
| `SkeletonDef`, `RigNode` | `src/domain/mocap/models/Skeleton.ts` and `BodyPose33.ts` | Humanoid skeleton/rig definitions | Static definitions | Export, avatar, retarget | `DEFAULT_SKELETON.rig` is placeholder-like; production body parameters come from WHAM/SMPL |
| `LandmarkBuffer` | `src/domain/mocap/models/Landmark.ts` | Flat Float32Array `[x,y,z,c]` buffers | Legacy/debug parsers and math | Local preview/debug utilities | Buffer shape must match `LANDMARK_STRIDE` |

## Local Take Model Details

`Take` important fields:

| Field | Meaning |
| --- | --- |
| `id` | Local take id generated from timestamp/random suffix |
| `projectId` | Optional local grouping id |
| `frameCount`, `durationMs`, `avgFps`, `chunkCount` | Local capture stats |
| `schemaVersion` | Current constant `TAKE_SCHEMA_VERSION = 6` |
| `trackingProfile` | `pose` or `holistic` |
| `calibration`, `postProcess`, `retarget`, `review`, `motion` | Local analysis/export metadata |
| `video` | Native recorded video metadata including local URI |
| `captureMetadata` | Upload metadata sent to backend |
| `remote` | Mirror of backend project/take/upload/job status |
| `captureMode` | Mobile enum: `solo`, `dual-camera`, `pro-4-camera` |
| `viewCount` | Expected number of local views/devices |

Creation:

- `newTake` creates default local metadata.
- `takeRepoFs.createTake` writes a take folder and `meta.json`.
- `useRecorder.startRecording` creates the local take.

Consumption:

- Project and review lists call `takeRepoFs.listTakes`.
- Preview/review/export read `meta.json` and frame chunks.
- Upload reads `video` and `captureMetadata`.
- Status screens update `remote`.

## Capture Metadata

`CaptureMetadata` is the upload schema shared between mobile and backend.

Important fields:

| Field | Purpose |
| --- | --- |
| `schema` | Must be `mocap.capture.v1` |
| `takeId`, `captureSessionId` | Link mobile/backend take/session |
| `deviceId`, `deviceRole`, `deviceIndex` | Identify device source |
| `captureMode` | Backend enum: `solo`, `dual`, `pro_4_camera` |
| `multiCameraSessionId`, `approxCameraAngle`, `calibrationClipId` | Optional multi-camera/pro metadata |
| `recordingStartedAt`, `recordingEndedAt`, `durationMs` | Recording timing |
| `video` | FPS, dimensions, codec, orientation, mirrored flag, size, optional local URI |
| `camera` | Lens/intrinsics information when available |
| `quality` | Pose confidence, full-body visibility, bad frames, tracking loss, FPS |
| `sync` | Single-device clock, network sync, audio marker, or manual offset |
| `app` | Version/platform/build metadata |

Validation:

- Mobile: `validateCaptureMetadata` in `src/domain/mocap/models/CaptureMetadata.ts`.
- Backend: `validateCaptureMetadata` in `backend/src/services/validators.ts`.

Risk:

- Mobile and backend validators are separate implementations. Update both whenever schema changes.
- `SignedUrlUploadManager.sanitizeMetadata` strips `video.localUri` before upload.

## DTOs/API Models

Mobile API DTOs are declared in `src/infra/api/MocapApiClient.ts`.

| Type | Purpose |
| --- | --- |
| `ApiProject` | Backend project response |
| `ApiTake` | Backend take response and status |
| `ApiCaptureSession` | Backend capture session response |
| `ApiCaptureDevice` | Registered capture device |
| `ApiUploadTarget` | Signed URL upload target |
| `ApiUploadSession` | Upload session state |
| `ApiProcessingJob` | Processing job state/progress |
| `ApiExportFile` | Export file metadata without signed URL |
| `CreateTakeInput`, `InitUploadInput`, `CompleteUploadInput` | Request bodies |

Backend route/service types are in `backend/src/domain/types.ts` and SQL migrations.

Risk:

- `ExportResultScreen` defines local copies of several worker artifact report types. These should be kept aligned with `backend/src/worker/types.ts`.

## Persistence Models

### Local FileSystem Persistence

Primary repository: `src/infra/persistence/TakeRepo.fs.ts`.

Storage layout:

```text
<Expo documentDirectory>/mocap/takes/<takeId>/
  meta.json
  chunks/
    000000.jsonl
    000001.jsonl
```

Frame JSONL compact fields:

| Field | Meaning |
| --- | --- |
| `ts` | Timestamp |
| `lm` | Pose landmarks |
| `wlm` | World landmarks |
| `flm` | Face landmarks |
| `lhm`, `lhwm`, `rhm`, `rhwm` | Hand landmarks/world landmarks |
| `fbs` | Face blendshapes |
| `psm` | Pose segmentation mask flag |
| `prof`, `rprof` | Tracking profile/request |
| `mv`, `fa`, `fb`, `t3d`, `re`, `are`, `tc`, `td`, `da`, `db` | Multi-view frame extension |

Reader: `takeRepoFs.reader.ts`.

Reader behavior:

- Reads chunk files in sorted order.
- Falls back to legacy `frames.jsonl`.
- Sanitizes duplicate/out-of-order timestamps by dropping frames.
- Converts multi-view frames to `PoseFrame` with `worldLandmarks` set to triangulated data.

### Legacy MMKV Persistence

`src/infra/persistence/takeRepo.ts` and `storage.ts` provide an MMKV-based take repository. Current screens use `takeRepoFs`, not this repository. Treat MMKV take storage as legacy/scaffolded unless source usage changes.

## Backend Database Models

Defined by migrations and `backend/src/domain/types.ts`.

| Table/type | Purpose |
| --- | --- |
| `users` | Minimal user record keyed by token/user id |
| `projects` | Project grouping |
| `takes` | Backend take state, capture mode, expected video count |
| `capture_sessions` | Multi-device capture sessions and join tokens |
| `capture_devices` | Registered devices and slots |
| `upload_sessions` | Signed upload attempts |
| `capture_videos` | Per-device uploaded video and metadata record |
| `processing_jobs` | Worker queue and state |
| `job_timeline_events` | Append-only job events |
| `export_files` | Backend artifacts stored in object storage |
| `audit_logs` | Table exists, but active repository usage not confirmed |

## Worker Artifact Models

Declared in `backend/src/worker/types.ts`.

| Schema | Purpose | Produced by |
| --- | --- | --- |
| `mocap.pose_frames.v1` | WHAM-normalized internal motion frames | `premiumMotionSolver`, `wham_solver.py` |
| `mocap.smpl_parameters.v1` | SMPL body pose, shape, camera, joints, mesh, and SMPLify metadata | `premiumMotionSolver`, `wham_solver.py` |
| `mocap.solved_motion.v1` | Solved humanoid motion | WHAM adapter and cleanup |
| `mocap.cleanup_report.v1` | Cleanup/foot-locking metrics and actions | `motionCleanup` |
| `mocap.preview_summary.v1` | Compact preview metrics | `exportValidation` |
| `mocap.motion_pipeline_report.v1` | End-to-end engine/artifact/quality summary | `processJob` |
| `mocap.quality_report.v1` | Overall quality grade, metrics, validation | `exportValidation` |

## UI State Models

| State type | File | Important fields | Persistence |
| --- | --- | --- | --- |
| `CaptureState` | `captureStore.ts` | `status`, `engineState`, `trackingState`, `readyForRecording`, `lastFrame`, `recentFrames`, thresholds, profile | In memory |
| `MultiViewState` | `multiViewStore.ts` | `captureMode`, `peerRole`, `connectionState`, session ids, pro device data, sync/calibration, remote frame, triangulation stats | In memory |
| `RecorderState` | `useRecorder.ts` | `idle`, `recording`, `stopping`, active take, buffer count, flushed chunks | React state/refs |
| Upload progress | `UploadManager.ts` | stage, progress, attempt, message, remote ids | React state |
| Processing job state | `MocapApiClient.ts`, backend type | state, preset, progress, message, timeline | Backend DB and local `take.remote` mirror |

## Serialization/Deserialization

- No `zod`, `io-ts`, `json_serializable`, `freezed`, or Codable-based shared schema generation was found.
- Mobile uses manual TypeScript types plus manual validation.
- Backend uses manual validators.
- Local frames are custom compact JSONL.
- Backend artifacts are JSON files stored in object storage and registered in `export_files`.

## Model Relationships

```text
Local Take
  has many frame chunks
  may have video metadata
  may have captureMetadata
  may mirror remote project/take/job state

Backend Project
  has many Takes

Backend Take
  has expectedVideoCount
  has many CaptureVideos
  has many ProcessingJobs
  has many ExportFiles
  may be linked to CaptureSession

CaptureSession
  has expectedDeviceCount
  has many CaptureDevices
  has uploaded CaptureVideos through UploadSessions

ProcessingJob
  has many TimelineEvents
  produces ExportFiles
```

## Validation Rules

Important validation rules:

- `CaptureMetadata.schema` must be `mocap.capture.v1`.
- Backend capture mode must be `solo`, `dual`, or `pro_4_camera`.
- Mobile capture mode is `solo`, `dual-camera`, or `pro-4-camera`.
- Device index must be non-negative and below expected video/device count.
- Pro 4-camera sessions require exactly four expected devices.
- Uploads require both video and metadata to be uploaded before completion.
- Upload object sizes are checked by object storage HEAD unless disabled by config.
- Processing cannot start until all expected videos are uploaded.
- Worker solved motion and BVH must pass validation before success.

## Migration/Versioning

| Area | Current state |
| --- | --- |
| Local take schema | `TAKE_SCHEMA_VERSION = 6`; no formal migration runner found |
| Backend DB | SQL migrations in `backend/migrations/` |
| Capture metadata | Schema string `mocap.capture.v1` |
| Worker artifacts | Schema strings on each artifact |
| API versioning | No URL versioning; docs mention API contract v1 under `docs/api/api-contract-v1.md` |

## State Management Risks

- Capture state, recorder refs, native camera state, and FileSystem writes are tightly coupled during recording.
- `useWhamCapture.startRecording` does not currently forward all `StartRecordingOptions` to `useRecorder`, risking wrong capture mode/device metadata.
- Local `take.remote` mirrors backend job status but can become stale if processing changes outside the app session.
- MMKV repository and FileSystem repository both exist; future agents must avoid mixing them without migration.
