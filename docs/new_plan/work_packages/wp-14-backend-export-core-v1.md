# WP14 - Backend Export Core V1

Ilgili sprint: [Sprint 5](../sprints/sprint-05-backend-export-v1.md)

## Amac

Backend tarafinda pose artifact'ten BVH ve solved JSON uretecek ilk export core'u kurmak.

## Yapilacaklar

1. Mevcut mobile export pipeline'i referans al:
   - `AnimationBake`
   - `BVHWriter`
   - `AvatarMotion`
   - `PoseCleanupPipeline`
2. Backend kullanimi icin strateji sec:
   - TypeScript `skeleton-core` package.
   - Python'a kontrollu port.
3. `solved_motion.json` schema tanimla.
4. BVH writer V1 implement et.
5. Export artifact storage key'lerini yaz.
6. ExportFile entity kaydini backend API'ye yazdir.
7. Download URL endpoint ile mobil kullanima ac.

## V1 Output

- `pose_frames.json`
- `solved_motion.json`
- `quality_report.json` baslangic surumu
- `result.bvh`

## Kabul Kriterleri

- Backend BVH dosyasi uretir.
- Export object storage'a yazilir.
- ExportFile API'den listelenir.
- Mobil local `TakeExporter` kullanmadan export result alir.
- Golden sample ile eski mobile output karsilastirmasi yapilabilir.

## Riskler

- Python port davranis farki uretirse regression yakalanmayabilir.
- Node-based shared package worker operasyonunu karmasiklastirabilir ama ilk MVP icin hiz kazandirir.

