# Sprint 10 - Pro 4-Camera Mode

Kaynak bolum: [new_plan.md - Sprint 10](../new_plan.md#sprint-10---pro-4-camera-mode)

## Amac

Move.ai benzeri pro capture workflow'a yaklasmak icin 4 kamera capture ve multi-view solving temelini kurmak.

## Kapsam

- 4 device session.
- Camera angle guide.
- Calibration capture.
- Multi-view matching.
- Occlusion recovery baslangici.
- Multi-view quality score.
- Advanced IK constraints.
- Retarget presets.

## Kapsam Disi

- Custom AI model training.
- Full enterprise workflow.
- Real-time cloud streaming.

## Ilgili Is Paketleri

- [WP24 - Pro 4-Camera Mode](../work_packages/wp-24-pro-4-camera-mode.md)
- [WP22 - Dual-Camera Session ve Multi-Video Upload](../work_packages/wp-22-dual-camera-session-multi-video-upload.md)
- [WP23 - Dual-Camera Reconstruction](../work_packages/wp-23-dual-camera-reconstruction.md)
- [WP16 - Cleanup, Foot Locking ve Quality Report](../work_packages/wp-16-cleanup-foot-locking-quality-report.md)

## Ciktilar

```text
4 iPhone capture -> production-grade multi-view solve foundation
```

## Kabul Kriterleri

- 4 video ayni take altinda islenir.
- Multi-view reconstruction artifact uretilir.
- Camera placement/quality feedback kullaniciya verilir.
- Missing/occluded joint recovery baslangic seviyesi vardir.
- Export validation V1/V2 standartlarini gecmeye devam eder.

## Riskler

- 4 kamera upload ve processing maliyeti yuksektir.
- Calibration UX zorlasirsa kullanici basarisiz kayit alir.
- Multi-view matching hatalari skeleton solve'u bozabilir.

## Sprint Cikis Karari

Bu sprint urunu pro capture segmentine tasir. Buraya gelmeden V1 single-camera ve V2 dual-camera pipeline'lari stabil ve olculebilir olmali.

