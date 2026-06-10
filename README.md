# MocapExpo

MocapExpo, mobil cihazla kaydedilen videoyu backend'e yükleyip WHAM/SMPL tabanlı motion capture artifact'lerine dönüştüren React Native + Node.js uygulamasıdır.

Bu repo private tutulur. Kod repo'da, gerçek environment değerleri ve lisanslı model asset'leri repo dışında tutulur.

## Güncel Gerçekler

- Single-camera akışı production için korunması gereken ana WHAM yoludur.
- Final animasyon/BVH şu anda primary camera WHAM solve'dan gelir.
- Dual/pro multi-view pipeline; video gruplama, sync, calibration, triangulation, kinematic optimization ve artifact persistence için tam aktiftir.
- Dual/pro hattı final motion kalitesini tek kameraya göre otomatik iyileştirir ve kinematic fitting (dualCameraOptimizer) aracılığıyla "True Dual Solve" üretir.
- Real WHAM çalışması için WHAM repo, checkpoint ve lisanslı SMPL asset'leri gerekir. Bunlar repo'ya commit edilmez.

## Mimari

```text
Mobile app
  -> records video + metadata
  -> uploads to backend signed URLs

Backend API
  -> projects / takes / capture sessions / uploads / jobs / exports
  -> stores records in Postgres
  -> stores videos and artifacts in S3-compatible storage
  -> optionally dispatches jobs to RunPod Serverless

Worker
  -> claims or receives job
  -> downloads uploaded videos
  -> normalizes video
  -> runs WHAM primary video solve
  -> optionally runs diagnostic multi-view reconstruction
  -> writes artifacts and export records

Result screen
  -> reads export list and quality report
  -> shows WHAM outputs and Multi-View Diagnostics when available
```

## Dual Camera Reconstruction Durumu

Bu bölüm mevcut repo davranışını anlatır.

1. Tek kamera WHAM yapısı korunmuştur. `selectedVideoCount <= 1` ve solo capture akışı single-camera WHAM yolunda kalır.
2. Dual/pro capture akışında, backend reconstruction ve ayrı kinematic post-fit stage tam aktiftir. RTMPose kullanılarak 2D noktalar elde edilir, bunlar DLT ile 3D triangulate edilir.
3. Node.js backend üzerindeki `dualCameraOptimizer.ts`, WHAM'ın primary video initialization sonucunu alır ve bu triangulate edilmiş 3D hedeflere göre kinematically fit ederek "True Dual Solve" (optimize edilmiş motion ve BVH) oluşturur.
4. Dual camera pipeline hattı:
   - per-camera 2D pose extraction (RTMPose)
   - frame sync
   - camera calibration (approximate/FOV fallback destekli)
   - DLT triangulation
   - kinematic optimization (Dual Fit)
   - `dual_reconstruction.json`
   - `multi_view_reconstruction.json`
   - `quality_report.multiView` metric'leri
   - `motion_pipeline_report_json` reconstruction stage kayıtları
5. Calibration, sync veya keypoint verisi eksikse sistem fake başarı üretmez. Artifact ve report'larda fallback reason açıkça görünür. Telefon kameralarındaki standart FOV fallback senaryosu artık desteklenmektedir (`acceptApproximateCalibration: true`).
6. Final animation başarıyla optimize edilirse, `finalAnimationSource: "true_dual_solve"` olarak raporlanır ve optimize edilmiş sonuçlar kullanılır. Sadece optimizasyon kalite kapılarını (gates) geçemezse `primary_wham`'a fallback yapılır.
7. Yeni dual/multi-view artifact'leri:
   - `pose_frames_device_0.json`
   - `pose_frames_device_1.json`
   - `multi_view_sync.json`
   - `camera_calibration.json`
   - `dual_reconstruction.json`
   - `multi_view_reconstruction.json`
   - `dual_fit_report.json`
   - `optimized_solved_motion.json`, yalnızca accepted optimized output geçerliyse
   - `optimized_result.bvh`, yalnızca accepted optimized output final BVH kaynağıysa
   - `pose_frames.json`, sadece güvenli diagnostic world-landmark formatı üretildiğinde
8. Yeni metric'ler:
   - `matchedFrameCount`
   - `averageTimeDeltaMs`
   - `syncConfidence`
   - `reprojectionErrorPx`
   - `reprojectionP95Px`
   - `triangulatedLandmarkRatio`
   - `fallbackLandmarkRatio`
   - `calibrationQualityScore`
   - `intrinsicsFallbackUsed`
   - `primaryCameraFallbackUsed`
   - `finalAnimationSource`

## Repoda Olanlar

- React Native / Expo Dev Client mobile app.
- Fastify backend API.
- PostgreSQL repositories and migrations.
- S3-compatible upload/download flow.
- WHAM worker adapter wrapper.
- RunPod Serverless dispatch/worker handler.
- Multi-view reconstruction:
  - pose extraction (RTMPose)
  - frame sync
  - camera calibration & triangulation
  - kinematic optimization (True Dual Solve)
  - reconstruction artifacts
  - `quality_report.multiView`
  - mobile Multi-View Diagnostics result surface
- Synthetic/golden/QA tests and real-device QA checklist.

## Repoda Olmayanlar

- WHAM official repository.
- WHAM checkpoints.
- SMPL / SMPLify licensed assets.
- Production user authentication.
- Real-device QA results.

## Takım Arkadaşı İçin Hızlı Başlangıç

```sh
git clone <repo-url> Mocapexpo
cd Mocapexpo
git switch main
git pull --ff-only origin main

npm install
cd backend
npm install
cd ..
```

Node.js 20+ gerekir.

Sonra bir çalışma modu seçin:

- **Local smoke/dev modu:** local Postgres + local MinIO + local backend + opsiyonel local worker.
- **Shared RunPod modu:** local veya hosted backend ortak remote Postgres/S3 kullanır ve WHAM job'larını RunPod'a dispatch eder.

RunPod o endpoint'e erişemiyorsa local MinIO ile RunPod'u karıştırmayın. RunPod worker genelde geliştirici laptop'ındaki `localhost` adresine erişemez.

## Secret ve Config Paylaşımı

Gerçek `.env` dosyalarını veya API key'leri commit etmeyin.

Bunları 1Password, Bitwarden veya Proton Pass gibi bir password manager üzerinden paylaşın:

```env
DATABASE_URL=...
S3_ENDPOINT=...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true

RUNPOD_DISPATCH_ENABLED=true
RUNPOD_ENDPOINT_ID=...
RUNPOD_API_KEY=...
RUNPOD_API_BASE_URL=https://api.runpod.ai/v2
RUNPOD_JOB_TIMEOUT_SECONDS=3600

ENABLE_MULTI_VIEW_RECONSTRUCTION=true
ALLOW_PRIMARY_WHAM_FALLBACK=true
```

Takım arkadaşı backend secret'larını şuraya koymalı:

```text
backend/.env
```

Repo bunları zaten ignore eder:

```text
.env
backend/.env
node_modules
dist
backend/dist
.local-artifacts
```

Önerilen kural: kod GitHub'a, secret'lar password manager'a, WHAM/SMPL asset'leri private storage'a gider veya her geliştirici bunları ayrı indirir.

## Local Dev Modu (RunPod Kullanmayanlar İçin)

Shared RunPod'a bağlı kalmadan API/mobile/UI geliştirmek için bu modu kullanın. Gerçek WHAM asset'leri olmadan birçok backend/UI akışı test edilebilir; gerçek motion solve için WHAM kurulumu gerekir.

### 1. Postgres ve MinIO Başlat

```sh
cd backend
cp .env.example .env
docker compose -p mocapexpo up -d
npm run migrate
```

Local service defaults:

| Service | URL |
| --- | --- |
| Backend API | `http://localhost:4010` |
| PostgreSQL | `localhost:55432` |
| MinIO S3 API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` |
| MinIO bucket | `mocapexpo-dev` |

### 2. Backend Başlat

```sh
cd backend
npm run dev
```

Health check:

```sh
curl http://localhost:4010/health
```

Beklenen cevap:

```json
{ "ok": true }
```

### 3. Local Worker Başlat (Opsiyonel)

Ayrı terminalde:

```sh
cd backend
npm run worker:dev
```

RunPod dispatch kullanıyorsanız local worker başlatmayın; backend processing job'ı RunPod'a gönderir. RunPod kullanmıyorsanız ve gerçek motion solve almak istiyorsanız local worker, WHAM repo/checkpoint ve SMPL asset kurulumu gerekir.

## Shared RunPod Modu

Gerçek WHAM job'ları RunPod üzerinde çalışacaksa bu modu kullanın.

Bu modda backend, RunPod worker ve storage aynı erişilebilir database/storage değerlerini kullanmalıdır:

```text
Backend API
  -> remote Postgres
  -> remote S3-compatible storage
  -> RunPod dispatch

RunPod worker
  -> same remote Postgres
  -> same remote S3-compatible storage
  -> WHAM repo/checkpoints/SMPL assets inside image or mounted volume
```

Backend `.env` ortak remote değerleri içermelidir:

```env
DATABASE_URL=postgresql://...
S3_ENDPOINT=https://...
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true

RUNPOD_DISPATCH_ENABLED=true
RUNPOD_ENDPOINT_ID=...
RUNPOD_API_KEY=...
RUNPOD_API_BASE_URL=https://api.runpod.ai/v2

ENABLE_MULTI_VIEW_RECONSTRUCTION=true
ALLOW_PRIMARY_WHAM_FALLBACK=true
```

Backend'i çalıştırın:

```sh
cd backend
npm run dev
```

Processing job oluştuğunda backend job'ı RunPod'a dispatch eder.

### RunPod Worker Environment

RunPod worker için `backend/.env.wham-worker.production.example` dosyasını şablon olarak kullanın. Önemli değerler:

```env
DATABASE_URL=...
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

PYTHON_PATH=/opt/conda/bin/python
WHAM_SOLVER_SCRIPT=worker/model_adapters/wham_solver.py
WHAM_SOLVER_VERSION=wham_official_api_v1
WHAM_REPO_DIR=/workspace/WHAM
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
WHAM_REQUIRE_CUDA=true
WHAM_RENDER_OVERLAY_PREVIEW=true
WHAM_SMPL_ASSET_DIR=/workspace/WHAM/dataset/body_models/smpl

ENABLE_MULTI_VIEW_RECONSTRUCTION=true
ALLOW_PRIMARY_WHAM_FALLBACK=true

MOCAPEXPO_POSE_DETECTOR=rtmpose_mmpose
MOCAPEXPO_RTMPOSE_CLI_PATH=/workspace/pose/rtmpose_cli.py
MOCAPEXPO_RTMPOSE_MODEL_PATH=/workspace/pose/models/rtmpose.pth
```

RunPod, backend'in kullandığı aynı S3-compatible bucket içinden upload videolarını okuyabilmeli ve artifact yazabilmelidir.

Dual/pro reconstruction için local backend `.env` tek başına yeterli değildir. Job'u RunPod worker çalıştırıyorsa `ENABLE_MULTI_VIEW_RECONSTRUCTION=true` ve pose detector env değerleri RunPod worker runtime içinde de set edilmelidir. QA sırasında `ALLOW_PRIMARY_WHAM_FALLBACK=true` bırakın; reconstruction/calibration/triangulation gate'leri yetersizse final BVH primary WHAM olarak kalmalıdır.

Preflight'i RunPod runtime içinde çalıştırın:

```json
{"input":{"jobId":"preflight"}}
```

Preflight çıktısı `DATABASE_URL`, S3 config, WHAM path/Python, ffmpeg/ffprobe ve multi-view flag durumunu secret sızdırmadan raporlar.

## WHAM ve SMPL Asset'leri

Bunlar repo'da tutulmaz.

Tipik worker klasör yapısı:

```text
/workspace/WHAM/
  demo.py
  configs/yamls/demo.yaml
  checkpoints/wham_vit_bedlam_w_3dpw.pth.tar
  checkpoints/hmr2a.ckpt
  dataset/body_models/smpl/
```

İlgili env değerleri:

```env
WHAM_REPO_DIR=/workspace/WHAM
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
WHAM_PREFLIGHT_REQUIRED_PATHS=checkpoints/wham_vit_bedlam_w_3dpw.pth.tar,checkpoints/hmr2a.ckpt
WHAM_SMPL_ASSET_DIR=/workspace/WHAM/dataset/body_models/smpl
```

SMPL asset'leri lisanslıdır. Bunları repo üzerinden commit etmeyin veya dağıtmayın.

## Mobil Uygulama

Bu proje Expo Go değil, Expo Dev Client kullanır.

Scripts:

```sh
npm start       # expo start
npm run android # expo run:android
npm run ios     # expo run:ios
npm run typecheck
```

### Emulator

Android emulator can reach host backend with `10.0.2.2`:

```sh
export EXPO_PUBLIC_MOCAP_API_BASE_URL="http://10.0.2.2:4010"
export EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
export EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```

### Fiziksel Cihaz

Telefon ve bilgisayar aynı ağda olmalıdır.

Bilgisayarın LAN IP'sini bulun:

```sh
ipconfig getifaddr en0
```

Uygulamayı LAN IP ile başlatın:

```sh
export EXPO_PUBLIC_MOCAP_API_BASE_URL="http://<PC_LAN_IP>:4010"
export EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
export EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```

macOS üzerinde iOS için:

```sh
export EXPO_PUBLIC_MOCAP_API_BASE_URL="http://<MAC_LAN_IP>:4010"
export EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
export EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run ios
```

Fiziksel telefonlarla local MinIO kullanılıyorsa backend `.env` de telefondan erişilebilir endpoint kullanmalıdır:

```env
S3_ENDPOINT=http://<PC_LAN_IP>:9000
```

RunPod/shared storage kullanıyorsanız bunun yerine remote S3-compatible endpoint kullanın.

### Development Modda İki Fiziksel Cihaz

Dev build'i iki cihaza da kurduktan sonra tek Metro server yeterlidir:

```sh
npx expo start --dev-client --lan
```

İki cihaz da aynı dev server'a bağlanabilir.

Dual capture için:

1. İki cihazı aynı Wi-Fi/LAN ağına alın.
2. MocapExpo dev build'i iki cihazda da açın.
3. Cihaz 1: Dual -> Host -> Start Host.
4. Cihaz 2: Dual -> Guest -> Host IP/port gir -> connect.
5. Ready/sync state bekleyin.
6. Capture ve upload yapın.
7. Backend `expectedVideoCount === 2` olana kadar beklemelidir.

Pro 4-camera için:

1. İlk cihazda Pro session oluşturun.
2. Join token'ı diğer cihazlarla paylaşın.
3. Her cihaz farklı role/index ile join etmelidir.
4. Real-device validation tamamlanana kadar Pro 4-camera QA opsiyoneldir.

## Backend Scripts

```sh
cd backend
npm run dev
npm run build
npm run start
npm run migrate
npm run worker:dev
npm run worker:preflight:wham:dev
npm run typecheck
```

## Test Komutları

Backend:

```sh
npm --prefix backend run typecheck
npm --prefix backend run test:triangulation
npm --prefix backend run test:pose-extraction
npm --prefix backend run test:frame-sync
npm --prefix backend run test:camera-calibration
npm --prefix backend run test:dual-reconstruction-artifacts
npm --prefix backend run test:motion-pipeline-stages
npm --prefix backend run test:multi-view-reconstruction
npm --prefix backend run test:multi-view-orchestrator
npm --prefix backend run test:reconstruction-types
npm --prefix backend run test:wham-input-usage
npm --prefix backend run test:quality-report-multiview
npm --prefix backend run test:multi-view-artifacts
npm --prefix backend run test:single-camera-regression
npm --prefix backend run test:multiview-golden
npm --prefix backend run test:dual-camera-golden-e2e
npm --prefix backend run test:real-device-qa-validator
npm --prefix backend run test:capture-metadata-contract
npm --prefix backend run test:worker-preflight
```

Root/mobile:

```sh
npm run typecheck
./backend/node_modules/.bin/tsx src/features/exports/utils/multiViewResultDisplay.test.ts
```

Fixture/live WHAM QA gerçek video ve çalışan WHAM runtime ister:

```sh
npm --prefix backend run qa:wham-fixture -- --video <fixture-video-path>
npm --prefix backend run qa:wham-live-api -- --video <video-path> --api-base-url http://127.0.0.1:4010 --token dev-user-id
```

Fixture video yoksa fixture QA'yı failure saymayın.

## Multi-View Artifacts

Dual/pro reconstruction başarılı olduğunda worker şunları yazabilir:

| Format | Artifact name |
| --- | --- |
| `pose_frames_device_json` | `pose_frames_device_{deviceIndex}_json` |
| `multi_view_sync_json` | `multi_view_sync_json` |
| `camera_calibration_json` | `camera_calibration_json` |
| `dual_reconstruction_json` | `dual_reconstruction_json` |
| `multi_view_reconstruction_json` | `multi_view_reconstruction_json` |
| `pose_frames_json` | `pose_frames_json`, sadece diagnostic world-landmark çıktısı güvenliyse |

Mevcut single-camera artifact seti korunur:

- `smpl_parameters_json`
- `raw_solved_motion_json`
- `solved_motion_json`
- `cleanup_report_json`
- `quality_report_json`
- `preview_summary_json`
- `motion_pipeline_report_json`
- `wham_overlay_preview_mp4`
- `bvh`

## Quality Report

`quality_report.schema` değişmez:

```text
mocap.quality_report.v1
```

`quality_report.multiView` optional/additive alandır. Single-camera consumer'lar bu alan olmadan çalışmaya devam etmelidir.

Dual/pro için rapor şunları içerebilir:

- source
- reconstruction availability
- whether WHAM constraints were used
- primary WHAM fallback state/reason
- `primaryCameraFallbackUsed`
- `finalAnimationSource`
- sync metrics
- calibration metrics
- triangulation metrics
- warning codes

Multi-view section score formülünü değiştirmez.

## Real-Device QA

Synthetic testlerin geçmesi real-device QA'nın tamamlandığı anlamına gelmez. True Dual Solve motorunun kararlılığı için aşağıdaki QA planı takip edilmelidir.

Docs:

- `docs/qa/real-device-mocap-qa.md`
- `docs/qa/real-device-qa-report-template.md`
- `backend/qa/real-device-qa.example.json`

Dual/pro testleri için minimum manuel QA:

1. iOS single-camera WHAM regression.
2. Android single-camera WHAM regression.
3. iOS + iOS dual.
4. Android + Android dual.
5. iOS + Android dual.
6. Pro 4-camera is optional.

Doldurulmuş QA manifest'ini şu komutla doğrulayın:

```sh
npm --prefix backend run test:real-device-qa-validator
```

## Git Hijyeni

Private repo, `git add .` her zaman güvenlidir anlamına gelmez.

Commit etmeyin:

- `.env`
- `backend/.env`
- `.DS_Store`
- `.expo/*`
- local logs
- local cache/build output
- WHAM checkpoints
- SMPL assets
- personal device files

Commit öncesi:

```sh
git status --short
git diff --cached --name-only
git diff --cached --stat
```

## Troubleshooting

### Telefon Backend'e Ulaşamıyor

`localhost` değil bilgisayar LAN IP'sini kullanın.

```env
EXPO_PUBLIC_MOCAP_API_BASE_URL=http://<PC_LAN_IP>:4010
```

Firewall portlarını açın:

- `4010` for backend API
- `9000` for local MinIO, if used from physical phones

### Fiziksel Telefonda Upload Fail Oluyor

Signed upload URL'leri `S3_ENDPOINT` içerir. Backend `.env` içinde `S3_ENDPOINT=http://localhost:9000` varsa telefon kendi localhost'una upload etmeye çalışır ve fail olur.

Şunu kullanın:

```env
S3_ENDPOINT=http://<PC_LAN_IP>:9000
```

veya remote S3-compatible endpoint kullanın.

### RunPod Job Videoyu Okuyamıyor

RunPod geliştirici laptop'ındaki `localhost` MinIO'yu okuyamaz. RunPod'un erişebildiği remote S3-compatible storage kullanın.

### Worker Job Almıyor

Kontrol edin:

- backend and worker use the same `DATABASE_URL`
- uploads completed successfully
- take status is ready for processing
- job status is `queued`
- RunPod dispatch is enabled only when intended
- RunPod worker env has `ENABLE_MULTI_VIEW_RECONSTRUCTION=true` if dual/pro reconstruction QA is expected
- RunPod worker preflight passes and reports the expected multi-view/fallback flags

### WHAM Preflight Fail Oluyor

Kontrol edin:

- `WHAM_REPO_DIR` contains `demo.py`
- required checkpoint paths exist
- `WHAM_SMPL_ASSET_DIR` is correct
- CUDA is available when `WHAM_REQUIRE_CUDA=true`
- Python modules in `WHAM_PREFLIGHT_REQUIRED_MODULES` import correctly

### Dual Camera Motion'ı İyileştirmiyor

Önce raporları kontrol edin:

- `motion_pipeline_report_json.runtime.reconstructionBranchEntered`
- `quality_report_json.multiView.reconstructionAvailable`
- `quality_report_json.multiView.reconstructionUsedForConstraints`
- `quality_report_json.multiView.finalAnimationSource`
- `quality_report_json.multiView.primaryWhamFallbackReason`

`ENABLE_MULTI_VIEW_RECONSTRUCTION=false` ise dual/pro bilinçli olarak primary WHAM fallback kullanır. Flag true olduğu halde pose detector, sync, calibration veya triangulation başarısızsa report gerçek failure reason yazmalı ve final BVH primary WHAM kalmalıdır. `true_dual_solve` yalnızca optimized solved motion ve optimized BVH valid/persisted olduğunda ve blocking gate yoksa raporlanır.
