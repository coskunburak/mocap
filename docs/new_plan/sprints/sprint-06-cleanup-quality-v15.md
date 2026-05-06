# Sprint 6 - Cleanup ve Quality V1.5

Kaynak bolum: [new_plan.md - Sprint 6](../new_plan.md#sprint-6---cleanup-ve-quality-v15)

## Amac

Backend export'unu sadece "dosya uretiyor" seviyesinden "kullanilabilir animasyon uretiyor" seviyesine tasimak.

## Kapsam

- One-Euro/Kalman/Savitzky-Golay smoothing degerlendirmesi.
- Confidence-aware interpolation.
- Outlier rejection.
- Root stabilization.
- Bone length normalization.
- Left/right swap detection.
- Basic foot contact.
- Basic foot locking.
- Solve quality report.

## Kapsam Disi

- Full biomechanical solver.
- MetaHuman retarget.
- 4-camera occlusion recovery.

## Ilgili Is Paketleri

- [WP16 - Cleanup, Foot Locking ve Quality Report](../work_packages/wp-16-cleanup-foot-locking-quality-report.md)
- [WP15 - SkeletonDefinition ve Rotation Solve](../work_packages/wp-15-skeleton-definition-rotation-solve.md)
- [WP17 - Export Validation ve Blender Smoke Test](../work_packages/wp-17-export-validation-blender-smoke-test.md)
- [WP21 - QA Golden Dataset ve E2E Validation](../work_packages/wp-21-qa-golden-dataset-e2e-validation.md)

## Ciktilar

```text
daha stabil BVH
quality_report.json
user-facing quality score
```

## Kabul Kriterleri

- Foot sliding metric raporlanir.
- Jitter metric raporlanir.
- Bone length consistency raporlanir.
- Bad input videoda kullaniciya aksiyon alinabilir uyarilar doner.
- Golden sample setinde kalite regresyonu takip edilir.

## Riskler

- Fazla smoothing hareket detayini oldurur.
- Foot locking agresif uygulanirsa diz/kalca hareketi bozulur.
- Quality score kullaniciya yanlis guven verebilir; metrikler acik olmali.

## Sprint Cikis Karari

Bu sprint sonunda urun Move.ai kalitesinde olmak zorunda degil, fakat "MVP export aldim ama animasyon oyuncak gibi" seviyesinden cikmis olmalidir.

