# Sprint 5 - Backend Export V1

Kaynak bolum: [new_plan.md - Sprint 5](../new_plan.md#sprint-5---backend-export-v1)

## Amac

Backend tarafinda ilk BVH/JSON export'u uretmek ve mobilde backend export sonucunu gostermek.

## Kapsam

- Mevcut mobile `AnimationBake`/`BVHWriter` kodundan backend-usable core cikarma.
- `packages/skeleton-core` veya worker icinde kontrollu port karari.
- SkeletonDefinition v1.
- BVH export.
- JSON solved artifact.
- ExportFile entity.
- Download URL endpoint.
- Blender import smoke test.

## Kapsam Disi

- Advanced IK.
- Full retarget preset ekosistemi.
- FBX/MetaHuman.
- Dual-camera.

## Ilgili Is Paketleri

- [WP14 - Backend Export Core V1](../work_packages/wp-14-backend-export-core-v1.md)
- [WP15 - SkeletonDefinition ve Rotation Solve](../work_packages/wp-15-skeleton-definition-rotation-solve.md)
- [WP17 - Export Validation ve Blender Smoke Test](../work_packages/wp-17-export-validation-blender-smoke-test.md)
- [WP18 - Result Preview ve Export Result UX](../work_packages/wp-18-result-preview-export-result-ux.md)

## Ciktilar

```text
video -> backend pose -> backend BVH -> mobile export result
```

## Kabul Kriterleri

- Backend BVH export uretir.
- Export dosyasi object storage'a yuklenir.
- ExportFile API'den listelenir.
- Download URL ile dosya indirilebilir.
- Blender import smoke test gecer.
- Local mobile export olmadan kullanici export indirebilir.

## Riskler

- Mevcut TS solver dogrudan Python'a port edilirse davranis farklari artabilir.
- BVH hierarchy ve rotation order hatalari Blender'da bozuk animasyon uretir.
- Golden sample olmadan kalite regresyonu yakalanmaz.

## Sprint Cikis Karari

Bu sprint sonunda sistemin ilk uc uca production MVP akisi tamamlanir: video upload, backend process, backend export, mobile result.

