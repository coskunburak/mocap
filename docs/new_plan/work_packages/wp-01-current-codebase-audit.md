# WP01 - Current Codebase Audit

Ilgili sprint: [Sprint 0](../sprints/sprint-00-architecture-freeze-audit.md)

## Amac

Mevcut MocapExpo kod tabaninin backend-core gecis acisindan nerede durdugunu netlestirmek. Bu is paketi implementasyon degil, teknik envanter ve migration sinirlari cikarir.

## Incelenecek Alanlar

- Native camera capture:
  - `ios/MocapExpo/pose/PoseEngineModule.swift`
  - `ios/MocapExpo/pose/PoseCameraSession.swift`
  - `ios/MocapExpo/pose/RemovedPoseRunner.swift`
  - Android `pose` native package.
- Capture flow:
  - `src/features/capture/hooks/useWhamCapture.ts`
  - `src/features/capture/hooks/useRecorder.ts`
  - `src/features/capture/screens/CaptureScreen.tsx`
- Local persistence:
  - `src/infra/persistence/TakeRepo.fs.ts`
  - `src/infra/persistence/takeRepoFs.reader.ts`
- Export pipeline:
  - `src/domain/mocap/pipeline/export/*`
  - `src/domain/mocap/pipeline/cleanup/*`
  - `src/domain/mocap/pipeline/retarget/*`
- Dual-camera prototype:
  - `src/features/capture/hooks/useMultiViewCapture.ts`
  - `src/infra/networking/*`
  - `src/domain/mocap/pipeline/triangulation/*`
- Empty/weak architecture seams:
  - `src/app/di/container.ts`
  - `src/domain/mocap/services/MocapSessionService.ts`
  - `src/domain/mocap/services/ExportService.ts`

## Yapilacaklar

1. Mevcut capture flow sequence diagram cikar.
2. `PoseFrame` recording ve local chunk persistence akislarini belge.
3. Native kamera katmaninda video recording olmamasini teknik blocker olarak yaz.
4. `TakeExporter` ve export pipeline'in production/debug siniflandirmasini yap.
5. Dual-camera live landmark-stream prototipinin backend multi-video pipeline'dan farkini yaz.
6. Bos DI/service dosyalarinin yeni mimaride nasil kullanilacagini belirle.
7. Test script ve QA gap listesini cikar.

## Ciktilar

- `docs/architecture/current-codebase-audit.md`
- `docs/migration/local-export-debug-decision.md`
- `docs/migration/native-video-recording-gap.md`

## Kabul Kriterleri

- Mevcut kodun hangi parcasi korunacak, hangisi debug'a alinacak net.
- Video recording gap'i net teknik gerekcelerle yazildi.
- Local mobile export'un cope atilmayacagi, backend icin referans olarak tutulacagi kayitli.
- Dual-camera mevcut prototipinin production V2'ye nasil evrilecegi ayrilmis.

## Bagimliliklar

Yok. Bu is paketi migration'in baslangicidir.

