# WP23 - Dual-Camera Reconstruction

Ilgili sprint: [Sprint 9](../sprints/sprint-09-dual-camera-reconstruction-v1.md)

## Amac

Iki kamera videosundan sync edilmis 2D pose verisiyle triangulated 3D joint output uretmek.

## Yapilacaklar

1. Her kamera icin per-camera 2D pose detection calistir.
2. Audio waveform sync implement et.
3. Timestamp offset hesapla.
4. Calibration clip prototype yaz.
5. Camera projection estimate uret.
6. Per-frame pose matching yap.
7. Triangulation implement et.
8. Reprojection error hesapla.
9. Triangulated 3D artifact sakla.
10. Skeleton solve ve export pipeline'a triangulated source ekle.

## Kabul Kriterleri

- Iki video sync offset'i raporlanir.
- Triangulated 3D joint artifact uretilir.
- Reprojection error raporlanir.
- Dual-camera quality score single-camera baseline'dan iyi olur.
- BVH export validation gecer.

## Riskler

- Calibration zayifsa triangulation kotu sonuc uretir.
- Audio sync clap yoksa offset tahmini zorlasir.
- Occlusion durumunda per-view matching hatalari artar.

