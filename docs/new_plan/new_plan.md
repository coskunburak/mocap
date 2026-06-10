# MocapExpo Backend-Core Production MoCap Donusum Plani

> [!IMPORTANT]
> **TAMAMLANDI:** Bu belge, projenin geçmişteki mimari dönüşüm vizyonunu yansıtan **tarihi bir referans belgesidir.**
> Belgede "Hedef" veya "Plan" olarak geçen Single Camera ve Multi-View/True Dual Solve dâhil olmak üzere üretim (production) mimarisinin tamamı başarıyla kodlanmış, test edilmiş ve entegre edilmiştir.

## 0. Dokumanin Amaci

Bu dokumanin amaci MocapExpo projesini mevcut "mobilde pose frame kaydet, mobilde export uret" yapisindan, Move.ai benzeri production-level markerless motion capture platformuna evirmek icin uygulanabilir bir teknik yol haritasi tanimlamaktir.

Hedef sadece backend eklemek degildir. Hedef, urunun cekirdegini su modele tasimaktir:

```text
Mobile App
  = capture, preview, quality validation, upload, status/result UX

Backend API
  = auth, project/take/session/upload/job/export orchestration

Processing Core
  = video ingest, pose extraction, sync, reconstruction, skeleton solve, cleanup, export

Storage + Queue + Observability
  = production operasyon, maliyet kontrolu, hata izleme, tekrar isleme
```

Net urun hedefi:

```text
iPhone ile kayit al
  -> video + metadata backend'e yukle
  -> backend hareketi cozer
  -> backend BVH/GLB/FBX/JSON export uretir
  -> mobil/web sadece sonucu gosterir, indirir ve kalite raporu sunar
```

Bu gecisten sonra mobil uygulama final animasyon motoru degil, guvenilir capture client olur. Final motion solving ve export backend-core tarafinin sorumlulugudur.

## 1. Stratejik Karar

### 1.1 Neden Backend-Core?

Tek kamerali mobil removed pose runtime preview, hizli MVP icin degerlidir ama production mocap kalitesi icin yeterli degildir. Tek kamera 3D verisi gercek reconstruction degil, model tahminidir. Su durumlarda veri bozulur:

- Vucut kameraya yan dondugunde.
- Kol ve govde ust uste geldiginde.
- Ayaklar veya eller kadraj disinda kaldiginda.
- Ani donus, ziplamalar ve comelmelerde.
- Derinlik tahmini kararsiz oldugunda.
- Left/right landmark swap olustugunda.
- Root/hip transform ve coordinate conversion dogru yapilmadiginda.
- Foot sliding, kemik uzunlugu degisimi ve jitter temizlenmediginde.

Move.ai benzeri bir urun kalitesine yaklasmak icin telefonun gorevi hareketi "cozmek" degil, kaliteli ham kayit uretmektir. Hareket cozumleme, coklu kamera eslestirme, 3D reconstruction, IK cleanup, foot locking, retarget ve export backend-core tarafinda yapilmalidir.

### 1.2 Yeni Kaynak Gercegi

Production path icin source of truth su olmalidir:

```text
Original video + capture metadata
```

Mobilde uretilen pose landmark frame'leri artik final export kaynagi olmamalidir. Bunlar sadece:

- Live skeleton preview.
- Capture quality score.
- Full-body visible kontrolu.
- Bad frame uyarilari.
- Debug artifact.
- Backend result karsilastirma/golden sample yardimcisi.

### 1.3 Mobil Export Karari

Mevcut mobil export sistemi hemen silinmemeli. Ancak production path olmaktan cikarilmalidir.

Yeni karar:

- `TakeExporter`, `BVHWriter`, `AnimationBake`, cleanup ve retarget kodlari once debug/dev path olarak korunur.
- Bu kodlar backend worker icin referans/golden output kaynagi olarak kullanilir.
- Production export UI, backend'den gelen `ExportFile` kayitlarini gosterir.
- Mobilde local BVH/GLB/FBX/USD export sadece `dev/debug` flag arkasinda kalir.

## 2. Mevcut Kod Tabanı Audit'i

Bu plan mevcut repo gercegine gore revize edilmistir.

### 2.1 Mevcut Mobil Stack

Repo bugun su teknolojilerle calisiyor:

- React Native + TypeScript.
- Expo dev client.
- iOS native Swift bridge.
- Android native Kotlin bridge.
- removed native vision runtime native entegrasyonu.
- Zustand state.
- Local file persistence.
- React Navigation.
- Three.js avatar preview.

### 2.2 Mevcut Native Pose Engine

Mevcut native katman:

- `ios/MocapExpo/pose/PoseEngineModule.swift`
- `ios/MocapExpo/pose/PoseCameraSession.swift`
- `ios/MocapExpo/pose/RemovedPoseRunner.swift`
- `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseEngineModule.kt`
- `android/app/src/main/java/com/anonymous/MocapExpo/pose/PoseCameraSession.kt`
- `android/app/src/main/java/com/anonymous/MocapExpo/pose/RemovedPoseRunner.kt`

Mevcut `PoseCameraSession.swift` `AVCaptureVideoDataOutput` ile frame stream aliyor. Bu yapi live inference ve preview icin dogru, fakat production upload icin video dosyasi uretmiyor.

Kritik gap:

```text
Bugun native kamera frame stream veriyor.
Hedef mimari video file recording istiyor.
Bu nedenle CameraEngine/VideoRecorder ilk teknik blocker'dir.
```

### 2.3 Mevcut Kayit Akisi

Mevcut kayit akisi video degil, pose frame kaydidir.

Ilgili dosyalar:

- `src/features/capture/hooks/useWhamCapture.ts`
- `src/features/capture/hooks/useRecorder.ts`
- `src/infra/persistence/TakeRepo.fs.ts`
- `src/infra/persistence/takeRepoFs.reader.ts`

Bugunku akis:

```text
Camera preview baslar
  -> native PoseEngine frame event emit eder
  -> useWhamCapture frame'i smooth eder ve store'a yazar
  -> kayit aktifse useRecorder.pushFrame calisir
  -> takeRepoFs chunk olarak JSONL pose frame yazar
  -> stopRecording local review/cleanup metasi uretir
```

Yeni backend-core mimaride bu akis degismeli:

```text
Camera preview baslar
  -> PoseEngine sadece preview/quality icin frame emit eder
  -> CameraEngine ayni anda video dosyasi yazar
  -> stopRecording video path + metadata uretir
  -> UploadManager backend'e yukler
  -> ProcessingJob baslatilir
```

### 2.4 Mevcut Mobil Export Pipeline

Mevcut export path oldukca gelismis:

- `src/domain/mocap/pipeline/export/TakeExporter.ts`
- `src/domain/mocap/pipeline/export/BVHWriter.ts`
- `src/domain/mocap/pipeline/export/AnimationBake.ts`
- `src/domain/mocap/pipeline/export/GltfWriter.ts`
- `src/domain/mocap/pipeline/export/FbxWriter.ts`
- `src/domain/mocap/pipeline/export/UsdWriter.ts`
- `src/domain/mocap/pipeline/cleanup/PoseCleanupPipeline.ts`
- `src/domain/mocap/pipeline/retarget/RetargetSolver.ts`
- `src/domain/mocap/pipeline/avatar/AvatarMotion.ts`

Bu kodlar bugun local pose frame'lerden JSON, BVH, GLB, glTF, FBX ve USD uretebiliyor. Bu iyi bir temel ama yanlis yerde duruyor. Production hedefte bu katman backend worker veya shared backend package tarafina tasinmalidir.

Onemli karar:

```text
Bu solver/export kodu cope atilmayacak.
Once test/golden sample ile sabitlenecek.
Sonra backend-core tarafina tasinacak veya backend worker tarafindan cagrilabilir hale getirilecek.
```

### 2.5 Mevcut Dual-Camera Prototipi

Mevcut proje dual-camera icin onemli prototiplere sahip:

- `src/features/capture/hooks/useMultiViewCapture.ts`
- `src/features/capture/screens/MultiViewSetupScreen.tsx`
- `src/infra/networking/PeerHost.ts`
- `src/infra/networking/PeerGuest.ts`
- `src/infra/networking/TimeSync.ts`
- `src/domain/mocap/pipeline/triangulation/FrameMatcher.ts`
- `src/domain/mocap/pipeline/triangulation/Triangulator.ts`
- `src/domain/mocap/pipeline/calibration/StereoCalibration.ts`

Bugunku dual-camera sistemi landmark stream eslestirme ve live triangulation prototipidir. Backend multi-video reconstruction ile birebir ayni sey degildir.

Yeni rolu:

- Session UX icin referans.
- Host/guest pairing mantigi icin referans.
- Calibration UX icin referans.
- Triangulation matematik prototipi icin referans.

Production V2'de asil kaynak iki cihazdan yuklenen video dosyalari olacaktir.

### 2.6 Bos veya Zayif Katmanlar

Su dosyalar bugun bos:

- `src/app/di/container.ts`
- `src/domain/mocap/services/MocapSessionService.ts`
- `src/domain/mocap/services/ExportService.ts`

Backend-core geciste bunlar kritik hale gelecek. Uygulama ekranlari dogrudan `takeRepoFs` veya `TakeExporter` kullanmak yerine repository/use-case interface'leri uzerinden calismalidir.

### 2.7 Test Gapi

`package.json` icinde su an test script'i yok. Sadece:

- `typecheck`
- `bundle:check`

Production mocap hedefi icin bu yeterli degil. Ozellikle su alanlarda test zorunlu:

- BVH hierarchy.
- Rotation order.
- Coordinate conversion.
- Root motion.
- Skeleton bone length consistency.
- Cleanup pipeline.
- Upload state machine.
- Processing job state mapping.
- Backend worker artifact validation.

## 3. Hedef Production Mimarisi

### 3.1 Genel Sistem

```text
Mobile App
  - CameraEngine video recording
  - PosePreviewEngine live skeleton preview
  - QualityEngine capture validation
  - Session client
  - UploadManager
  - Processing status UX
  - Export result UX

Backend API
  - Auth
  - Users
  - Projects
  - Capture sessions
  - Takes
  - Capture devices
  - Upload sessions
  - Processing jobs
  - Export files
  - Signed URLs
  - Access control

Processing Workers
  - Video ingest
  - Video normalization
  - Frame extraction
  - Pose detection
  - Sync alignment
  - Camera calibration
  - 3D reconstruction
  - Skeleton solve
  - Cleanup/IK/foot locking
  - Export generation
  - Preview render

Storage
  - Original videos
  - Normalized videos
  - Metadata JSON
  - Pose artifacts
  - Solved motion artifacts
  - Export files
  - Preview files

Queue
  - Async processing
  - Retry
  - Priority
  - Dead-letter queue

Observability
  - Logs
  - Metrics
  - Job timeline
  - Artifact lineage
  - Error reports
```

### 3.2 Production Product Meaning

"Move.ai gibi" hedef su anlama gelmelidir:

- Kullanici icin capture akisi basit.
- Sistem ham videodan kullanilabilir animasyon uretir.
- Birden fazla kamera senaryosuna hazirdir.
- Processing asenkron ve izlenebilirdir.
- Export dosyalari Blender/Unity/Unreal gibi DCC ve engine'lerde acilabilir.
- Kalite raporu verilir.
- Hatalar teknik stack trace olarak degil, aksiyon alinabilir mesajlarla sunulur.
- Kullanici videosu guvenli saklanir ve retention politikasina tabidir.
- Maliyet ve processing suresi kontrol edilebilir.

Bu seviyeye tek sprintte cikilmaz. Asil hedef, dogru cekirdegi kurup kaliteyi asamalarla artirmaktir.

## 4. Sorumluluk Ayrimi

### 4.1 Mobil App Sorumluluklari

Mobil app:

- Kamera izni ve preview.
- Video kaydi.
- Live skeleton preview.
- Capture quality score.
- Full body visible kontrolu.
- FPS/lighting/distance/multi-person uyarilari.
- Project/take/session yaratma UX'i.
- Upload progress.
- Retry/resume upload UX'i.
- Processing status.
- Result preview.
- Export download/share.

Mobil app yapmamali:

- Final BVH/FBX/GLB production export.
- Production skeleton solving.
- Production multi-camera reconstruction.
- Production foot locking.
- Production retarget preset solving.

### 4.2 Backend API Sorumluluklari

Backend API:

- Kullanici ve auth.
- Project/take/session entity'leri.
- Capture device registration.
- Signed upload URL uretimi.
- Upload complete validation.
- Processing job create/cancel/retry.
- Job status ve progress.
- Export list/download URL.
- Access control.
- Retention policy.

Backend API video processing yapmamali. Sadece orchestration yapmali.

### 4.3 Processing Core Sorumluluklari

Processing core:

- Original video download.
- FFmpeg normalization.
- Orientation/timebase/fps duzeltme.
- Frame extraction veya streaming decode.
- Pose detection.
- Pose artifact yazma.
- Temporal smoothing.
- Skeleton normalization.
- Rotation solve.
- IK cleanup.
- Foot locking.
- Export generation.
- Preview render.
- Quality metrics.
- Artifact upload.
- Job status update.

## 5. Monorepo Hedef Yapisi

Mevcut repo bugun mobile-app repo gibi duruyor. Production hedef icin monorepo onerisi:

```text
mocap-platform/
  apps/
    mobile/
      src/
      ios/
      android/

    web-dashboard/
      src/

  services/
    api-backend/
      src/
      test/

    processing-worker/
      src/
      tests/

    export-worker/
      src/
      tests/

  packages/
    mocap-schema/
    skeleton-core/
    export-formats/
    shared-types/
    quality-metrics/

  infra/
    docker/
    k8s/
    terraform/
    local-dev/

  docs/
    architecture/
    api/
    processing/
    capture-guides/
    qa/
```

Kisa vadede tum repo hemen monorepo'ya tasinmak zorunda degil. Ilk adim mevcut repo icinde sinirlari kurmaktir:

```text
src/
  app/
    config/
    di/
    navigation/

  features/
    capture/
    projects/
    upload/
    processing/
    exports/
    review/

  domain/
    mocap/
      models/
      services/
      pipeline/        # debug/local veya shared candidate

  infra/
    api/
    persistence/
    upload/
    networking/
```

## 6. Mobil Refactor Plani

### 6.1 Yeni Mobil Katmanlar

```text
src/features/capture/
  presentation/
    CaptureSetupScreen.tsx
    CaptureRecordingScreen.tsx
    CaptureQualityPanel.tsx
  domain/
    CaptureSession.ts
    CaptureQuality.ts
    CameraEngine.ts
  data/
    NativeCameraEngine.ts
    PosePreviewEngine.ts

src/features/upload/
  presentation/
    UploadProgressScreen.tsx
  domain/
    UploadSession.ts
    UploadState.ts
    UploadManager.ts
  data/
    SignedUrlUploadManager.ts

src/features/processing/
  presentation/
    ProcessingStatusScreen.tsx
  domain/
    ProcessingJob.ts
    ProcessingStatus.ts
  data/
    ProcessingApiRepository.ts

src/features/exports/
  presentation/
    ExportResultScreen.tsx
  domain/
    ExportFile.ts
  data/
    ExportApiRepository.ts

src/infra/api/
  ApiClient.ts
  MocapApi.ts
  errors.ts

src/app/config/
  env.ts
```

### 6.2 CameraEngine

Yeni `CameraEngine` interface'i:

```ts
export type StartVideoRecordingOptions = {
  takeId: string;
  deviceId: string;
  targetFps: number;
  cameraPosition: "front" | "back";
  orientation: "portrait" | "landscape-left" | "landscape-right";
};

export type VideoRecordingResult = {
  localVideoUri: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  codec?: string;
  fileSizeBytes?: number;
};

export interface CameraEngine {
  startPreview(): Promise<void>;
  stopPreview(): Promise<void>;
  startVideoRecording(options: StartVideoRecordingOptions): Promise<void>;
  stopVideoRecording(): Promise<VideoRecordingResult>;
}
```

iOS implementasyon:

- Kisa yol: `AVCaptureMovieFileOutput`.
- Daha kontrollu yol: `AVAssetWriter`.

Bu proje icin onerilen yol `AVAssetWriter`:

- Cunku mevcut `AVCaptureVideoDataOutput` pose preview icin kullaniliyor.
- Ayni sample buffer stream'inden hem preview/inference hem video writing yapilabilir.
- Timestamp/timebase kontrolu daha iyi olur.
- Metadata ve sync icin daha esnek olur.

Android implementasyon:

- CameraX `Recorder` veya MediaRecorder tabanli yapi.
- Pose preview icin ImageAnalysis ayri kalabilir.
- Video output ve inference stream ayni camera lifecycle icinde koordine edilmeli.

### 6.3 PosePreviewEngine

Mevcut `PoseEngine` kalmali ama sorumlulugu daraltilmali:

- Live skeleton preview.
- Quality metrics.
- Bad frame warning.
- Full body lock.
- Calibration readiness.

Production path icin `PoseFrame` chunk yazma default olmamali.

Yeni mod:

```text
MOCAP_LOCAL_FRAME_RECORDING=debug
```

Bu flag acik degilse:

- `useRecorder` pose frame chunk yazmaz.
- `TakeExporter` production UI'da gorunmez.
- Capture sonucunda video upload flow baslar.

### 6.4 Capture Quality Score

Mobilde hesaplanacak kalite metrikleri:

- Average pose confidence.
- Full body visible ratio.
- Required joints visible ratio.
- Tracking loss count.
- Bad frame count.
- Approx subject distance.
- Pose FPS stability.
- Device orientation stability.
- Lighting estimate.
- Motion blur estimate.
- Multi-person contamination.
- Subject out-of-frame ratio.

V1 icin zorunlu olanlar:

- `averagePoseConfidence`
- `fullBodyVisibleRatio`
- `badFrames`
- `poseFpsAverage`
- `trackingLossCount`

V2 icin eklenecekler:

- `lightingScore`
- `motionBlurScore`
- `subjectDistanceScore`
- `multiPersonDetected`

### 6.5 Capture Metadata

Her video ile birlikte metadata JSON yuklenmeli:

```json
{
  "schema": "mocap.capture_metadata.v1",
  "takeId": "take_123",
  "captureSessionId": "session_456",
  "deviceId": "device_iphone_1",
  "deviceRole": "primary",
  "deviceIndex": 0,
  "recordingStartedAt": "2026-05-06T10:22:31.120Z",
  "recordingEndedAt": "2026-05-06T10:22:42.870Z",
  "durationMs": 11750,
  "video": {
    "fps": 60,
    "width": 1920,
    "height": 1080,
    "codec": "h264",
    "orientation": "portrait",
    "isMirrored": false,
    "fileSizeBytes": 48239120
  },
  "camera": {
    "position": "back",
    "focalLengthMm": 26,
    "intrinsics": null,
    "lensModel": "wide"
  },
  "quality": {
    "averagePoseConfidence": 0.87,
    "fullBodyVisibleRatio": 0.92,
    "badFrames": 14,
    "trackingLossCount": 2,
    "poseFpsAverage": 29.8
  },
  "sync": {
    "syncMethod": "single_device",
    "clockOffsetMs": 0,
    "audioSyncMarker": null
  },
  "app": {
    "version": "1.0.0",
    "platform": "ios",
    "buildNumber": "1"
  }
}
```

Dual-camera icin ek metadata:

```json
{
  "captureMode": "dual_camera",
  "multiCameraSessionId": "session_456",
  "deviceIndex": 1,
  "approxCameraAngle": "front_left",
  "syncMethod": "audio_clap",
  "calibrationClipId": "calib_789"
}
```

### 6.6 Yeni Capture Flow

Production V1 capture flow:

```text
1. Kullanici project secer veya olusturur.
2. App backend'de take yaratir.
3. Backend takeId ve upload policy dondurur.
4. App camera preview baslatir.
5. PosePreviewEngine kalite skoru uretir.
6. Kullanici record baslatir.
7. CameraEngine local video dosyasina yazar.
8. PosePreviewEngine sadece kalite metriklerini toplar.
9. Kullanici record durdurur.
10. CameraEngine video result dondurur.
11. CaptureMetadata olusturulur.
12. UploadManager video + metadata upload eder.
13. Upload complete endpoint cagrilir.
14. Processing job baslatilir.
15. App ProcessingStatusScreen'e gider.
16. Job tamamlaninca ExportResultScreen acilir.
```

Offline veya backend gecici olarak yoksa:

- Local provisional take yaratilir.
- Video local queue'ya alinir.
- Kullaniciya "upload bekliyor" durumu gosterilir.
- Network gelince upload edilir.

## 7. Backend API Tasarimi

### 7.1 Teknoloji Karari

Iki mantikli secenek var:

1. Spring Boot API + Python workers.
2. NestJS API + Python workers.

Bu proje icin onerilen production secim:

```text
API Backend: Spring Boot veya NestJS
DB: PostgreSQL
Queue: Redis Queue, BullMQ, RabbitMQ veya SQS
Storage: S3-compatible object storage
Processing: Python 3.11+
Video: FFmpeg
Pose: removed pose runtime Python V1, sonra RTMPose/ViTPose/Sapiens opsiyonlari
```

Ilk MVP icin API teknolojisi processing kalitesinden daha az kritik. Kritik olan API contract, storage layout ve job state machine'in dogru kurulmasidir.

### 7.2 Core Entity'ler

```text
User
Project
CaptureSession
Take
CaptureDevice
CaptureVideo
CaptureMetadata
UploadSession
ProcessingJob
ProcessingArtifact
SkeletonSolve
ExportFile
QualityReport
```

### 7.3 Take

```json
{
  "id": "take_001",
  "projectId": "project_001",
  "captureSessionId": "session_001",
  "name": "Take 01",
  "captureMode": "single_camera",
  "status": "uploaded",
  "durationMs": 12300,
  "createdAt": "2026-05-06T10:01:00Z",
  "updatedAt": "2026-05-06T10:03:00Z"
}
```

### 7.4 CaptureVideo

```json
{
  "id": "video_001",
  "takeId": "take_001",
  "deviceId": "device_001",
  "deviceIndex": 0,
  "role": "primary",
  "storageKey": "takes/take_001/original/device_0.mov",
  "metadataStorageKey": "takes/take_001/metadata/device_0.json",
  "fps": 60,
  "width": 1920,
  "height": 1080,
  "durationMs": 12300,
  "status": "uploaded",
  "uploadedAt": "2026-05-06T10:03:00Z"
}
```

### 7.5 ProcessingJob

```json
{
  "id": "job_001",
  "takeId": "take_001",
  "type": "motion_solve",
  "status": "POSE_DETECTION",
  "progress": 42,
  "currentStage": "Detecting pose landmarks",
  "errorCode": null,
  "errorMessage": null,
  "createdAt": "2026-05-06T10:04:00Z",
  "startedAt": "2026-05-06T10:05:00Z",
  "finishedAt": null
}
```

### 7.6 ExportFile

```json
{
  "id": "export_001",
  "takeId": "take_001",
  "jobId": "job_001",
  "format": "BVH",
  "preset": "BLENDER_HUMANOID",
  "storageKey": "takes/take_001/exports/blender/result.bvh",
  "status": "ready",
  "qualityScore": 82,
  "createdAt": "2026-05-06T10:15:00Z"
}
```

### 7.7 API Endpoints

Project:

```text
POST   /api/projects
GET    /api/projects
GET    /api/projects/{projectId}
PATCH  /api/projects/{projectId}
DELETE /api/projects/{projectId}
```

Take:

```text
POST   /api/projects/{projectId}/takes
GET    /api/takes/{takeId}
GET    /api/projects/{projectId}/takes
PATCH  /api/takes/{takeId}
DELETE /api/takes/{takeId}
```

Upload:

```text
POST /api/takes/{takeId}/uploads/init
POST /api/takes/{takeId}/uploads/complete
GET  /api/takes/{takeId}/uploads
```

Upload init response:

```json
{
  "uploadId": "upload_001",
  "videoUploadUrl": "https://signed-url/video",
  "metadataUploadUrl": "https://signed-url/metadata",
  "videoStorageKey": "takes/take_001/original/device_0.mov",
  "metadataStorageKey": "takes/take_001/metadata/device_0.json",
  "expiresAt": "2026-05-06T10:30:00Z"
}
```

Processing:

```text
POST /api/takes/{takeId}/process
GET  /api/takes/{takeId}/jobs/latest
GET  /api/jobs/{jobId}
POST /api/jobs/{jobId}/cancel
POST /api/jobs/{jobId}/retry
```

Exports:

```text
POST /api/takes/{takeId}/exports
GET  /api/takes/{takeId}/exports
GET  /api/exports/{exportId}
GET  /api/exports/{exportId}/download-url
```

### 7.8 Job State Machine

```text
CREATED
UPLOADING
UPLOADED
QUEUED
TRANSCODING
EXTRACTING_FRAMES
POSE_DETECTION
RECONSTRUCTING_3D
SOLVING_SKELETON
CLEANING_MOTION
EXPORTING
VALIDATING_EXPORT
COMPLETED
```

Failure states:

```text
FAILED_UPLOAD
FAILED_TRANSCODE
FAILED_FRAME_EXTRACTION
FAILED_POSE_DETECTION
FAILED_RECONSTRUCTION
FAILED_SKELETON_SOLVE
FAILED_EXPORT
FAILED_VALIDATION
CANCELLED
```

Kullaniciya gosterilecek mesajlar teknik status'tan map edilmeli:

```text
POSE_DETECTION -> "Videodaki vucut hareketi analiz ediliyor."
SOLVING_SKELETON -> "Animasyon iskeleti olusturuluyor."
EXPORTING -> "Blender uyumlu dosya hazirlaniyor."
FAILED_POSE_DETECTION -> "Videoda yeterli vucut takibi yapilamadi. Daha aydinlik ve tam vucut gorunen bir kayit deneyin."
```

## 8. Object Storage Layout

```text
takes/
  {takeId}/
    original/
      device_0.mov
      device_1.mov
    metadata/
      device_0.json
      device_1.json
    normalized/
      device_0.mp4
      device_1.mp4
    frames/
      device_0/
        frame_000001.jpg
    pose/
      device_0_pose_frames.json
      device_1_pose_frames.json
    reconstruction/
      triangulated_3d.json
    solve/
      solved_motion.json
      quality_report.json
    preview/
      preview.glb
      preview.mp4
    exports/
      blender/
        result.bvh
      unity/
        result.glb
      raw/
        pose_frames.json
```

Retention policy bu layout uzerinden uygulanmali:

- Original video ayri silinebilir.
- Export dosyalari daha uzun saklanabilir.
- Debug frame image'leri kisa sureli saklanabilir.
- Enterprise plan icin retention override olabilir.

## 9. Processing Worker Tasarimi

### 9.1 Worker Paket Yapisi

```text
processing-worker/
  src/
    main.py
    config.py

    pipeline/
      ingest_pipeline.py
      video_normalization_pipeline.py
      frame_extraction_pipeline.py
      pose_detection_pipeline.py
      reconstruction_pipeline.py
      skeleton_solve_pipeline.py
      cleanup_pipeline.py
      export_pipeline.py
      validation_pipeline.py

    pose/
      pose_detector.py
      removed_pose_runtime_pose_detector.py
      pose_frame.py

    skeleton/
      skeleton_definition.py
      bone.py
      joint.py
      rotation_solver.py
      ik_solver.py
      foot_locking.py

    export/
      bvh_exporter.py
      glb_exporter.py
      fbx_exporter.py

    storage/
      object_storage_client.py

    queue/
      job_consumer.py

    api/
      backend_client.py

    observability/
      logger.py
      metrics.py

  tests/
    test_bvh_exporter.py
    test_rotation_solver.py
    test_smoothing.py
    test_job_state_machine.py
```

### 9.2 V1 Single-Camera Pipeline

```text
Input:
  original video + metadata

Pipeline:
  1. Download original video.
  2. Validate checksum, duration, codec, resolution.
  3. Normalize orientation/fps/timebase with FFmpeg.
  4. Extract frames or stream decode.
  5. Run removed pose runtime Pose Landmarker Python.
  6. Store pose_frames.json.
  7. Apply confidence-aware smoothing.
  8. Normalize skeleton bone lengths.
  9. Solve joint rotations.
  10. Apply root stabilization.
  11. Apply basic foot contact detection.
  12. Export BVH + JSON.
  13. Validate export.
  14. Upload artifacts.
  15. Update job status.
```

V1 amaci Move.ai kalitesi degil, dogru backend-core pipeline'i kanitlamaktir:

```text
video -> backend pose -> backend solved motion -> backend BVH -> Blender'da makul acilis
```

### 9.3 V1.5 Solver Stabilization

Bu asama quality icin zorunludur:

- Golden sample videolari.
- Blender import validation.
- Rest pose calibration.
- Root/hip transform testleri.
- Rotation order testleri.
- Coordinate system testleri.
- Foot sliding metric.
- Bone length consistency metric.
- Left/right swap detection.

Mevcut TS export/solver kodu burada kullanilabilir:

```text
Option A:
  skeleton-core package olarak TypeScript kodunu backend worker'da Node ile kullan.

Option B:
  Python'a kontrollu port et, her port edilen parcayi golden output ile karsilastir.
```

Oneri:

```text
Once Option A ile hizli backend export kanitla.
Sonra kritik solver parcalarini Python'a veya shared Rust/C++ core'a tasimayi degerlendir.
```

### 9.4 V2 Dual-Camera Pipeline

Dual-camera V2 source of truth iki video olmalidir:

```text
iPhone A video + metadata
iPhone B video + metadata
  -> audio clap/beep sync
  -> per-camera 2D pose detection
  -> camera calibration
  -> triangulation
  -> 3D joint reconstruction
  -> skeleton solve
  -> cleanup/IK
  -> export
```

Mevcut live dual-camera kodu V2 icin sunlari saglar:

- Pairing UX fikri.
- Host/guest role modeli.
- Time sync prototipi.
- Frame matching toleranslari.
- Triangulation prototipi.

Ama V2 backend'de:

- Landmark stream degil video upload islenecek.
- Sync audio waveform veya visual marker ile yapilacak.
- Calibration clip kalici artifact olacak.
- Per-camera pose JSON saklanacak.
- Reconstruction tekrar calistirilabilir olacak.

### 9.5 V3 Four-Camera / Pro Mode

V3 hedef:

```text
4 camera videos
  -> time synchronization
  -> camera calibration
  -> multi-view 2D keypoint detection
  -> cross-view identity matching
  -> 3D triangulation
  -> occlusion recovery
  -> biomechanical constraints
  -> IK solve
  -> foot locking
  -> retarget-ready export
```

V3'e gecmeden once V1 ve V2'de su kanitlanmali:

- Tek kamera backend export stabil.
- Dual-camera upload ve sync calisiyor.
- Triangulated output tek kameradan daha iyi kalite skoru veriyor.
- Blender import validation otomatik calisiyor.

## 10. Skeleton ve Export Kalite Gereksinimleri

Production mocap'in en riskli katmani skeleton solving ve export'tur.

### 10.1 SkeletonDefinition

Backend'de canonical skeleton tanimi olmali:

```json
{
  "name": "MocapHumanoidV1",
  "root": "hips",
  "coordinateSystem": "Y_UP_RIGHT_HANDED",
  "rotationOrder": "ZXY",
  "joints": [
    {
      "name": "hips",
      "parent": null,
      "channels": ["Xposition", "Yposition", "Zposition", "Zrotation", "Xrotation", "Yrotation"]
    },
    {
      "name": "spine",
      "parent": "hips",
      "channels": ["Zrotation", "Xrotation", "Yrotation"]
    }
  ]
}
```

### 10.2 Export Presetleri

V1:

- JSON raw/solved artifact.
- BVH Blender Basic Humanoid.

V1.5:

- GLB preview.
- Blender retarget preset.

V2:

- Unity Humanoid.
- Unreal Manny.

V3:

- MetaHuman.
- Mixamo.
- VRM.
- USD.

### 10.3 Export Validation

Her export icin otomatik validation:

- Dosya yazildi mi?
- Frame count dogru mu?
- Duration dogru mu?
- Root joint mevcut mu?
- Joint hierarchy valid mi?
- Rotation NaN/Infinity var mi?
- Kemik uzunluklari stabil mi?
- Blender import smoke test geciyor mu?
- Foot sliding score threshold altinda mi?

Blender validation production icin cok degerli:

```text
headless blender script
  -> BVH import
  -> frame count check
  -> skeleton hierarchy check
  -> bounding box sanity check
  -> render/preview optional
```

## 11. Mobil UX Revizyonu

### 11.1 Hedef Ekranlar

Mevcut ekranlar korunup evrilebilir:

```text
Mevcut CaptureScreen
  -> CaptureSetupScreen + CaptureRecordingScreen olarak ayrilabilir.

Mevcut ProjectsListScreen
  -> backend Project listesine baglanacak.

Mevcut ExportScreen
  -> local export yerine backend ExportResultScreen olacak.

Mevcut Review screens
  -> local frame review yerine backend quality/artifact review'a evrilecek.
```

Yeni ekranlar:

- `ProjectListScreen`
- `ProjectDetailScreen`
- `CaptureSetupScreen`
- `CaptureRecordingScreen`
- `UploadProgressScreen`
- `ProcessingStatusScreen`
- `ExportResultScreen`
- `ProcessingErrorScreen`

### 11.2 Processing Status UX

Kullanici status'u sade gormeli:

```text
Uploading video
Waiting in queue
Preparing video
Detecting body movement
Solving skeleton
Cleaning animation
Generating Blender export
Ready
```

Teknik detaylar hidden/debug panelde olabilir:

```text
TRANSCODING
POSE_DETECTION
SOLVING_SKELETON
EXPORTING
```

### 11.3 Error UX

Teknik hata -> kullanici mesaji:

```text
FAILED_UPLOAD
  "Video yuklenemedi. Baglantinizi kontrol edip tekrar deneyin."

FAILED_POSE_DETECTION
  "Videoda vucut yeterince net algilanamadi. Tam vucut gorunen, daha aydinlik bir kayit deneyin."

FAILED_EXPORT
  "Animasyon dosyasi olusturulamadi. Kaydi tekrar islemeyi deneyin."
```

## 12. Guvenlik, Gizlilik ve Retention

Bu urun kullanici videosu isledigi icin privacy temel urun ozelligidir.

Gerekenler:

- Signed upload URL.
- Private bucket.
- Token-based auth.
- Per-user project isolation.
- Temporary download URL.
- Audit log.
- Delete take/project.
- Delete account.
- Retention policy.
- Processing consent.

Kayit oncesi kullanici izni:

```text
Bu video motion capture animasyonu uretmek icin backend sunucularinda islenecektir.
```

Retention onerisi:

```text
Free:
  original video 7 gun
  exports 30 gun

Pro:
  original video 30/90 gun
  exports kalici veya uzun sureli

Enterprise:
  custom retention
```

## 13. Maliyet ve Operasyon

Video processing maliyetlidir. En bastan kontrol mekanizmalari olmali:

- Maksimum video suresi.
- Maksimum resolution.
- Upload size limit.
- Free/pro job priority.
- Queue concurrency limit.
- CPU/GPU worker ayrimi.
- Retry limit.
- Dead-letter queue.
- Original video retention.
- Frame extraction artifact TTL.
- Preview artifact compression.

V1 CPU worker ile baslayabilir. GPU gereksinimi model stratejisine gore V2/V3'te gelir.

## 14. QA ve Production Readiness

### 14.1 Golden Dataset

Minimum golden sample set:

- T-pose/A-pose kalibrasyon.
- Yurume.
- Kosuya yakin hizli hareket.
- Donus.
- Comelme.
- Ziplama.
- Kol govde onunde crossing.
- Kismi occlusion.
- Dusuk isik.
- Yan kamera acisi.
- Dual-camera clap sync sample.

Her sample icin beklenenler:

- Pose detection success.
- Export generated.
- Blender import passes.
- Quality score threshold.
- Known issue tags.

### 14.2 Test Katmanlari

Mobile:

- Typecheck.
- API client unit tests.
- Upload state machine tests.
- Metadata builder tests.
- Status mapping tests.

Backend API:

- Entity/repository tests.
- Upload init/complete tests.
- Access control tests.
- Job state machine tests.

Worker:

- FFmpeg normalize smoke tests.
- Pose detector interface tests.
- Smoothing tests.
- Rotation solver tests.
- BVH writer tests.
- Export validation tests.

End-to-end:

```text
sample video
  -> upload
  -> process
  -> export
  -> download
  -> blender import validation
```

## 15. Revize Migration Plan

### Sprint 0 - Architecture Freeze ve Audit

Amac:

Mevcut projeyi backend-core gecise hazirlayacak teknik sinirlari netlestirmek.

Yapilacaklar:

- Mevcut local frame recording akisinin dokumani.
- Mevcut local export pipeline dokumani.
- Native camera video recording gap dokumani.
- Backend API contract v1.
- Capture metadata schema v1.
- Processing job state machine v1.
- Mobile debug/local export karari.

Cikti:

- `docs/architecture/backend-core-architecture.md`
- `docs/api/api-contract-v1.md`
- `docs/processing/worker-pipeline-v1.md`
- `docs/capture/capture-metadata-v1.md`
- `docs/migration/mobile-backend-core-migration.md`

Kabul kriteri:

- Hangi kod production kalacak, hangi kod debug olacak net.
- Video recording blocker olarak kayitli.
- Backend contract ekran gelistirmeye yetecek kadar net.

### Sprint 1 - Native Video Recording Foundation

Amac:

Mobil app'in gercek video dosyasi uretebilmesi.

Yapilacaklar:

- `CameraEngine` interface.
- iOS `VideoRecorder` implementasyonu.
- Android video recorder implementasyonu.
- Preview + pose inference ile ayni anda video recording testi.
- Local video path result.
- Basic video metadata extraction.
- Recording start/stop error handling.

Cikti:

```text
iPhone/Android kayit alir
  -> local .mov/.mp4 dosyasi uretir
  -> duration/fps/resolution metadata dondurur
```

Kabul kriteri:

- 10-30 saniyelik video stabil kaydedilir.
- Preview bozulmaz.
- Pose preview calismaya devam eder.
- App kapanmadan local file path okunabilir.

### Sprint 2 - Backend API ve Upload Temeli

Amac:

Project/Take/Upload/Job backend temelini kurmak.

Yapilacaklar:

- API backend skeleton.
- PostgreSQL schema.
- Project entity.
- Take entity.
- CaptureVideo entity.
- UploadSession entity.
- ProcessingJob entity.
- Signed URL upload init.
- Upload complete.
- Job create.
- Job status.
- Local dev docker compose.

Cikti:

```text
App backend'de take yaratabilir
  -> signed upload URL alabilir
  -> upload complete isaretleyebilir
  -> processing job baslatabilir
  -> job status okuyabilir
```

Kabul kriteri:

- API contract mobil tarafla uyumlu.
- Upload complete olmadan job baslamaz.
- User/project isolation temeli var.

### Sprint 3 - Mobile Upload ve Processing Status UX

Amac:

Mobilin capture-client davranisini tamamlamak.

Yapilacaklar:

- `ApiClient`.
- `MocapApi`.
- `UploadManager`.
- Upload progress state.
- Retry support.
- Metadata builder.
- `UploadProgressScreen`.
- `ProcessingStatusScreen`.
- Capture stop sonrasi upload flow.
- Backend URL env config.

Cikti:

```text
Record video
  -> metadata build
  -> upload
  -> complete
  -> start processing
  -> status screen
```

Kabul kriteri:

- Hardcoded backend URL yok.
- Upload failure retry edilebilir.
- Kullanici upload/processing durumunu gorur.
- Local pose frame export production path'ten cikmis olur.

### Sprint 4 - Worker V1 Pose Extraction

Amac:

Backend yuklenen videodan pose artifact uretir.

Yapilacaklar:

- Worker queue consumer.
- Object storage download.
- FFmpeg normalize.
- Frame extraction.
- removed pose runtime Python PoseDetector.
- `pose_frames.json` artifact.
- Job progress update.
- Error handling.

Cikti:

```text
uploaded video -> pose_frames.json
```

Kabul kriteri:

- Sample videoda pose artifact uretir.
- Job status UI'da guncellenir.
- Failed pose detection kullaniciya anlamli doner.

### Sprint 5 - Backend Export V1

Amac:

Backend ilk BVH/JSON export'u uretir.

Yapilacaklar:

- Mevcut mobile `AnimationBake`/`BVHWriter` kodundan backend-usable core cikarma.
- Ya `packages/skeleton-core` olusturma ya da worker icinde kontrollu port.
- SkeletonDefinition v1.
- BVH export.
- JSON solved artifact.
- ExportFile entity.
- Download URL endpoint.
- Blender import smoke test.

Cikti:

```text
video -> backend pose -> backend BVH -> mobile export result
```

Kabul kriteri:

- Blender'da acilan BVH uretilir.
- Export dosyasi app'te listelenir.
- Local mobile export olmadan kullanici export indirebilir.

### Sprint 6 - Cleanup ve Quality V1.5

Amac:

Animasyon kalitesini kullanilabilir seviyeye cikarmak.

Yapilacaklar:

- One-Euro/Kalman/Savitzky-Golay smoothing degerlendirmesi.
- Confidence-aware interpolation.
- Outlier rejection.
- Root stabilization.
- Bone length normalization.
- Left/right swap detection.
- Basic foot contact.
- Basic foot locking.
- Solve quality report.

Cikti:

```text
daha stabil BVH
quality_report.json
user-facing quality score
```

Kabul kriteri:

- Foot sliding metric raporlanir.
- Jitter metric raporlanir.
- Bad input videoda uyarilar anlamli.

### Sprint 7 - Result Preview ve Export UX

Amac:

Kullanici sonucu sadece indirmekle kalmaz, uygulamada anlayabilir.

Yapilacaklar:

- ExportResultScreen.
- Preview GLB veya lightweight animation preview.
- Quality report UI.
- Retry process.
- Error reason display.
- Export preset selection.

Cikti:

```text
processing completed -> preview/result/quality/export UX
```

Kabul kriteri:

- Kullanici hangi export'un hazir oldugunu gorur.
- Download URL ile dosya alir.
- Kalite sorunlarini anlar.

### Sprint 8 - Dual-Camera Backend Session

Amac:

Iki cihazdan ayni take icin video upload etmek.

Yapilacaklar:

- Backend CaptureSession entity.
- Multi-device take.
- QR join.
- Host/guest device registration.
- Shared takeId/sessionId.
- Device index.
- Audio clap/beep sync metadata.
- Multi-video upload grouping.

Cikti:

```text
2 iPhone -> same take -> 2 video upload
```

Kabul kriteri:

- Backend take icinde iki CaptureVideo gorur.
- Job iki videoyu ayni motion solve icin gruplayabilir.

### Sprint 9 - Dual-Camera Reconstruction V1

Amac:

Iki videodan daha iyi 3D joint output almak.

Yapilacaklar:

- Per-camera 2D pose detection.
- Audio waveform sync.
- Calibration clip prototype.
- Camera projection estimate.
- Triangulation.
- Reprojection error metric.
- 3D skeleton solve.
- BVH export.

Cikti:

```text
dual camera video -> triangulated 3D -> cleaner BVH
```

Kabul kriteri:

- Dual-camera quality score single-camera'dan daha iyi olmali.
- Reprojection error raporlanmali.
- Sync offset raporlanmali.

### Sprint 10 - Pro 4-Camera Mode

Amac:

Move.ai benzeri pro capture workflow'a yaklasmak.

Yapilacaklar:

- 4 device session.
- Camera angle guide.
- Calibration capture.
- Multi-view matching.
- Occlusion recovery.
- Multi-view quality score.
- Advanced IK constraints.
- Retarget presets.

Cikti:

```text
4 iPhone capture -> production-grade multi-view solve foundation
```

Kabul kriteri:

- 4 video ayni take altinda islenir.
- Multi-view reconstruction artifact uretilir.
- Kullaniciya camera placement/quality feedback verilir.

## 16. En Buyuk Teknik Riskler

### 16.1 Native Video + Pose Preview Ayni Anda

Risk:

Preview/inference ve video writer ayni camera pipeline'da frame drop veya performans sorunu yaratabilir.

Cozum:

- iOS'ta `AVAssetWriter` spike.
- Android'de CameraX lifecycle spike.
- 30 FPS V1, 60 FPS sonra.
- Thermal/performance logging.

### 16.2 Skeleton Rotation Solve

Risk:

Landmark pozisyonlari makul gorunse bile rig animasyonu bozuk olabilir.

Cozum:

- Canonical skeleton.
- Rotation order tests.
- Rest pose calibration.
- Golden sample.
- Blender validation.

### 16.3 Foot Sliding

Risk:

Tek kamera output'unda foot sliding cok belirgin olur.

Cozum:

- Foot contact detection.
- Root motion correction.
- Leg IK.
- Foot sliding metric.

### 16.4 Backend Maliyet

Risk:

Video upload ve processing maliyeti urun ekonomisini bozabilir.

Cozum:

- Duration limits.
- Resolution limits.
- Queue priority.
- Retention policy.
- CPU/GPU worker ayrimi.
- Plan-based quotas.

### 16.5 Dual-Camera Sync

Risk:

Cihazlar ayni anda baslamaz, timestamp'ler kayar.

Cozum:

- Audio clap/beep sync.
- Timestamp metadata.
- Network time sync yardimci sinyal.
- Frame alignment report.

## 17. Net MVP Kapsami

Ilk backend-core MVP:

- Single iPhone video recording.
- Capture metadata.
- Backend upload.
- Processing job.
- Backend removed pose runtime pose extraction.
- Backend BVH + JSON export.
- Blender-compatible preset.
- Processing status screen.
- Basic quality score.
- Export download.

MVP disi:

- 4 kamera.
- MetaHuman.
- Custom AI model training.
- Real-time cloud streaming.
- Advanced biomechanics.
- Marketplace/export preset ekosistemi.

MVP basari tanimi:

```text
iPhone video kaydeder
  -> backend'e yukler
  -> backend animasyon uretir
  -> Blender'da makul acilir
  -> kullanici sonucu app'te gorur ve indirir
```

## 18. Codex Uygulama Prompt'u - Mobile

```text
We are migrating MocapExpo from a mobile pose-frame recording/export app into a backend-core production markerless motion capture platform.

Current codebase facts:
- React Native TypeScript mobile app.
- Native iOS/Android PoseEngine emits PoseFrame events for live preview.
- Current recording stores PoseFrame/MultiViewPoseFrame chunks through takeRepoFs.
- Current TakeExporter creates local JSON/BVH/GLB/FBX/USD from local pose frames.
- Current native camera preview uses frame output for inference but does not yet write a video file.
- Dual-camera code is a live landmark-stream prototype and should not be treated as the production backend multi-video pipeline.

Target:
- Mobile becomes capture/quality/upload/status/result client.
- Source of truth for production processing is original video + capture metadata.
- On-device removed pose runtime remains only for live skeleton preview and capture quality validation.
- Backend owns final pose extraction, skeleton solve, cleanup, IK, foot locking, and export generation.

Task:
1. Add a CameraEngine abstraction for video recording.
2. Implement native video recording without breaking existing PoseEngine preview.
3. Add CaptureMetadata domain model and builder.
4. Add backend API client interfaces for project/take/upload/job/export.
5. Add UploadManager with progress, retry, metadata upload, signed URL support.
6. Update capture flow so stopRecording returns video + metadata and starts upload/processing.
7. Move local pose-frame recording/export behind a debug flag.
8. Add UploadProgressScreen and ProcessingStatusScreen.
9. Do not delete current TakeExporter; preserve it as debug/reference until backend export is stable.
10. Use env-based backend config and strict TypeScript types.
```

## 19. Codex Uygulama Prompt'u - Backend Worker

```text
Build the backend-core V1 processing worker for MocapExpo.

Goal:
Input: uploaded iPhone video + capture metadata.
Output: pose_frames.json, solved_motion.json, quality_report.json, BVH export.

Requirements:
- Python 3.11+ worker.
- Queue consumer architecture.
- Object storage download/upload.
- FFmpeg video normalization.
- removed pose runtime Pose Landmarker detector behind a PoseDetector interface.
- Confidence-aware pose frame schema.
- Temporal smoothing.
- SkeletonDefinition v1.
- Joint rotation solving.
- Basic root stabilization.
- Basic foot contact detection.
- BVH export.
- Export validation.
- Job progress updates through backend API.
- Strong logging and structured errors.
- No hardcoded paths.
- Config from environment.
- Unit tests for smoothing, BVH hierarchy, rotation solver, and job state mapping.

Do not build a toy demo. Build the production foundation that can later support dual-camera and 4-camera reconstruction.
```

## 20. Son Karar

Bu projeyi Move.ai benzeri production-level bir yapıya cevirmek icin dogru yon backend-core mimaridir.

Ama gecis sirasi kritik:

1. Once video recording eksigi kapatilacak.
2. Mobil source of truth pose frame degil video + metadata olacak.
3. Backend upload/job altyapisi kurulacak.
4. Worker V1 video'dan pose artifact uretecek.
5. Mevcut mobile export/solver kodu referans alinarak backend export uretilecek.
6. Local mobile export debug'a alinacak.
7. Kalite metrikleri ve Blender validation ile export stabilize edilecek.
8. Sonra dual-camera backend pipeline'a gecilecek.
9. En son 4-camera pro mode ve advanced solver gelistirilecek.

Kisa vadeli dogru hedef:

```text
iPhone video kaydeder
  -> backend'e yukler
  -> backend motion solve yapar
  -> backend BVH/JSON export uretir
  -> Blender'da duzgun acilir
  -> mobil sonuc ve kalite raporu gosterir
```

Bu hedef basarildiginda proje artik basit bir pose overlay/export app degil, gercek bir motion capture processing platformunun temeline sahip olur.
