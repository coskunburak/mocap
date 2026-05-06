# WP18 - Result Preview ve Export Result UX

Ilgili sprintler: [Sprint 5](../sprints/sprint-05-backend-export-v1.md), [Sprint 7](../sprints/sprint-07-result-preview-export-ux.md)

## Amac

Backend tarafinda uretilen export ve kalite raporlarini mobilde urun deneyimi olarak sunmak.

## Yapilacaklar

1. `ExportFile` mobile type tanimla.
2. `ExportApiRepository` implement et.
3. `ExportResultScreen` olustur.
4. Ready export listesi goster.
5. Download URL al ve share/download akisini bagla.
6. Quality report'i sade metriklerle goster.
7. Preview artifact varsa goster:
   - GLB
   - lightweight animation preview
   - preview mp4
8. Failed job icin retry action goster.
9. Local mobile export UI'ini debug flag arkasina al.

## Kabul Kriterleri

- Kullanici backend export dosyalarini gorur.
- Download/share akisi calisir.
- Quality score ve warning'ler anlasilir.
- Local `TakeExporter` production akista cagrilmaz.

## Riskler

- Preview GLB buyukse mobil performansi dusurur.
- Export formatlari cok erken cogalirsa UX karmasiklasir; V1 BVH/JSON ile sinirli kalmali.

