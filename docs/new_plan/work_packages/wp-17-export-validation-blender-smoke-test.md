# WP17 - Export Validation ve Blender Smoke Test

Ilgili sprintler: [Sprint 5](../sprints/sprint-05-backend-export-v1.md), [Sprint 6](../sprints/sprint-06-cleanup-quality-v15.md), [Sprint 7](../sprints/sprint-07-result-preview-export-ux.md)

## Amac

Uretilen export dosyalarinin teknik olarak acilabilir ve kullanilabilir oldugunu otomatik dogrulamak.

## Yapilacaklar

1. Export validation kurallarini yaz.
2. BVH parser veya lightweight validator ekle.
3. Headless Blender smoke test script'i yaz.
4. Blender import sonrasi kontrol et:
   - frame count
   - skeleton hierarchy
   - root joint
   - bounding box sanity
   - NaN transform yok
5. Validation result'i job artifact olarak sakla.
6. Failed validation'i backend job state'e map et.
7. Mobil quality UI'a validation ozetini aktar.

## Kabul Kriterleri

- BVH dosyasi yazildiktan sonra validation calisir.
- Blender import smoke test gecmeden export "ready" sayilmaz.
- Validation warning/error ayrimi vardir.
- Failure kullaniciya sade mesajla doner.

## Riskler

- Blender runtime CI/worker image boyutunu artirir.
- Smoke test yavas olabilir; V1'de opsiyonel ama production'da zorunlu hale getirilmeli.

