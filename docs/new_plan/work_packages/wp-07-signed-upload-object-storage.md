# WP07 - Signed Upload ve Object Storage

Ilgili sprintler: [Sprint 2](../sprints/sprint-02-backend-api-upload-foundation.md), [Sprint 8](../sprints/sprint-08-dual-camera-backend-session.md)

## Amac

Mobil uygulamanin video ve metadata dosyalarini backend uzerinden signed URL ile private object storage'a yukleyebilmesini saglamak.

## Yapilacaklar

1. Object storage provider sec:
   - S3
   - Cloudflare R2
   - MinIO local dev
   - baska S3-compatible provider
2. Bucket privacy ayarlarini belirle.
3. Storage key layout'u implement et.
4. Upload init endpoint'i yaz.
5. Signed PUT URL uret.
6. Metadata upload URL uret.
7. Upload complete endpoint'i yaz.
8. Complete sirasinda object existence ve size validation yap.
9. UploadSession state machine tanimla.
10. Multi-device upload icin deviceIndex destekle.

## Storage Layout

```text
takes/{takeId}/original/device_{index}.mov
takes/{takeId}/metadata/device_{index}.json
takes/{takeId}/normalized/device_{index}.mp4
takes/{takeId}/exports/{preset}/result.bvh
```

## Kabul Kriterleri

- Signed URL sureli ve sadece hedef key icin gecerlidir.
- Video ve metadata upload ayri takip edilir.
- Upload complete eksik dosyada fail eder.
- CaptureVideo kaydi storageKey ile olusturulur.
- Private bucket public download'a kapali kalir.

## Riskler

- Client direkt public bucket'a upload ederse privacy acigi olusur.
- Signed URL expire olursa retry akisi yeni upload init istemeli.
- Dosya boyutu limitleri basta tanimlanmazsa maliyet kontrolu zorlasir.

