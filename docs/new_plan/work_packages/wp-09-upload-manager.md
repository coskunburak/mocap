# WP09 - UploadManager

Ilgili sprint: [Sprint 3](../sprints/sprint-03-mobile-upload-processing-status.md)

## Amac

Local video dosyasi ve metadata'yi signed URL uzerinden yukleyen, progress ve retry destekleyen mobil upload katmanini kurmak.

## State Machine

```text
idle
preparing
uploading_metadata
uploading_video
completing
completed
failed
cancelled
```

## Yapilacaklar

1. `UploadManager` domain interface'i tanimla.
2. `SignedUrlUploadManager` implementasyonu yaz.
3. Upload init API cagrisi yap.
4. Metadata JSON upload et.
5. Video file upload et.
6. Progress callback sagla.
7. Retry policy ekle.
8. Upload complete API cagrisi yap.
9. Failure state'lerini UI'a tasiyacak hata modeli yaz.
10. Local pending upload queue icin V1 minimal veri modeli belirle.

## Kabul Kriterleri

- Video ve metadata upload edilir.
- Progress yuzdesi UI'a akar.
- Network failure durumunda retry edilebilir.
- Signed URL expire olursa yeni init akisi baslatilir.
- Upload complete sadece iki dosya da yuklendikten sonra cagirilir.

## Riskler

- React Native fetch progress kisitli olabilir; native upload veya alternatif library gerekebilir.
- Background upload MVP scope'unu buyutebilir; once foreground reliable upload ile baslamak mantikli.

