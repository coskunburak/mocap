# Sprint 7 - Result Preview ve Export UX

Kaynak bolum: [new_plan.md - Sprint 7](../new_plan.md#sprint-7---result-preview-ve-export-ux)

## Amac

Kullanicinin backend tarafinda uretilen sonucu uygulama icinde anlayabilmesini, indirebilmesini ve gerekirse tekrar isleyebilmesini saglamak.

## Kapsam

- `ExportResultScreen`.
- Preview GLB veya lightweight animation preview.
- Quality report UI.
- Retry process.
- Error reason display.
- Export preset selection.
- Download/share UX.

## Kapsam Disi

- Yeni solver algoritmalari.
- Dual-camera.
- Web dashboard.

## Ilgili Is Paketleri

- [WP18 - Result Preview ve Export Result UX](../work_packages/wp-18-result-preview-export-result-ux.md)
- [WP10 - Processing Status UX](../work_packages/wp-10-processing-status-ux.md)
- [WP17 - Export Validation ve Blender Smoke Test](../work_packages/wp-17-export-validation-blender-smoke-test.md)

## Ciktilar

```text
processing completed -> preview/result/quality/export UX
```

## Kabul Kriterleri

- Kullanici hangi export formatlarinin hazir oldugunu gorur.
- Download URL ile dosya alir.
- Quality report sade dille gosterilir.
- Failed job icin retry aksiyonu vardir.
- Export preset secimi backend API ile uyumludur.

## Riskler

- Preview dosyasi buyuk olursa mobil performans etkilenir.
- Quality report teknik kalirsa kullanici ne yapacagini anlamaz.
- Retry, ayni artifact'leri karistirmamali.

## Sprint Cikis Karari

Bu sprint sonunda backend-core pipeline kullanici tarafinda urun gibi hissedilmeye baslar: status, sonuc, kalite ve export akisi tamamdir.

