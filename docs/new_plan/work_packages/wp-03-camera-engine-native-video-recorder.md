# WP03 - CameraEngine ve Native Video Recorder

Ilgili sprint: [Sprint 1](../sprints/sprint-01-native-video-recording-foundation.md)

## Amac

Mevcut pose preview sistemini bozmadan native video recording eklemek.

## Yeni Interface

```ts
export interface CameraEngine {
  startPreview(): Promise<void>;
  stopPreview(): Promise<void>;
  startVideoRecording(options: StartVideoRecordingOptions): Promise<void>;
  stopVideoRecording(): Promise<VideoRecordingResult>;
}
```

## iOS Yapilacaklar

1. `CameraEngineModule.swift` veya mevcut `PoseEngineModule` disinda yeni bir recorder bridge tasarla.
2. `VideoRecorder.swift` olustur.
3. Mevcut `PoseCameraSession` sample buffer akisini analiz et.
4. `AVAssetWriter` ile video file yazma spike'i yap.
5. Recording state machine ekle:
   - idle
   - preparing
   - recording
   - stopping
   - failed
6. File output path olustur:
   - app documents/cache altinda `mocap/videos/{takeId}.mov`
7. Stop sonucunda metadata dondur:
   - local URI
   - duration
   - fps
   - width/height
   - file size
   - codec
8. Preview ve PoseEngine callback'lerini bozmadan ayni anda recording test et.

## Android Yapilacaklar

1. CameraX lifecycle mevcut `PoseCameraSession` ile incelenir.
2. Recorder secimi yap:
   - CameraX `Recorder`
   - veya MediaRecorder
3. Video output ve ImageAnalysis ayni camera lifecycle icinde koordine edilir.
4. File URI ve metadata native bridge'den JS'e dondurulur.
5. Android permission ve lifecycle edge case'leri test edilir.

## Mobile TS Yapilacaklar

1. `src/features/capture/domain/CameraEngine.ts` olustur.
2. `src/features/capture/data/NativeCameraEngine.ts` olustur.
3. Native module availability check ekle.
4. Capture screen henuz tamamen refactor edilmeden recorder hook'a entegre edilebilir bir facade olustur.

## Kabul Kriterleri

- 10-30 saniye video kaydi stabil.
- Pose preview calismaya devam eder.
- Stop recording local video URI dondurur.
- File size > 0.
- Duration metadata makul.
- Recording sirasinda native crash yok.

## Riskler

- `AVAssetWriter` sample timing hatasi bozuk video uretir.
- Android CameraX use-case kombinasyonu cihazdan cihaza farkli davranabilir.
- 60 FPS erken hedeflenirse thermal/performance sorunlari artar.

