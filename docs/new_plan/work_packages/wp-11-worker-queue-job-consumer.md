# WP11 - Worker Queue ve Job Consumer

Ilgili sprint: [Sprint 4](../sprints/sprint-04-worker-v1-pose-extraction.md)

## Amac

Processing worker'in backend job'larini queue uzerinden alip asenkron calistirmasini saglamak.

## Yapilacaklar

1. Queue teknolojisini sec:
   - Redis Queue
   - BullMQ
   - RabbitMQ
   - SQS
2. Worker process entrypoint yaz.
3. Job payload schema tanimla.
4. Backend API'ye status update client yaz.
5. Retry ve dead-letter stratejisi belirle.
6. Idempotency kurallari yaz.
7. Structured logging ekle.
8. Job heartbeat veya progress update ekle.

## Job Payload Minimumu

```json
{
  "jobId": "job_001",
  "takeId": "take_001",
  "captureMode": "single_camera",
  "videos": [
    {
      "captureVideoId": "video_001",
      "storageKey": "takes/take_001/original/device_0.mov",
      "metadataStorageKey": "takes/take_001/metadata/device_0.json"
    }
  ]
}
```

## Kabul Kriterleri

- Worker job alir ve status'u `PROCESSING`/stage bazli gunceller.
- Worker fail olursa job failed state'e gecer.
- Retry limit vardir.
- Ayni job tekrar calisirsa artifact conflict davranisi nettir.

## Riskler

- Worker status update yapamazsa job stuck gorunebilir.
- Retry idempotent degilse artifact'ler karisir.

