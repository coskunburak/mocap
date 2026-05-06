# Sprint 3 - Mobile Upload ve Processing Status UX

Kaynak bolum: [new_plan.md - Sprint 3](../new_plan.md#sprint-3---mobile-upload-ve-processing-status-ux)

## Amac

Mobil uygulamanin capture-client davranisini tamamlamak: video kaydet, metadata uret, backend'e yukle, processing job baslat ve status goster.

## Kapsam

- `ApiClient`.
- `MocapApi`.
- `UploadManager`.
- Upload progress state.
- Retry support.
- Capture metadata builder.
- `UploadProgressScreen`.
- `ProcessingStatusScreen`.
- Capture stop sonrasi upload flow.
- Backend URL environment config.
- Local pose-frame export'un production path'ten cikarilmasi.

## Kapsam Disi

- Worker pose extraction.
- Backend export.
- Result preview.
- Dual-camera upload.

## Ilgili Is Paketleri

- [WP08 - Mobile ApiClient ve Environment Config](../work_packages/wp-08-mobile-api-client-env-config.md)
- [WP09 - UploadManager](../work_packages/wp-09-upload-manager.md)
- [WP10 - Processing Status UX](../work_packages/wp-10-processing-status-ux.md)
- [WP04 - PosePreview Quality Mode](../work_packages/wp-04-pose-preview-quality-mode.md)

## Ciktilar

```text
Record video
  -> metadata build
  -> upload
  -> complete
  -> start processing
  -> status screen
```

## Kabul Kriterleri

- Hardcoded backend URL yoktur.
- Upload progress yuzdesi kullaniciya gosterilir.
- Video upload ve metadata upload ayrimi desteklenir.
- Upload failure retry edilebilir.
- Upload complete sonrasi processing job baslatilir.
- Job status polling veya subscription ile guncellenir.
- Production UI local `TakeExporter` kullanmaz.

## Riskler

- Background upload gereksinimi MVP scope'unu sisirebilir; V1 foreground/resumable retry ile baslayabilir.
- Metadata ve video upload birbirinden koparsa backend job baslatmamali.
- Local provisional take ile remote take mapping net olmazsa offline queue karisir.

## Sprint Cikis Karari

Bu sprint sonunda mobil uygulama backend-core mimaride gercek capture client olarak calisir. Backend worker henuz export uretmese bile upload ve job status akisi kullanici tarafinda tamamdir.

