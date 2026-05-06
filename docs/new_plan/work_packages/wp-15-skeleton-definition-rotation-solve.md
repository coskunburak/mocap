# WP15 - SkeletonDefinition ve Rotation Solve

Ilgili sprintler: [Sprint 5](../sprints/sprint-05-backend-export-v1.md), [Sprint 6](../sprints/sprint-06-cleanup-quality-v15.md), [Sprint 9](../sprints/sprint-09-dual-camera-reconstruction-v1.md)

## Amac

Landmark pozisyonlarindan stabil humanoid skeleton ve joint rotation uretmek.

## Yapilacaklar

1. Canonical `SkeletonDefinition` tanimla.
2. Coordinate system kararini yaz:
   - Y-up / right-handed veya hedef DCC uyumu.
3. Joint hierarchy belirle.
4. Rotation order belirle.
5. Rest pose calibration akisini yaz.
6. Landmark -> normalized skeleton mapping implement et.
7. Bone length normalization implement et.
8. Joint local rotation solve implement et.
9. Root/hip transform davranisini test et.
10. Blender import ile rotation sanity check yap.

## Test Edilecekler

- T-pose/A-pose rest pose.
- Hips root translation.
- Spine rotation.
- Shoulder/arm rotations.
- Knee/elbow bend direction.
- Left/right swap detection.
- NaN/Infinity rotation guard.

## Kabul Kriterleri

- BVH hierarchy valid.
- Rotation output NaN/Infinity icermez.
- Bone length frame'den frame'e kontrolsuz degismez.
- Blender import smoke test gecer.
- Golden sample'da root motion makul gorunur.

## Riskler

- Rotation order yanlissa animasyon Blender'da bozuk gorunur.
- Rest pose yanlis hesaplanirsa tum hareket offset'li olur.
- Tek kamera world landmarks derinlikte jitter uretir.

