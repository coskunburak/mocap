# WP24 - Pro 4-Camera Mode

Ilgili sprint: [Sprint 10](../sprints/sprint-10-pro-4-camera-mode.md)

## Amac

4 cihazli pro capture workflow ve multi-view reconstruction temelini kurmak.

## Yapilacaklar

1. CaptureSession'i 4 device destekleyecek sekilde genislet.
2. Camera placement guide UX tasarla.
3. Device role/angle modeli ekle:
   - front
   - back
   - left
   - right
4. Calibration capture flow ekle.
5. Multi-video upload grouping'i 4 cihaz icin dogrula.
6. Multi-view pose matching implement et.
7. Occlusion recovery baslangic stratejisi ekle.
8. Multi-view quality score yaz.
9. Advanced IK constraints icin solver hook'lari ekle.
10. Retarget preset pipeline'ini genislet.

## Kabul Kriterleri

- 4 video ayni take altinda islenir.
- Multi-view reconstruction artifact uretilir.
- Camera placement feedback kullaniciya verilir.
- Occlusion recovery baslangic seviyesi vardir.
- Export validation V1/V2 standartlarini gecmeye devam eder.

## Riskler

- 4 kamera capture UX karmasik olabilir.
- Upload maliyeti hizla artar.
- Calibration hatalari production kaliteyi ciddi bozar.

