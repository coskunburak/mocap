# WP21 - QA Golden Dataset ve E2E Validation

Ilgili sprintler: [Sprint 0](../sprints/sprint-00-architecture-freeze-audit.md), [Sprint 6](../sprints/sprint-06-cleanup-quality-v15.md), [Sprint 9](../sprints/sprint-09-dual-camera-reconstruction-v1.md)

## Amac

Motion solving ve export kalitesini sezgisel yorumdan cikartip tekrarlanabilir testlere baglamak.

## Golden Dataset

Minimum sample set:

- T-pose/A-pose calibration.
- Yurume.
- Hizli hareket.
- Donus.
- Comelme.
- Ziplama.
- Kol govde onunde crossing.
- Kismi occlusion.
- Dusuk isik.
- Yan kamera acisi.
- Dual-camera clap sync sample.

## Yapilacaklar

1. Sample video dosyalarini belirle.
2. Her sample icin expected metadata yaz.
3. E2E pipeline script'i tasarla:
   - upload
   - process
   - export
   - download
   - blender validate
4. Quality threshold'lari belirle.
5. Regression raporu formatini yaz.
6. Mobile local export output'u ile backend output karsilastirma stratejisi belirle.

## Kabul Kriterleri

- En az 3 single-camera sample ile E2E pipeline calisir.
- BVH export validation otomatik calisir.
- Quality regression raporlanir.
- Dual-camera icin en az bir clap sync sample hazirlanir.

## Riskler

- Golden dataset yoksa solver degisimleri kaliteyi sessizce bozabilir.
- Sadece iyi videolarla test edilirse error UX eksik kalir.

