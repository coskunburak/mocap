# Sprint 0 - Architecture Freeze ve Audit

Kaynak bolum: [new_plan.md - Sprint 0](../new_plan.md#sprint-0---architecture-freeze-ve-audit)

## Amac

Mevcut MocapExpo kod tabanini backend-core mimariye gecis icin net sinirlara ayirmak. Bu sprintte kodun davranisi degistirilmez; hedef, mevcut sistemi dogru siniflandirmak ve sonraki sprintlerin sozlesmelerini dondurmektir.

## Kapsam

- Mevcut local pose-frame recording akisinin dokumani.
- Mevcut mobil export pipeline'in debug/reference path olarak siniflandirilmasi.
- Native video recording gap'inin teknik karar dokumani.
- Backend API contract v1.
- Capture metadata schema v1.
- Processing job state machine v1.
- Mobile debug/local export karari.

## Kapsam Disi

- Native video recorder implementasyonu.
- Backend API kodlamasi.
- Worker implementasyonu.
- UI ekran refactor'u.

## Ilgili Is Paketleri

- [WP01 - Current Codebase Audit](../work_packages/wp-01-current-codebase-audit.md)
- [WP02 - Architecture ve API Contract Freeze](../work_packages/wp-02-architecture-api-contract-freeze.md)
- [WP05 - Capture Metadata Schema](../work_packages/wp-05-capture-metadata-schema.md)
- [WP21 - QA Golden Dataset ve E2E Validation](../work_packages/wp-21-qa-golden-dataset-e2e-validation.md)

## Ciktilar

- `docs/architecture/backend-core-architecture.md`
- `docs/api/api-contract-v1.md`
- `docs/processing/worker-pipeline-v1.md`
- `docs/capture/capture-metadata-v1.md`
- `docs/migration/mobile-backend-core-migration.md`

## Kabul Kriterleri

- Hangi kodun production path, hangi kodun debug/reference path oldugu yazili.
- `PoseEngine`, `useRecorder`, `takeRepoFs`, `TakeExporter`, dual-camera prototipi ve bos DI/service katmanlari audit edildi.
- Video file recording ilk teknik blocker olarak dokumante edildi.
- API contract mobil gelistirme baslatmaya yetecek kadar net.
- Capture metadata schema backend ve mobile tarafinca ortak kullanilabilir durumda.

## Riskler

- Mevcut local export kodu aceleyle silinirse backend export icin referans kaybedilir.
- Backend contract erken dondurulmazsa mobil ve backend paralel gelistirme kilitlenir.
- Video recording gap'i net tanimlanmazsa Sprint 1 scope'u siser.

## Sprint Cikis Karari

Bu sprint tamamlandiginda ekip su kararlarda ayni noktada olmalidir:

- Source of truth: original video + capture metadata.
- Local pose-frame recording: debug/reference.
- Mobile export: production disi, debug/reference.
- Backend: orchestration.
- Worker: motion solving/export core.

