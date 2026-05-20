# Sprint 4 - Worker V1 Pose Extraction

Kaynak bolum: [new_plan.md - Sprint 4](../new_plan.md#sprint-4---worker-v1-pose-extraction)

## Amac

Backend'e yuklenen videodan pose artifact uretmek. Bu sprintin ana ciktisi `pose_frames.json` olmalidir.

## Kapsam

- Worker queue consumer.
- Object storage download.
- FFmpeg normalize.
- Frame extraction.
- removed pose runtime Python `PoseDetector`.
- `pose_frames.json` artifact.
- Job progress update.
- Structured error handling.

## Kapsam Disi

- Skeleton solve.
- BVH export.
- Foot locking.
- Dual-camera reconstruction.

## Ilgili Is Paketleri

- [WP11 - Worker Queue ve Job Consumer](../work_packages/wp-11-worker-queue-job-consumer.md)
- [WP12 - Video Normalization ve Frame Extraction](../work_packages/wp-12-video-normalization-frame-extraction.md)
- [WP13 - removed pose runtime Pose Extraction](../work_packages/wp-13-removed_pose_runtime-pose-extraction.md)
- [WP20 - Cost, Operations ve Observability](../work_packages/wp-20-cost-operations-observability.md)

## Ciktilar

```text
uploaded video -> normalized video -> frames -> pose_frames.json
```

## Kabul Kriterleri

- Sample video icin `pose_frames.json` uretilir.
- Frame timestamp bilgisi korunur.
- Landmark confidence/visibility bilgisi saklanir.
- Job status API uzerinden guncellenir.
- Failed pose detection kullaniciya anlamli hata olarak doner.
- Worker tekrar calistirildiginda artifact overwrite/idempotency kurallari nettir.

## Riskler

- Video orientation/timebase normalize edilmezse pose frame timestamp'leri bozulur.
- removed pose runtime Python output'u native mobil output ile schema olarak uyumsuz kalabilir.
- Uzun videolarda CPU maliyeti ve sure artar.

## Sprint Cikis Karari

Bu sprint sonunda henuz animasyon dosyasi uretmek zorunda degiliz. Ama backend ham videodan tekrar islenebilir pose artifact uretebilmelidir.

