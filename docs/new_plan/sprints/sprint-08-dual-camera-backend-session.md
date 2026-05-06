# Sprint 8 - Dual-Camera Backend Session

Kaynak bolum: [new_plan.md - Sprint 8](../new_plan.md#sprint-8---dual-camera-backend-session)

## Amac

Iki cihazdan ayni take icin video upload edilebilmesini saglamak. Bu sprint reconstruction yapmaz; session ve multi-video grouping temelini kurar.

## Kapsam

- Backend CaptureSession entity.
- Multi-device take.
- QR join.
- Host/guest device registration.
- Shared takeId/sessionId.
- Device index.
- Audio clap/beep sync metadata.
- Multi-video upload grouping.

## Kapsam Disi

- Triangulation.
- Dual-camera skeleton solve.
- Advanced calibration.

## Ilgili Is Paketleri

- [WP22 - Dual-Camera Session ve Multi-Video Upload](../work_packages/wp-22-dual-camera-session-multi-video-upload.md)
- [WP05 - Capture Metadata Schema](../work_packages/wp-05-capture-metadata-schema.md)
- [WP07 - Signed Upload ve Object Storage](../work_packages/wp-07-signed-upload-object-storage.md)

## Ciktilar

```text
2 iPhone -> same take -> 2 video upload
```

## Kabul Kriterleri

- Backend take altinda iki CaptureVideo gorur.
- Her cihaz deviceIndex ve role ile kayit olur.
- QR join veya equivalent pairing flow calisir.
- Upload complete tum gerekli videolar gelmeden motion solve baslatmaz.
- Sync metadata kaydedilir.

## Riskler

- Mevcut live landmark-stream dual-camera kodu production video session ile karistirilabilir.
- Host/guest cihaz rolleri backend entity'lerine yanlis map edilebilir.
- Session'a eksik video gelirse job state belirsiz kalabilir.

## Sprint Cikis Karari

Bu sprint sonunda iki cihazli capture operasyonel olarak mumkun olur, ama kalite artisi Sprint 9 reconstruction ile gelir.

