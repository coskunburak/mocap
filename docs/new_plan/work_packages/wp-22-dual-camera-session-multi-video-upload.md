# WP22 - Dual-Camera Session ve Multi-Video Upload

Ilgili sprint: [Sprint 8](../sprints/sprint-08-dual-camera-backend-session.md)

## Amac

Iki cihazdan ayni take/session altinda video yuklenmesini saglamak.

## Yapilacaklar

1. Backend `CaptureSession` entity'sini genislet.
2. Device registration endpoint'i ekle.
3. Host/guest role modelini backend'e tasir.
4. QR join flow icin session join token tanimla.
5. `deviceIndex` assignment yaz.
6. Multi-video upload init support ekle.
7. Upload complete status'u cihaz bazinda takip et.
8. Job create icin required video count kontrolu ekle.
9. Sync metadata alanlarini zorunlu/opsiyonel olarak belirle.

## Kabul Kriterleri

- Iki cihaz ayni `captureSessionId` ile kayit olur.
- Her cihaz ayri signed upload URL alir.
- Backend take altinda iki CaptureVideo kaydi gorur.
- Eksik video varken processing job baslamaz.

## Riskler

- Live landmark-stream prototipi ile production video session birbirine karistirilirsa mimari bulanir.
- Cihaz koparsa session recovery UX gerekir.

