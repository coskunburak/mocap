# API Contract V1

Base path: `/api`

Authentication: `Authorization: Bearer <token>`. Local development may use `dev-user-id` as the token subject.

## Error Shape

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Human readable message.",
    "details": {
      "field": "takeId"
    },
    "requestId": "req_..."
  }
}
```

## Status Enums

Upload session:

```text
pending -> video_uploaded -> metadata_uploaded -> completed
pending -> expired
pending -> failed
```

Processing job:

```text
queued -> ingesting -> extracting_frames -> solving_motion
  -> cleaning -> exporting -> succeeded

queued|ingesting|extracting_frames|solving_motion|cleaning|exporting -> failed
queued -> canceled
```

## Projects

### `POST /api/projects`

Request:

```json
{ "name": "Demo Project" }
```

Response `201`:

```json
{
  "project": {
    "id": "prj_...",
    "name": "Demo Project",
    "createdAt": "2026-05-06T12:00:00.000Z",
    "updatedAt": "2026-05-06T12:00:00.000Z"
  }
}
```

### `GET /api/projects`

Response `200`:

```json
{ "projects": [] }
```

## Takes

### `POST /api/projects/{projectId}/takes`

Request:

```json
{
  "name": "Front Take 1",
  "captureMode": "solo",
  "expectedVideoCount": 1
}
```

Response `201`:

```json
{
  "take": {
    "id": "take_...",
    "projectId": "prj_...",
    "name": "Front Take 1",
    "status": "created",
    "captureMode": "solo",
    "expectedVideoCount": 1
  }
}
```

### `GET /api/takes/{takeId}`

Returns the take, capture videos, upload sessions, latest job, and exports visible to the caller.

## Uploads

### `POST /api/takes/{takeId}/uploads/init`

Request:

```json
{
  "deviceIndex": 0,
  "deviceRole": "primary",
  "video": {
    "contentType": "video/quicktime",
    "fileName": "take.mov",
    "fileSizeBytes": 48211200
  },
  "metadata": {
    "contentType": "application/json",
    "fileName": "metadata.json",
    "fileSizeBytes": 4096
  }
}
```

Response `201`:

```json
{
  "uploadSession": {
    "id": "upl_...",
    "takeId": "take_...",
    "deviceIndex": 0,
    "expiresAt": "2026-05-06T12:15:00.000Z",
    "status": "pending"
  },
  "video": {
    "storageKey": "takes/take_.../original/device_0.mov",
    "uploadUrl": "http://...",
    "headers": { "content-type": "video/quicktime" }
  },
  "metadata": {
    "storageKey": "takes/take_.../metadata/device_0.json",
    "uploadUrl": "http://...",
    "headers": { "content-type": "application/json" }
  }
}
```

### `POST /api/takes/{takeId}/uploads/complete`

Request:

```json
{
  "uploadSessionId": "upl_...",
  "videoUploaded": true,
  "metadataUploaded": true,
  "videoSizeBytes": 48211200,
  "metadataSizeBytes": 4096,
  "captureMetadata": {}
}
```

Response `200`:

```json
{
  "uploadSession": { "id": "upl_...", "status": "completed" },
  "captureVideo": { "id": "vid_...", "status": "uploaded" },
  "take": { "id": "take_...", "status": "uploaded" }
}
```

## Processing

### `POST /api/takes/{takeId}/process`

Request:

```json
{ "preset": "humanoid_bvh_v1" }
```

Response `201`:

```json
{
  "job": {
    "id": "job_...",
    "takeId": "take_...",
    "state": "queued",
    "progress": 0,
    "timeline": []
  }
}
```

### `GET /api/jobs/{jobId}`

Response `200`:

```json
{
  "job": {
    "id": "job_...",
    "state": "exporting",
    "progress": 82,
    "message": "Generating BVH.",
    "timeline": []
  }
}
```

## Exports

### `GET /api/takes/{takeId}/exports`

Response `200`:

```json
{ "exports": [] }
```

### `GET /api/exports/{exportId}/download-url`

Response `200`:

```json
{
  "downloadUrl": "http://...",
  "expiresAt": "2026-05-06T12:15:00.000Z"
}
```

## Limits

| Limit | V1 value |
| --- | --- |
| Max duration | 180 seconds |
| Max video size | 750 MB |
| Upload URL TTL | 15 minutes |
| Download URL TTL | 10 minutes |
| Max expected videos | 4 |
