# WP05 - Capture Metadata Schema

Ilgili sprintler: [Sprint 0](../sprints/sprint-00-architecture-freeze-audit.md), [Sprint 1](../sprints/sprint-01-native-video-recording-foundation.md), [Sprint 8](../sprints/sprint-08-dual-camera-backend-session.md)

## Amac

Her video upload'u ile birlikte backend processing icin yeterli metadata gondermek.

## Schema V1 Alanlari

- `schema`
- `takeId`
- `captureSessionId`
- `deviceId`
- `deviceRole`
- `deviceIndex`
- `recordingStartedAt`
- `recordingEndedAt`
- `durationMs`
- `video`
  - fps
  - width
  - height
  - codec
  - orientation
  - isMirrored
  - fileSizeBytes
- `camera`
  - position
  - focalLengthMm
  - intrinsics
  - lensModel
- `quality`
  - averagePoseConfidence
  - fullBodyVisibleRatio
  - badFrames
  - trackingLossCount
  - poseFpsAverage
- `sync`
  - syncMethod
  - clockOffsetMs
  - audioSyncMarker
- `app`
  - version
  - platform
  - buildNumber

## Yapilacaklar

1. `CaptureMetadata` TypeScript type tanimla.
2. Backend schema modelini ayni alanlarla tanimla.
3. Metadata builder implement et.
4. Metadata validation yaz.
5. Dual-camera ek alanlarini opsiyonel olarak ekle:
   - captureMode
   - multiCameraSessionId
   - approxCameraAngle
   - calibrationClipId
6. Metadata object storage key naming belirle.

## Kabul Kriterleri

- Her upload icin video ve metadata birlikte tamamlanmadan `UploadSession` complete olmaz.
- Backend eksik zorunlu alanlarda anlamli validation error dondurur.
- Worker metadata'dan fps/orientation/duration okuyabilir.
- Dual-camera icin deviceIndex ve syncMethod saklanir.

## Riskler

- Device time drift dual-camera sync'i bozabilir; metadata tek basina yeterli degil, audio/visual sync gerekecek.
- Camera intrinsics V1'de null olabilir; worker buna hazir olmali.

