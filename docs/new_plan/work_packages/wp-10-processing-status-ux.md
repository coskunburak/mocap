# WP10 - Processing Status UX

Ilgili sprintler: [Sprint 3](../sprints/sprint-03-mobile-upload-processing-status.md), [Sprint 7](../sprints/sprint-07-result-preview-export-ux.md)

## Amac

Backend job state machine'ini kullanicinin anlayacagi sade bir progress UX'e cevirmek.

## Yapilacaklar

1. `ProcessingJob` TypeScript type tanimla.
2. Backend status -> user-facing label mapping yaz.
3. `ProcessingStatusScreen` olustur.
4. Polling interval veya subscription stratejisi belirle.
5. Failed job icin retry/cancel aksiyonlari ekle.
6. Progress yuzdesi ve current stage goster.
7. Completed oldugunda export result ekranina yonlendir.
8. Debug panelde teknik status ve job id goster.

## Status Mapping

```text
QUEUED -> Waiting in queue
TRANSCODING -> Preparing video
POSE_DETECTION -> Detecting body movement
SOLVING_SKELETON -> Solving skeleton
CLEANING_MOTION -> Cleaning animation
EXPORTING -> Generating export
COMPLETED -> Ready
```

## Kabul Kriterleri

- Kullanici upload sonrasi job durumunu gorur.
- Error state teknik olmayan mesajla gosterilir.
- Completed status export/result akisini tetikler.
- Polling ekran kapansa bile job bilgisi tekrar acildiginda okunabilir.

## Riskler

- Cok sik polling battery/network maliyeti yaratir.
- Backend progress yuzdesi tutarsizsa UX guven kaybettirir.

