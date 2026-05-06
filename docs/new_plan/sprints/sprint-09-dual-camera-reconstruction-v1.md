# Sprint 9 - Dual-Camera Reconstruction V1

Kaynak bolum: [new_plan.md - Sprint 9](../new_plan.md#sprint-9---dual-camera-reconstruction-v1)

## Amac

Iki videodan daha iyi 3D joint output almak ve single-camera output'a gore kalite artisini olcmek.

## Kapsam

- Per-camera 2D pose detection.
- Audio waveform sync.
- Calibration clip prototype.
- Camera projection estimate.
- Triangulation.
- Reprojection error metric.
- 3D skeleton solve.
- BVH export.

## Kapsam Disi

- 4-camera pro mode.
- Full occlusion recovery.
- Advanced biomechanical constraints.

## Ilgili Is Paketleri

- [WP23 - Dual-Camera Reconstruction](../work_packages/wp-23-dual-camera-reconstruction.md)
- [WP15 - SkeletonDefinition ve Rotation Solve](../work_packages/wp-15-skeleton-definition-rotation-solve.md)
- [WP16 - Cleanup, Foot Locking ve Quality Report](../work_packages/wp-16-cleanup-foot-locking-quality-report.md)
- [WP21 - QA Golden Dataset ve E2E Validation](../work_packages/wp-21-qa-golden-dataset-e2e-validation.md)

## Ciktilar

```text
dual camera video -> triangulated 3D -> cleaner BVH
```

## Kabul Kriterleri

- Dual-camera quality score single-camera'dan daha iyi olmali.
- Sync offset raporlanir.
- Reprojection error raporlanir.
- Triangulated 3D artifact saklanir.
- Export validation single-camera ile ayni standarttan gecer.

## Riskler

- Camera calibration zayifsa triangulation tek kameradan daha kotu sonuc verebilir.
- Audio sync hatasi tum solve'u kaydirir.
- Per-camera pose detection farkli frame rate/timebase ile uyumsuz olabilir.

## Sprint Cikis Karari

Bu sprint sonunda dual-camera sadece UX ozelligi degil, kaliteyi olculebilir sekilde artiran backend reconstruction pipeline'i olmalidir.

