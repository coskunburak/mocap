# WP08 - Mobile ApiClient ve Environment Config

Ilgili sprint: [Sprint 3](../sprints/sprint-03-mobile-upload-processing-status.md)

## Amac

Mobil uygulamada backend ile konusacak tipli, environment-config tabanli API katmanini kurmak.

## Yapilacaklar

1. `src/app/config/env.ts` olustur.
2. Backend base URL'i hardcoded olmaktan cikar.
3. `src/infra/api/ApiClient.ts` yaz.
4. Request timeout ve retry policy belirle.
5. JSON parse ve error normalization ekle.
6. `MocapApi` interface'i tanimla:
   - createProject
   - createTake
   - initUpload
   - completeUpload
   - startProcessing
   - getProcessingJob
   - listExports
   - getExportDownloadUrl
7. Mock/stub repository opsiyonu ekle.
8. API response type'larini domain type'lara map et.

## Kabul Kriterleri

- Backend URL environment/config'ten gelir.
- API hatalari UI'da kullanilabilir typed error'a donusur.
- API client test edilebilir interface ile kullanilir.
- Ekranlar dogrudan `fetch` cagirmak zorunda kalmaz.

## Riskler

- Expo/native build config farklari env okumayi karistirabilir.
- Offline durumda tum API hatalari ayni mesaja dusmemeli.

