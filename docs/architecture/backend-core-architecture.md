# Backend-Core Architecture

## Target Model

```text
Mobile App
  - Records original video files.
  - Builds capture metadata.
  - Runs on-device pose only for preview and quality checks.
  - Uploads video + metadata.
  - Displays backend job status and export files.

Backend API
  - Authenticates users.
  - Owns projects, takes, capture sessions, uploads, jobs, and exports.
  - Issues short-lived signed upload/download URLs.
  - Enforces access control and state transitions.

Object Storage
  - Private S3-compatible bucket.
  - Stores original videos, metadata, normalized video, worker artifacts, and exports.

Processing Worker
  - Consumes queued jobs.
  - Normalizes video and extracts frames.
  - Runs pose detection and motion solving.
  - Produces quality reports and export artifacts.
```

## Source Of Truth

Production source:

```text
takes/{takeId}/original/device_{deviceIndex}.{mov|mp4}
takes/{takeId}/metadata/device_{deviceIndex}.json
```

Debug/reference source:

```text
local pose JSONL chunks
local mobile BVH/GLB/FBX/USD export
dual-camera landmark stream prototype
```

## Entity Ownership

| Entity | Owner | Notes |
| --- | --- | --- |
| User | Backend | Token subject. |
| Project | Backend | User-owned project namespace. |
| CaptureSession | Backend | Groups one or more device captures. |
| Take | Backend | User/project scoped capture unit. |
| CaptureDevice | Backend | Device identity and role in a session. |
| CaptureVideo | Backend | Storage keys, metadata, and upload state. |
| UploadSession | Backend | Short-lived upload authorization. |
| ProcessingJob | Backend/Worker | Backend creates; worker advances state. |
| ExportFile | Backend/Worker | Worker creates artifacts; backend signs downloads. |
| QualityReport | Worker | Stored as job/take artifact. |

## State Rules

1. `Take.status` starts as `created`.
2. Upload init creates a private object key and an `UploadSession`.
3. Upload complete validates required video + metadata parts before marking `CaptureVideo` as `uploaded`.
4. Processing can start only when the take has at least one complete capture video.
5. Workers are the only actor allowed to move a job into terminal `succeeded` or `failed` states.
6. Export files are exposed only through expiring download URLs.

