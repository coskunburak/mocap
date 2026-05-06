# Sprint 2 - Backend API ve Upload Temeli

Kaynak bolum: [new_plan.md - Sprint 2](../new_plan.md#sprint-2---backend-api-ve-upload-temeli)

## Amac

Project, Take, Upload ve ProcessingJob icin backend temelini kurmak. Bu sprintte backend video islemez; sadece entity, signed upload ve job orchestration saglar.

## Kapsam

- API backend skeleton.
- PostgreSQL schema.
- Project entity.
- Take entity.
- CaptureVideo entity.
- UploadSession entity.
- ProcessingJob entity.
- Signed URL upload init endpoint.
- Upload complete endpoint.
- Job create endpoint.
- Job status endpoint.
- Local dev docker compose.

## Kapsam Disi

- Worker processing.
- Pose detection.
- Export generation.
- Mobile UI refactor disinda upload entegrasyonu.

## Ilgili Is Paketleri

- [WP06 - Backend Domain Model ve API Foundation](../work_packages/wp-06-backend-domain-api-foundation.md)
- [WP07 - Signed Upload ve Object Storage](../work_packages/wp-07-signed-upload-object-storage.md)
- [WP19 - Security, Privacy ve Retention](../work_packages/wp-19-security-privacy-retention.md)
- [WP20 - Cost, Operations ve Observability](../work_packages/wp-20-cost-operations-observability.md)

## Ciktilar

```text
App backend'de take yaratabilir
  -> signed upload URL alabilir
  -> upload complete isaretleyebilir
  -> processing job baslatabilir
  -> job status okuyabilir
```

## Kabul Kriterleri

- Upload complete olmadan processing job baslamaz.
- Upload URL sureli ve private bucket hedeflidir.
- Take ve CaptureVideo user/project access control ile korunur.
- Job state machine backend tarafinda tek kaynak olarak tanimlidir.
- API response modelleri mobile tarafin kullanabilecegi kadar stabil.
- Local dev ortaminda API + DB + storage emulator veya S3-compatible hedef calisir.

## Riskler

- API contract fazla erken genislerse MVP yavaslar.
- Auth/access control ertelenirse video privacy borcu olusur.
- Upload state machine net olmazsa retry/resume davranisi bozulur.

## Sprint Cikis Karari

Bu sprint sonunda backend "video isleyen sistem" degil, "video kabul eden ve job olusturan sistem" olmalidir.

