# Sprint 1 - Native Video Recording Foundation

Kaynak bolum: [new_plan.md - Sprint 1](../new_plan.md#sprint-1---native-video-recording-foundation)

## Amac

Mobil uygulamanin gercek video dosyasi uretebilmesini saglamak. Bu, backend-core mimarinin ilk teknik blocker'idir.

## Kapsam

- `CameraEngine` TypeScript interface'i.
- iOS native `VideoRecorder` implementasyonu.
- Android native video recorder implementasyonu.
- Preview + pose inference + video recording'in ayni capture lifecycle icinde calismasi.
- Local video path result.
- Basic video metadata extraction.
- Recording start/stop error handling.

## Kapsam Disi

- Backend upload.
- Processing job.
- BVH export.
- Dual-camera recording.

## Ilgili Is Paketleri

- [WP03 - CameraEngine ve Native Video Recorder](../work_packages/wp-03-camera-engine-native-video-recorder.md)
- [WP04 - PosePreview Quality Mode](../work_packages/wp-04-pose-preview-quality-mode.md)
- [WP05 - Capture Metadata Schema](../work_packages/wp-05-capture-metadata-schema.md)

## Teknik Kararlar

iOS icin onerilen yol `AVAssetWriter`:

- Mevcut `AVCaptureVideoDataOutput` frame stream'i korunur.
- Ayni sample buffer hem inference hem video writing icin kullanilabilir.
- Timestamp/timebase kontrolu daha iyi olur.
- Ileride sync metadata icin daha esnek olur.

Android icin onerilen yol:

- CameraX `Recorder` veya MediaRecorder tabanli recorder.
- Pose preview icin ImageAnalysis ayri kalir.
- Camera lifecycle tek merkezden koordine edilir.

## Ciktilar

```text
iPhone/Android kayit alir
  -> local .mov/.mp4 dosyasi uretir
  -> duration/fps/resolution/fileSize metadata dondurur
```

## Kabul Kriterleri

- 10-30 saniyelik video stabil kaydedilir.
- Camera preview bozulmaz.
- Pose preview calismaya devam eder.
- Kayit sirasinda app crash veya native deadlock yoktur.
- Stop recording sonucu local file URI dondurur.
- Local file varligi ve boyutu dogrulanir.
- Video metadata en az duration, fps, width, height ve file size icerir.

## Riskler

- Preview, inference ve video writer ayni anda performans sorunu yaratabilir.
- iOS sample buffer ownership hatalari frame drop veya crash uretir.
- Android CameraX lifecycle yanlis kurulursa preview ya da recorder kilitlenir.

## Sprint Cikis Karari

Bu sprint bitmeden upload veya backend processing'e gecilmemelidir. Backend-core pipeline'in ham girdisi video dosyasidir; video dosyasi stabil uretilmeden sonraki sprintler sahte temel uzerine kurulur.

