# WP19 - Security, Privacy ve Retention

Ilgili sprintler: [Sprint 2](../sprints/sprint-02-backend-api-upload-foundation.md), [Sprint 7](../sprints/sprint-07-result-preview-export-ux.md)

## Amac

Kullanici videolarinin guvenli saklanmasi, islenmesi ve silinmesi icin temel privacy ve security davranislarini kurmak.

## Yapilacaklar

1. Signed upload URL kullan.
2. Private bucket disinda video saklama.
3. Temporary download URL kullan.
4. Token-based auth ekle.
5. User/project/take access control yaz.
6. Delete take/project akislarini tasarla.
7. Retention policy tanimla.
8. Processing consent metnini capture oncesi goster.
9. Audit log minimumunu belirle.

## Retention Baslangic Onerisi

```text
Free:
  original video 7 gun
  exports 30 gun

Pro:
  original video 30/90 gun
  exports daha uzun sureli

Enterprise:
  custom retention
```

## Kabul Kriterleri

- Public bucket yok.
- Baska kullanici take/export dosyasina erisemez.
- Download URL suresi sinirli.
- Kullanici kayit oncesi backend processing consent gorur.
- Delete take original video ve artifacts icin planlidir.

## Riskler

- Privacy sonradan eklenirse storage layout ve API contract degismek zorunda kalir.
- Original video retention unutulursa maliyet ve risk artar.

