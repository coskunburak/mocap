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

## Optional Phase 3.1 Fields

All Phase 3.1 sync/calibration fields are optional and additive. Older uploads without these fields remain valid.

| Field | Location | Current source |
| --- | --- | --- |
| `cameraId`, `cameraRole` | root | Mobile builder derives from device/camera role when known. |
| `recordingStartWallClockMs` | root | Native iOS/Android recording start wall-clock when available; mobile can derive from `startedAt`. |
| `recordingStartMonotonicMs` | root | Native iOS/Android local monotonic clock at recording start. Not comparable across devices without clock sync metadata. |
| `firstFrameTimestampMs` | root and `video` | iOS video sample timestamp when available. |
| `framePresentationTimestampsMs` | root and `video` | iOS video sample PTS values when available. Android does not provide per-frame PTS yet. |
| `frameCount` | root and `video` | iOS recorded frame count; Android uses container metadata when retrievable. |
| `resolution`, `width`, `height`, `fps` | root and/or `video` | Mobile/native recording result. |
| `serverReceivedAtMs` | root | Backend upload completion time. |
| `networkClockOffsetMs`, `manualOffsetMs` | root and/or `sync` | Optional sync metadata. Missing values are diagnostic, not fatal. |
| `hasAudioTrack`, `audioSampleRate` | root and/or `video` | Native recorder currently records video only, so audio sync must not be claimed. |
| `cameraIntrinsics`, `intrinsicMatrixK` | root and/or `camera` | Optional only. Native recorders do not currently provide real intrinsics. |
| `lensDistortion`, `focalLength`, `sensorSize` | root and/or `camera` | Optional only. Native recorders do not currently provide distortion/sensor metadata. |
| `approximateCameraAngle` | root | Optional placement hint for dual/pro capture. |

## Phase 3.1 Availability Audit

| Question | Current answer |
| --- | --- |
| Recorder captures audio? | No. iOS uses a video-only `AVAssetWriterInput`; Android CameraX recording does not call `withAudioEnabled()`. |
| Upload includes `cameraId`? | Yes when mobile builder creates it; old payloads may omit it. |
| Upload includes `deviceId`? | Yes in current upload contract. |
| Upload includes camera/device role? | Yes as `deviceRole`; `cameraRole` is optional. |
| Recording wall-clock start? | Yes as ISO `recordingStartedAt`; Phase 3.1 also adds optional `recordingStartWallClockMs`. |
| Recording monotonic start? | Native iOS/Android now expose optional local monotonic start. |
| First frame timestamp? | Optional; iOS can expose it, Android does not yet. |
| Per-frame presentation timestamps? | Optional; iOS can expose them, Android does not yet. |
| FPS, width, height, duration? | Yes. |
| Frame count? | Optional; iOS provides it, Android preserves it only when container metadata exposes it. |
| iOS intrinsics/lens metadata? | Not currently emitted by the recorder. |
| Android intrinsics/lens metadata? | Not currently emitted by the recorder. |
| Lens distortion coefficients? | Not currently emitted by either platform. |
| Backend preserves fields? | Yes. `capture_metadata` stores the full JSON payload plus backend `serverReceivedAtMs`. |
| Backend discards unknown metadata? | No; validator checks required V1 shape and preserves the object. |
| `manualOffsetMs` can be added later? | Yes; it is optional and tolerated under root or `sync`. |
| Server/upload timing metadata? | Yes, optional `serverReceivedAtMs` is added on upload completion. |
| Network clock offset metadata? | Optional `networkClockOffsetMs` is represented but only real client-provided values should be used. |
