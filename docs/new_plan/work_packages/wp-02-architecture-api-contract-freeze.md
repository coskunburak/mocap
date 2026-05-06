# WP02 - Architecture ve API Contract Freeze

Ilgili sprint: [Sprint 0](../sprints/sprint-00-architecture-freeze-audit.md)

## Amac

Mobile, backend API ve worker arasindaki sozlesmeyi dondurmak. Bu sozlesme olmadan paralel gelistirme risklidir.

## Yapilacaklar

1. Backend-core mimari diyagramini yaz.
2. Source of truth kararini belge:
   - Production: original video + capture metadata.
   - Debug/reference: local pose frames.
3. Core entity listesini finalize et:
   - User
   - Project
   - CaptureSession
   - Take
   - CaptureDevice
   - CaptureVideo
   - CaptureMetadata
   - UploadSession
   - ProcessingJob
   - ExportFile
   - QualityReport
4. API endpoint listesini yaz:
   - Projects
   - Takes
   - Uploads
   - Processing jobs
   - Exports
5. Processing job state machine'i dondur.
6. API error formatini tanimla.
7. Mobile status mapping tablosunu yaz.
8. Object storage key naming convention'i belirle.

## API Contract Minimumu

MVP icin zorunlu endpointler:

```text
POST /api/projects
GET  /api/projects
POST /api/projects/{projectId}/takes
POST /api/takes/{takeId}/uploads/init
POST /api/takes/{takeId}/uploads/complete
POST /api/takes/{takeId}/process
GET  /api/jobs/{jobId}
GET  /api/takes/{takeId}/exports
GET  /api/exports/{exportId}/download-url
```

## Ciktilar

- `docs/api/api-contract-v1.md`
- `docs/architecture/backend-core-architecture.md`
- `docs/processing/job-state-machine-v1.md`

## Kabul Kriterleri

- Mobile taraf `ApiClient` implementasyonuna baslayabilir.
- Backend taraf entity/schema implementasyonuna baslayabilir.
- Worker taraf job status update formatini bilir.
- Upload complete olmadan process baslamayacagi contract'ta yazili.

## Riskler

- Contract fazla buyutulurse MVP yavaslar.
- Auth ve access control ertelenirse privacy borcu olusur.
- Error format net olmazsa mobil UX teknik hata gosterir.

