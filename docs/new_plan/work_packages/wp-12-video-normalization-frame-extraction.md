# WP12 - Video Normalization ve Frame Extraction

Ilgili sprint: [Sprint 4](../sprints/sprint-04-worker-v1-pose-extraction.md)

## Amac

Yuklenen videolari processing icin deterministik hale getirmek: orientation, fps, codec ve timebase normalize edilir; frame extraction yapilir.

## Yapilacaklar

1. FFmpeg dependency ve runtime config belirle.
2. Original video metadata oku:
   - fps
   - duration
   - resolution
   - rotation/orientation
   - codec
   - audio track
3. Normalize output formatini belirle.
4. V1 target FPS belirle.
5. Frame extraction stratejisi sec:
   - disk frame sequence
   - streaming decode
6. Frame timestamp mapping sakla.
7. Normalized video ve frame artifacts storage'a yaz.
8. Failure durumlarini backend status'a map et.

## Kabul Kriterleri

- Portrait video dogru orientation ile islenir.
- Frame timestamps monoton ve duration ile uyumludur.
- FFmpeg failure anlamli error code'a doner.
- Sample video normalized output verir.

## Riskler

- Orientation metadata ignore edilirse pose detection yanlis calisir.
- Variable frame rate videolarda timestamp mapping bozulabilir.
- Disk frame extraction uzun videolarda storage maliyeti yaratir.

