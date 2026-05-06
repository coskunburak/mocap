# Capture Metadata V1

Schema id: `mocap.capture.v1`

Each uploaded video must have one metadata JSON object. Missing mandatory metadata keeps the upload session incomplete.

```json
{
  "schema": "mocap.capture.v1",
  "takeId": "take_...",
  "captureSessionId": "cap_...",
  "deviceId": "ios-device-id",
  "deviceRole": "primary",
  "deviceIndex": 0,
  "captureMode": "solo",
  "recordingStartedAt": "2026-05-06T12:00:00.000Z",
  "recordingEndedAt": "2026-05-06T12:00:12.000Z",
  "durationMs": 12000,
  "video": {
    "fps": 30,
    "width": 1080,
    "height": 1920,
    "codec": "h264",
    "orientation": "portrait",
    "isMirrored": false,
    "fileSizeBytes": 48211200,
    "localUri": "file:///..."
  },
  "camera": {
    "position": "back",
    "focalLengthMm": null,
    "intrinsics": null,
    "lensModel": "wide"
  },
  "quality": {
    "averagePoseConfidence": 0.86,
    "fullBodyVisibleRatio": 0.92,
    "badFrames": 8,
    "trackingLossCount": 1,
    "poseFpsAverage": 29.4
  },
  "sync": {
    "syncMethod": "single_device_clock",
    "clockOffsetMs": 0,
    "audioSyncMarker": null
  },
  "app": {
    "version": "1.0.0",
    "platform": "ios",
    "buildNumber": "1"
  }
}
```

## Storage Keys

```text
takes/{takeId}/original/device_{deviceIndex}.mov
takes/{takeId}/metadata/device_{deviceIndex}.json
takes/{takeId}/normalized/device_{deviceIndex}.mp4
takes/{takeId}/exports/{preset}/result.bvh
```

## Required Fields

Required: `schema`, `takeId`, `captureSessionId`, `deviceId`, `deviceRole`, `deviceIndex`, `recordingStartedAt`, `recordingEndedAt`, `durationMs`, `video`, `quality`, `sync`, and `app`.

Camera intrinsics and focal length may be `null` in V1. Workers must handle missing intrinsics by using single-camera model assumptions or failing with `metadata_intrinsics_required` only when a pipeline explicitly requires calibration.

