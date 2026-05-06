# WP16 - Cleanup, Foot Locking ve Quality Report

Ilgili sprintler: [Sprint 6](../sprints/sprint-06-cleanup-quality-v15.md), [Sprint 10](../sprints/sprint-10-pro-4-camera-mode.md)

## Amac

Raw solved motion'u kullanilabilir animasyona yaklastirmak ve kaliteyi olculebilir hale getirmek.

## Yapilacaklar

1. Confidence-aware smoothing implement et.
2. Missing frame interpolation ekle.
3. Outlier rejection ekle.
4. Root stabilization ekle.
5. Bone length consistency correction ekle.
6. Left/right swap detection ekle.
7. Foot contact detection yaz.
8. Basic foot locking implement et.
9. Root motion correction icin baslangic stratejisi belirle.
10. `quality_report.json` schema yaz.

## Quality Metrics

- joint jitter score
- bone length consistency
- foot sliding score
- missing landmark ratio
- left-right swap count
- root stability
- export validation result

## Kabul Kriterleri

- Quality report artifact uretilir.
- Foot sliding metric raporlanir.
- Jitter metric raporlanir.
- Bad input videoda kalite dusuk gorunur.
- Cleanup sonrasi export validation kirilmaz.

## Riskler

- Fazla smoothing hareket detaylarini kaybettirir.
- Foot locking agresifse diz/kalca hareketi bozulur.
- Quality score tek sayiya indirgenirse sorun nedeni belirsiz kalabilir.

