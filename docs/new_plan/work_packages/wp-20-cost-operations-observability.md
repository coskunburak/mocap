# WP20 - Cost, Operations ve Observability

Ilgili sprintler: [Sprint 2](../sprints/sprint-02-backend-api-upload-foundation.md), [Sprint 4](../sprints/sprint-04-worker-v1-pose-extraction.md)

## Amac

Video processing maliyetini ve production operasyon risklerini kontrol altinda tutmak.

## Yapilacaklar

1. Video duration limit belirle.
2. Upload size limit belirle.
3. Resolution/FPS limit belirle.
4. Queue concurrency limit koy.
5. Worker log formatini standartlastir.
6. Job timeline event'leri sakla.
7. Metrics ekle:
   - processing duration
   - upload size
   - failure rate
   - queue wait time
8. Retry limit ve dead-letter queue belirle.
9. Original video ve frame artifact TTL belirle.
10. CPU/GPU worker ayrimi icin etiketleme hazirla.

## Kabul Kriterleri

- Her job icin timeline gorulebilir.
- Failed job neden failed oldugu log ve API tarafinda izlenebilir.
- Maliyet yaratan limitler contract'ta yazili.
- Worker retry sonsuz donguye girmez.

## Riskler

- Uzun videolar CPU worker'i kilitleyebilir.
- Frame extraction artifact TTL yoksa storage hizla buyur.
- Observability olmadan kalite sorunlari kullanici sikayetine kadar fark edilmez.

