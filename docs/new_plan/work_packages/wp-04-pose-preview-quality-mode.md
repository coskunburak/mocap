# WP04 - PosePreview Quality Mode

Ilgili sprintler: [Sprint 1](../sprints/sprint-01-native-video-recording-foundation.md), [Sprint 3](../sprints/sprint-03-mobile-upload-processing-status.md)

## Amac

On-device removed pose runtime'i final animation kaynagi olmaktan cikarip preview ve capture quality validation motoru olarak konumlandirmak.

## Yapilacaklar

1. `PoseEngine` sorumluluklarini daralt:
   - live skeleton preview
   - tracking lock
   - quality score
   - bad frame warnings
2. `useWhamCapture` icinde production recording ile debug pose-frame recording ayrimini yap.
3. `MOCAP_LOCAL_FRAME_RECORDING=debug` gibi env/config flag tanimla.
4. Flag kapaliyken `useRecorder` pose frame chunk yazmasin.
5. Capture quality accumulator ekle.
6. Recording boyunca kalite metriklerini topla.
7. Stop recording sirasinda metadata builder'a kalite ozetini ver.

## V1 Kalite Metrikleri

- `averagePoseConfidence`
- `fullBodyVisibleRatio`
- `badFrames`
- `poseFpsAverage`
- `trackingLossCount`

## V2 Kalite Metrikleri

- `lightingScore`
- `motionBlurScore`
- `subjectDistanceScore`
- `multiPersonDetected`
- `subjectOutOfFrameRatio`

## Kabul Kriterleri

- Production capture video + metadata uretir, pose chunks uretmez.
- Debug flag acik oldugunda eski local frame recording calisabilir.
- Quality score metadata'ya yazilir.
- UI full body lock ve bad frame uyarilarini gostermeye devam eder.

## Riskler

- Local frame recording bir anda kapatilirsa review/export ekranlari kirilabilir; debug path kademeli korunmali.
- Kalite skoru final backend solve kalitesiyle birebir ayni degildir; kullaniciya kesin garanti gibi sunulmamali.

