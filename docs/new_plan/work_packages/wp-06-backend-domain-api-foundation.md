# WP06 - Backend Domain Model ve API Foundation

Ilgili sprint: [Sprint 2](../sprints/sprint-02-backend-api-upload-foundation.md)

## Amac

Backend API'nin Project, Take, Upload ve ProcessingJob temelini kurmak.

## Entity'ler

- User
- Project
- CaptureSession
- Take
- CaptureDevice
- CaptureVideo
- UploadSession
- ProcessingJob
- ExportFile

## Yapilacaklar

1. Backend framework secimini finalize et.
2. PostgreSQL migration yapisini kur.
3. Entity modellerini yaz.
4. Repository/service katmanlarini yaz.
5. API controller'lari ekle.
6. Request/response DTO'larini API contract ile uyumlu yap.
7. Access control icin user/project ownership kontrolu ekle.
8. Job state machine enum'unu tek kaynak olarak tanimla.
9. API error response formatini standartlastir.

## Minimum Endpointler

```text
POST /api/projects
GET  /api/projects
POST /api/projects/{projectId}/takes
GET  /api/takes/{takeId}
POST /api/takes/{takeId}/process
GET  /api/jobs/{jobId}
```

## Kabul Kriterleri

- Project ve take yaratilir.
- Take user/project izolasyonu ile okunur.
- Job create sadece uploaded take icin baslar.
- Job status mobil status screen tarafindan parse edilebilir.
- Backend local dev ortaminda DB ile calisir.

## Riskler

- Auth MVP'de cok basit tutulsa bile access control tamamen ertelenmemeli.
- Entity modelleri worker artifact ihtiyaclarini karsilamazsa sonradan migration maliyeti artar.

