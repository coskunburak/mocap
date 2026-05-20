# MocapExpo Kurulum ve Çalıştırma Rehberi

Bu rehber, sıfır kurulmuş bir Windows bilgisayarda MocapExpo projesinin backend, WHAM worker ve Android mobil uygulama tarafını ayağa kaldırmak için hazırlanmıştır. macOS/Linux geliştiricileri aynı servis ve script isimlerini kullanabilir; Windows'a özel komutlar PowerShell ile verilmiştir.

> Not: Bu repoda `ios/` altında Swift, Xcode project ve CocoaPods dosyaları bulunur. iOS uygulaması Windows üzerinde derlenemez; iOS için macOS + Xcode gerekir. Windows PC'de mobil geliştirme hedefi Android cihaz veya Android emulator'dür.

## 1. Proje Özeti

MocapExpo, mobil telefonla kaydedilen videoyu backend'e yükleyip backend worker tarafında motion capture sonucuna dönüştüren video tabanlı bir motion capture sistemidir.

Güncel production pipeline yalnızca WHAM, SMPL ve SMPLify üzerine kuruludur:

- Mobil uygulama cihaz üzerinde on-device pose inference çalıştırmaz.
- Mobil uygulama kamera preview, video recording, capture metadata üretimi ve upload akışından sorumludur.
- Backend upload URL, upload completion, processing job, job status ve result/artifact API sözleşmelerini yönetir.
- Worker queued job'u claim eder, input videoyu indirir, normalize/transcode eder, WHAM solver'ı çalıştırır ve WHAM/SMPL/SMPLify çıktılarından artifact üretir.
- Mobil result ekranı sonucu backend API ve artifact download URL'leri üzerinden tüketir.

## 2. Güncel Mimari

Aktif uçtan uca akış:

```text
Android telefon
  -> Kamera preview açılır
  -> Orijinal video + capture metadata kaydedilir
  -> Backend API'den signed upload URL alınır
  -> Video + metadata S3-compatible storage'a yüklenir
  -> Backend upload'u tamamlar ve processing job oluşturur
  -> Worker processing_jobs kuyruğundan job claim eder
  -> Worker videoyu indirir
  -> FFmpeg/ffprobe ile normalize/transcode ve probe yapılır
  -> Worker WHAM solver adapter'ını çalıştırır
  -> WHAM, SMPL ve SMPLify uyumlu motion çıktıları üretilir
  -> Cleanup, quality, BVH ve pipeline report artifact'leri oluşturulur
  -> Artifact'ler S3-compatible storage'a yüklenir
  -> Mobil uygulama job status ve result ekranında export listesini backend'den çeker
```

Yerel geliştirmede önerilen servis yerleşimi:

- PostgreSQL ve MinIO Docker Compose ile çalışır.
- Backend API host Windows üzerinde Node.js ile çalışır.
- Worker host Windows, WSL2/Linux container veya GPU ortamında Node.js + Python/WHAM runtime ile çalışır.
- Gerçek WHAM inference için CUDA uyumlu GPU runtime ve lisanslı model asset'leri gerekir.

Alternatif pose detector, built-in solver, synthetic solver veya motion fallback aktif yol değildir.

## 3. Ana Bileşenler

| Bileşen | Görev | Repo karşılığı |
| --- | --- | --- |
| Mobile app | Kamera preview, video recording, metadata üretimi, upload ve result ekranları | `src/`, `android/`, `App.tsx` |
| Backend API | Project/take/upload/job/status/export endpointleri | `backend/src/index.ts` |
| PostgreSQL | Project, take, upload, job ve export kayıtları | `backend/docker-compose.yml` |
| S3-compatible artifact storage | Video, metadata ve worker artifact'leri | MinIO/S3/Supabase Storage S3 |
| Worker | Job claim, video normalization, WHAM solve, cleanup, export | `backend/src/worker/index.ts` |
| WHAM solver | Normalize edilmiş videodan motion/SMPL çıktısı üretir | `backend/worker/model_adapters/wham_solver.py` |
| SMPL / SMPLify assets | WHAM runtime'ın ihtiyaç duyduğu lisanslı model varlıkları | Repo dışında kullanıcı sağlar |
| ffmpeg/ffprobe | Video normalize/transcode ve metadata probe | `FFMPEG_PATH`, `FFPROBE_PATH` |
| QA scripts | Fixture ve canlı API WHAM doğrulaması | `backend/src/qa/whamFixtureJob.ts`, `backend/src/qa/whamLiveApiJob.ts` |

## 4. Sıfır Windows PC Kurulumu

PowerShell'i yönetici olarak açıp temel araçları kurun:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.11 -e
winget install --id Docker.DockerDesktop -e
winget install --id Gyan.FFmpeg -e
winget install --id EclipseAdoptium.Temurin.17.JDK -e
winget install --id Google.AndroidStudio -e
```

Kurulumdan sonra bilgisayarı veya en azından PowerShell oturumunu yeniden başlatın.

Kontrol komutları:

```powershell
git --version
node --version
npm --version
python --version
ffmpeg -version
ffprobe -version
docker --version
```

Docker Desktop içinde:

- WSL2 backend açık olmalı.
- Linux containers modu kullanılmalı.
- Docker Desktop tamamen başlamadan `docker compose` komutlarını çalıştırmayın.

Android Studio içinde:

- Android SDK kurulmalı.
- Android SDK Platform Tools kurulmalı.
- Android Emulator kurulmalı.
- En az bir Android Virtual Device oluşturulmalı.

Gerekirse kullanıcı ortam değişkenlerini ekleyin:

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("Path", "$env:Path;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "User")
```

Yeni PowerShell açıp kontrol edin:

```powershell
adb version
emulator -version
```

Repo kurulumu:

```powershell
git clone <REPO_URL> Mocapexpo
cd Mocapexpo
npm install
cd backend
npm install
cd ..
```

Tekrarlanabilir CI kurulumu için `npm install` yerine `npm ci` kullanılabilir.

## 5. PostgreSQL ve MinIO Local Storage

Yerel backend için PostgreSQL ve S3-compatible storage önerilen şekilde Docker Compose ile gelir.

```powershell
cd backend
docker compose -p mocapexpo up -d
docker compose -p mocapexpo ps
```

Compose servisleri:

| Servis | Adres | Kullanıcı | Şifre / bucket |
| --- | --- | --- | --- |
| PostgreSQL | `localhost:55432` | `mocap` | `mocap` |
| MinIO S3 API | `http://localhost:9000` | `mocap` | `mocapdev` |
| MinIO Console | `http://localhost:9001` | `mocap` | `mocapdev` |
| MinIO bucket | `mocapexpo-dev` | otomatik oluşturulur | private |

Mobil fiziksel cihazla testte `localhost` telefondan PC'yi göstermez. Signed upload URL telefona döndüğü için `S3_ENDPOINT` telefonun erişebildiği bir adres olmalıdır:

```env
S3_ENDPOINT=http://192.168.1.50:9000
```

Windows IP adresini bulmak için:

```powershell
ipconfig
```

Windows Firewall'da en az `4010` ve `9000` portlarına özel ağ için izin verin.

## 6. Environment Dosyaları

Backend env örnekleri:

- `backend/.env.example`: local development backend + worker başlangıç şablonu.
- `backend/.env.wham-worker.production.example`: production GPU worker / RunPod benzeri CUDA pod şablonu.

Repo kökünde ayrı bir root `.env.example` yoktur. Mobil uygulama Expo public env değerlerini process env üzerinden okur; ilgili anahtarlar `src/app/config/env.ts` içindedir.

Local backend env oluşturma:

```powershell
cd backend
Copy-Item .env.example .env
```

Windows path yazarken iki pratik seçenek vardır:

- Node ve PowerShell için en az sorunlu format: `C:/mocapexpo/runtime/WHAM`
- Windows native format: `C:\mocapexpo\runtime\WHAM`

Değeri tırnak içine almanız gerekirse `.env` içinde çift tırnak yerine mümkünse tırnaksız path kullanın. Boşluk içeren klasörlerden kaçının.

### 6.1 Backend, Storage ve Limit Env Değişkenleri

| Değişken | Zorunlu mu? | Ne işe yarar? | Local dev örneği |
| --- | --- | --- | --- |
| `NODE_ENV` | Opsiyonel | Runtime modu. Production worker'da bazı WHAM guard'ları sıkılaşır. | `development` |
| `PORT` | Opsiyonel | Backend API portu. Varsayılan `4010`. | `4010` |
| `DATABASE_URL` | Zorunlu | Backend ve worker'ın bağlanacağı PostgreSQL connection string. | `postgres://mocap:mocap@localhost:55432/mocapexpo` |
| `S3_ENDPOINT` | Local MinIO için gerekli | S3-compatible endpoint. Fiziksel telefonla testte PC LAN IP kullanılmalı. | `http://192.168.1.50:9000` |
| `S3_REGION` | Opsiyonel | S3 region. MinIO için sembolik değer yeterlidir. | `us-east-1` |
| `S3_BUCKET` | Zorunlu | Video, metadata ve artifact bucket adı. | `mocapexpo-dev` |
| `S3_ACCESS_KEY_ID` | Zorunlu | S3/MinIO access key. | `mocap` |
| `S3_SECRET_ACCESS_KEY` | Zorunlu | S3/MinIO secret key. | `mocapdev` |
| `S3_FORCE_PATH_STYLE` | Opsiyonel | MinIO gibi path-style endpointler için `true`. | `true` |
| `S3_REQUEST_TIMEOUT_MS` | Opsiyonel | S3 request timeout. | `30000` |
| `UPLOAD_URL_TTL_SECONDS` | Opsiyonel | Signed upload URL geçerlilik süresi. | `900` |
| `DOWNLOAD_URL_TTL_SECONDS` | Opsiyonel | Signed download URL geçerlilik süresi. | `600` |
| `MAX_VIDEO_BYTES` | Opsiyonel | Upload edilebilecek video boyutu üst sınırı. | `786432000` |
| `MAX_METADATA_BYTES` | Opsiyonel | Metadata JSON boyutu üst sınırı. | `1048576` |
| `MAX_EXPECTED_VIDEOS` | Opsiyonel | Bir take için kabul edilen maksimum beklenen video sayısı. | `4` |
| `MAX_VIDEO_DURATION_SECONDS` | Opsiyonel | Video süre limiti. | `180` |
| `SKIP_OBJECT_HEAD_VALIDATION` | Opsiyonel | S3 object head doğrulamasını atlar; normalde `false` bırakılır. | `false` |

### 6.2 Worker ve Video Env Değişkenleri

| Değişken | Zorunlu mu? | Ne işe yarar? | Local dev örneği |
| --- | --- | --- | --- |
| `WORKER_TEMP_DIR` | Opsiyonel | Worker'ın video ve artifact ara dosyalarını yazdığı klasör. | `C:/mocapexpo/tmp/worker` |
| `WORKER_TARGET_FPS` | Opsiyonel | Normalize edilmiş video hedef FPS değeri. | `30` |
| `WORKER_MAX_WIDTH` | Opsiyonel | Normalize edilmiş video maksimum genişliği. | `1280` |
| `WORKER_POLL_INTERVAL_MS` | Opsiyonel | Worker'ın queued job arama aralığı. | `2000` |
| `WORKER_IDLE_LOG_INTERVAL_MS` | Opsiyonel | Boş kuyruk log aralığı. | `30000` |
| `FFMPEG_PATH` | Opsiyonel | `ffmpeg` executable path. PATH'e ekliyse sadece `ffmpeg` yeterli. | `ffmpeg` |
| `FFPROBE_PATH` | Opsiyonel | `ffprobe` executable path. PATH'e ekliyse sadece `ffprobe` yeterli. | `ffprobe` |
| `PYTHON_PATH` | Production worker'da zorunlu | WHAM adapter'ı çalıştıracak Python. Windows native için `.venv` path'i, container için conda Python verilir. | `C:/mocapexpo/wham-env/Scripts/python.exe` |
| `PREMIUM_MOTION_TIMEOUT_MS` | Opsiyonel | WHAM solve process timeout. Gerçek WHAM işleri için uzun tutulur. | `1800000` |
| `BLENDER_PATH` | Opsiyonel | BVH smoke test için Blender executable path. Boşsa smoke test skip edilebilir. | boş |
| `REQUIRE_BLENDER_SMOKE_TEST` | Opsiyonel | `true` ise Blender smoke test geçmeden job başarılı olmaz. | `false` |

### 6.3 WHAM / SMPL / SMPLify Env Değişkenleri

| Değişken | Zorunlu mu? | Ne işe yarar? | Local dev örneği |
| --- | --- | --- | --- |
| `WHAM_SOLVER_SCRIPT` | Production worker'da zorunlu | Node worker'ın çağırdığı Python adapter script'i. Repo içi path'tir. | `worker/model_adapters/wham_solver.py` |
| `WHAM_SOLVER_VERSION` | Opsiyonel | Artifact metadata içinde görünen solver sürümü. | `wham_adapter_v1` |
| `WHAM_REPO_DIR` | Gerçek WHAM için zorunlu | Official WHAM checkout klasörü. `demo.py` bu klasörde olmalı. | `C:/mocapexpo/runtime/WHAM` |
| `WHAM_CONFIG_PATH` | WHAM config kullanılıyorsa gerekli | `WHAM_REPO_DIR` içine göre relative veya absolute config path. | `configs/yamls/demo.yaml` |
| `WHAM_LD_LIBRARY_PATH` | Linux/CUDA runtime'da gerekli olabilir | WHAM child process için library path. Linux container'da `:`; Windows preflight path listesinde `;` ayracı kullanılır. | `/opt/conda/lib/python3.9/site-packages/torch/lib:/opt/conda/lib` |
| `WHAM_ESTIMATE_LOCAL_ONLY` | Opsiyonel | WHAM adapter'ın local-only estimation modunu açar. Normal production'da `false`. | `false` |
| `WHAM_RENDER_OVERLAY_PREVIEW` | Opsiyonel | WHAM overlay preview MP4 üretimini açar. | `false` local, `true` GPU worker |
| `WHAM_ROOT_SCALE` | Opsiyonel | WHAM root translation scale faktörü. | `100` |
| `WHAM_REQUIRE_CUDA` | Production'da `true` olmalı | Preflight sırasında `torch.cuda.is_available()` zorunluluğu. | `false` local smoke, `true` production |
| `WHAM_PREFLIGHT_REQUIRED_MODULES` | Opsiyonel | Preflight'ın import edeceği Python modülleri. Boşsa varsayılan liste kullanılır. | `torch,cv2,joblib,smplx,mmcv,mmpose,loguru` |
| `WHAM_PREFLIGHT_REQUIRED_PATHS` | Opsiyonel | `WHAM_REPO_DIR` altında bulunması gereken checkpoint dosyaları. | `checkpoints/wham_vit_bedlam_w_3dpw.pth.tar,checkpoints/hmr2a.ckpt` |
| `WHAM_SMPL_ASSET_DIR` | Gerçek SMPL için zorunlu | Lisanslı SMPL body model asset klasörü. Repo'ya commit edilmez. | `C:/mocapexpo/runtime/WHAM/dataset/body_models/smpl` |
| `WHAM_CALIBRATION_PATH` | Opsiyonel | Official WHAM config harici calibration dosyası bekliyorsa verilir. | boş |
| `WHAM_PRECOMPUTED_OUTPUT_PKL` | Sadece QA/demo | Önceden üretilmiş `wham_output.pkl` dosyasını kullanır; production'da yasaktır. | `C:/mocapexpo/fixtures/wham_output.pkl` |

Production GPU worker şablonunda `WHAM_SOLVER_VERSION=wham_official_api_v1`, `WHAM_REQUIRE_CUDA=true` ve `WHAM_RENDER_OVERLAY_PREVIEW=true` kullanılır.

### 6.4 Mobil Env Değişkenleri

Mobil env anahtarları `src/app/config/env.ts` içinden okunur.

| Değişken | Ne işe yarar? | Android emulator örneği | Fiziksel Android örneği |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_MOCAP_API_BASE_URL` | Mobil uygulamanın backend API base URL'i. | `http://10.0.2.2:4010` | `http://192.168.1.50:4010` |
| `EXPO_PUBLIC_MOCAP_DEV_TOKEN` | Dev auth token. Backend QA ve local dev için varsayılan `dev-user-id`. | `dev-user-id` | `dev-user-id` |
| `EXPO_PUBLIC_MOCAP_DEFAULT_PROJECT_ID` | Opsiyonel default project id. Boş bırakılabilir. | boş | boş |
| `EXPO_PUBLIC_MOCAP_API_TIMEOUT_MS` | API request timeout. | `20000` | `20000` |
| `EXPO_PUBLIC_MOCAP_UPLOAD_TIMEOUT_MS` | Video upload timeout. | `180000` | `180000` |
| `EXPO_PUBLIC_MOCAP_UPLOAD_RETRY_COUNT` | Upload retry sayısı. | `2` | `2` |
| `EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW` | Backend upload + processing flow'u açık tutar. Varsayılan `true`. | `true` | `true` |
| `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG` | Local debug export UI yolunu açar. Production akışı değildir. | `false` | `false` |

## 7. WHAM / SMPL / SMPLify Kurulumu

WHAM runtime ve lisanslı model asset'leri bu repoya vendored değildir. Kullanıcı tarafından manuel sağlanmalıdır.

Önerilen klasör düzeni:

```text
C:/mocapexpo/runtime/WHAM/
  demo.py
  configs/yamls/demo.yaml
  checkpoints/wham_vit_bedlam_w_3dpw.pth.tar
  checkpoints/hmr2a.ckpt
  dataset/body_models/smpl/
```

Production Linux/CUDA worker örneği:

```text
/workspace/WHAM/
  demo.py
  configs/yamls/demo.yaml
  checkpoints/wham_vit_bedlam_w_3dpw.pth.tar
  checkpoints/hmr2a.ckpt
  dataset/body_models/smpl/
```

WHAM hazırlık notları:

- Official WHAM repository'sini ayrı bir runtime klasörüne clone edin.
- WHAM checkpoint dosyalarını `WHAM_PREFLIGHT_REQUIRED_PATHS` ile eşleşecek konuma koyun.
- SMPL ve SMPLify asset'leri lisanslıdır; ilgili kaynaklardan kullanıcı hesabınızla indirilmeli ve `WHAM_SMPL_ASSET_DIR` ile gösterilmelidir.
- Official WHAM'ın kendi Python/CUDA gereksinimlerini WHAM repo dokümantasyonuna göre kurun.
- Bu repo yalnızca adapter ek paketlerini `backend/worker/requirements.model-wham-adapter.txt` içinde tutar: `joblib`, `loguru`, `opencv-python-headless`, `numpy`, `runpod`.
- `backend/worker/Dockerfile.wham-adapter` production worker imajında adapter requirements'a ek olarak `iopath`, `fvcore` ve CUDA/PyTorch3D uyumlu `pytorch3d` kurar.
- CPU-only WHAM çalışması pratikte çok yavaş olabilir ve bazı WHAM/CUDA bağımlılıklarında desteklenmeyebilir. Production worker için `WHAM_REQUIRE_CUDA=true` kullanın.

Windows native Python ortamı örneği:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r worker\requirements.model-wham-adapter.txt
```

Bu komut yalnızca MocapExpo WHAM adapter requirements dosyasını kurar. Official WHAM, PyTorch/CUDA, mmcv, mmpose, smplx ve diğer model runtime paketleri WHAM runtime ortamında ayrıca hazır olmalıdır.

PowerShell script çalıştırmayı engellerse:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

WHAM preflight:

```powershell
cd backend
npm run worker:preflight:wham:dev
```

Production build sonrası preflight:

```powershell
cd backend
npm run build
npm run worker:preflight:wham
```

Başarılı preflight logunda şu mesaj beklenir:

```text
WHAM production preflight passed.
```

## 8. Backend Çalıştırma

Backend scriptleri `backend/package.json` içinden gelir:

- `npm run migrate`
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`

Local akış:

```powershell
cd backend
Copy-Item .env.example .env
npm install
docker compose -p mocapexpo up -d
npm run migrate
npm run dev
```

API varsayılan olarak `http://localhost:4010` üzerinde çalışır.

Health check:

```powershell
Invoke-RestMethod http://localhost:4010/health
```

Beklenen cevap:

```json
{ "ok": true }
```

## 9. Worker Çalıştırma

Worker scriptleri `backend/package.json` içinden gelir:

- `npm run worker:preflight:wham:dev`
- `npm run worker:dev`
- `npm run worker:preflight:wham`
- `npm run worker:start`

Worker, backend ile aynı PostgreSQL ve S3-compatible storage env değerlerini kullanmalıdır. Aynı `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, access key ve secret ile çalışmazsa job claim etse bile input videoyu veya artifact storage'ı göremez.

Local worker:

```powershell
cd backend
npm run worker:preflight:wham:dev
npm run worker:dev
```

Worker boş kuyrukta bekler. Job bulduğunda state sırası genel olarak şöyledir:

```text
queued
  -> ingesting
  -> extracting_frames
  -> solving_motion
  -> cleaning
  -> exporting
  -> succeeded
```

Hata durumunda state `failed` olur ve `message` / `errorCode` backend API'den okunabilir.

## 10. WHAM Live API Testi

Bu test gerçek backend API, S3-compatible storage, PostgreSQL ve çalışan worker üzerinden uçtan uca WHAM job doğrular. Test script'i `backend/src/qa/whamLiveApiJob.ts`, script adı `qa:wham-live-api` şeklindedir.

Ön koşullar:

- `docker compose -p mocapexpo up -d` çalışıyor.
- `npm run migrate` tamamlandı.
- Backend `npm run dev` ile açık.
- Worker `npm run worker:dev` ile açık.
- WHAM preflight başarılı.
- Test video dosyası `MAX_VIDEO_BYTES` ve `MAX_VIDEO_DURATION_SECONDS` limitleri içinde.

PowerShell komutu:

```powershell
cd backend
npm run qa:wham-live-api -- --video "C:\absolute\path\to\test.mp4" --api-base-url http://127.0.0.1:4010 --token dev-user-id --timeout-ms 1800000
```

İsteğe bağlı çıktı klasörü:

```powershell
npm run qa:wham-live-api -- --video "C:\absolute\path\to\test.mp4" --api-base-url http://127.0.0.1:4010 --token dev-user-id --timeout-ms 1800000 --output-dir "..\.local-artifacts\wham-live-api-job\latest"
```

Başarılı testte beklenenler:

- `job_succeeded` check'i `ok: true`.
- Job state `succeeded`.
- `pipeline_reports_wham` check'i `backendMotion` değerinin `wham@` ile başladığını gösterir.
- `no_motion_fallback` check'i `motionFallbackUsed=false` doğrular.
- Artifact/export listesinde en az şu formatlar bulunur:
  - `smpl_parameters_json`
  - `raw_solved_motion_json`
  - `solved_motion_json`
  - `cleanup_report_json`
  - `bvh`
  - `quality_report_json`
  - `preview_summary_json`
  - `motion_pipeline_report_json`

`WHAM_RENDER_OVERLAY_PREVIEW=true` ise ek olarak `wham_overlay_preview_mp4` üretilebilir.

Fixture tabanlı, önceden üretilmiş `wham_output.pkl` doğrulaması için script adı `qa:wham-fixture`:

```powershell
cd backend
npm run qa:wham-fixture -- --video "C:\absolute\path\to\source.mp4" --wham-output-pkl "C:\absolute\path\to\wham_output.pkl" --output-dir "..\.local-artifacts\wham-fixture-job\latest"
```

`WHAM_PRECOMPUTED_OUTPUT_PKL` ve fixture akışı production worker için değildir.

## 11. Android Mobil Uygulama Kurulumu

Bu uygulama Expo Go ile çalıştırılacak basit bir JS uygulaması değildir. `react-native-vision-camera`, native camera engine ve Android native modülleri kullandığı için Android dev client/native build gerekir.

Root package scriptleri:

- `npm start`: Expo Metro server.
- `npm run android`: `expo run:android`.
- `npm run typecheck`: TypeScript kontrolü.

Android emulator için:

```powershell
cd Mocapexpo
$env:EXPO_PUBLIC_MOCAP_API_BASE_URL="http://10.0.2.2:4010"
$env:EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
$env:EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```

Fiziksel Android cihaz için:

```powershell
cd Mocapexpo
$env:EXPO_PUBLIC_MOCAP_API_BASE_URL="http://192.168.1.50:4010"
$env:EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
$env:EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```

Fiziksel cihazı USB ile bağladıktan sonra:

```powershell
adb devices
```

İlk build uzun sürebilir. Sonraki çalıştırmalarda Metro'yu ayrıca başlatmak için:

```powershell
npm start
```

Android build doğrudan Gradle ile alınmak istenirse:

```powershell
cd android
.\gradlew.bat assembleDebug
```

Debug APK yolu genellikle:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

## 12. Mobil Telefon Üzerinden Kullanım

Fiziksel Android cihazla gerçek backend flow doğrulaması:

1. PC ve telefon aynı Wi-Fi ağında olmalı.
2. PC IP adresini bulun:

```powershell
ipconfig
```

Örnek PC IP:

```text
192.168.1.50
```

3. Backend env içinde storage endpoint'i telefondan erişilebilir yapın:

```env
S3_ENDPOINT=http://192.168.1.50:9000
```

4. Backend'i yeniden başlatın:

```powershell
cd backend
npm run dev
```

5. Worker'ı ayrı terminalde çalıştırın:

```powershell
cd backend
npm run worker:dev
```

6. Mobil build'i PC IP ile başlatın:

```powershell
cd Mocapexpo
$env:EXPO_PUBLIC_MOCAP_API_BASE_URL="http://192.168.1.50:4010"
$env:EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
$env:EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```

7. Windows Firewall'da `node.exe` veya `4010` portu, MinIO için de `9000` portu private network üzerinde açık olmalı.
8. Uygulamada kamera iznini verin.
9. Capture ekranında kayıt başlatın, hareketi kaydedin ve kaydı bitirin.
10. Upload ekranında video ve metadata upload ilerlemesini izleyin.
11. Upload tamamlanınca uygulama backend processing job oluşturur.
12. Processing status ekranı worker state/progress bilgisini backend'den poll eder.
13. Worker `succeeded` olduğunda uygulama result ekranına geçer.
14. Result ekranı backend export listesinden SMPL/WHAM artifact'lerini, kalite raporunu ve varsa overlay preview videosunu gösterir.

Telefon backend'e bağlanamıyorsa PC'den şu kontrolü yapın:

```powershell
Invoke-RestMethod http://192.168.1.50:4010/health
```

Aynı URL telefon tarayıcısından da erişilebilir olmalıdır:

```text
http://192.168.1.50:4010/health
```

## 13. Artifact ve Sonuçlar

Worker başarılı olduğunda backend export kayıtları S3-compatible storage key'leriyle birlikte oluşturulur.

| Artifact format | İçerik | Kullanım |
| --- | --- | --- |
| `smpl_parameters_json` | `mocap.smpl_parameters.v1`; SMPL body pose, global orientation, betas, translation, camera/joints/mesh ve SMPLify metadata | Model/debug/ileri analiz |
| `raw_solved_motion_json` | WHAM'den gelen temizlenmemiş solved motion + validation | Solver çıktısını doğrudan inceleme |
| `solved_motion_json` | Cleanup sonrası `mocap.solved_motion.v1` motion artifact'i | Mobil result, preview ve export temel verisi |
| `cleanup_report_json` | Smoothing, interpolation, foot locking ve cleanup metrikleri | Kalite analizi ve hata ayıklama |
| `bvh` | Validated BVH export text | DCC/animasyon araçlarına aktarım |
| `quality_report_json` | Quality score, grade, warnings, errors, validation durumu | Result ekranında kalite özeti |
| `preview_summary_json` | FPS, duration, frame count, root bounds/travel, kısa uyarılar | Hızlı preview kartları |
| `motion_pipeline_report_json` | Pipeline profili `wham_smpl_smplify_only`, engine sürümleri, fallback=false, artifact key'leri | Üretim sözleşmesi ve QA doğrulaması |
| `wham_overlay_preview_mp4` | Opsiyonel WHAM overlay preview videosu | Görsel solver kontrolü |

`motion_pipeline_report_json` içinde `fallback.motionFallbackUsed=false` beklenir. Bu değer aktif production yolunda WHAM dışı motion fallback olmadığını doğrular.

## 14. Docker Üzerinden Backend + Worker Notu

En pratik local geliştirme akışı PostgreSQL ve MinIO'yu Docker'da, API ve worker'ı host Node.js ile çalıştırmaktır. Tamamen Docker komutları ile API/worker çalıştırmak mümkündür; ancak gerçek WHAM solve için container'ın WHAM repo, checkpoint, SMPL asset ve CUDA runtime'a erişmesi gerekir.

Production/GPU worker imajı:

```powershell
cd backend
docker build -f worker/Dockerfile.wham-adapter -t mocapexpo-wham-worker:latest .
```

Bu imaj production GPU worker içindir. `backend/worker/Dockerfile.wham-adapter`, WHAM CUDA base image üzerine Node worker build eder. Official WHAM checkout, checkpoint ve SMPL asset'leri image veya mounted volume içinde ayrıca sağlanmalıdır.

RunPod veya benzeri GPU pod deployment için ayrıntılı kaynak:

```text
docs/deployment/runpod_wham_worker.md
```

## 15. Sık Karşılaşılan Sorunlar

### Backend açılmıyor

`backend\.env` dosyasının var olduğunu ve komutun `backend` klasöründe çalıştığını kontrol edin. `DATABASE_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` zorunludur.

### `DATABASE_URL is required` veya database connection failed

PostgreSQL container'ı çalışıyor mu kontrol edin:

```powershell
cd backend
docker compose -p mocapexpo ps
```

Local varsayılan connection string:

```env
DATABASE_URL=postgres://mocap:mocap@localhost:55432/mocapexpo
```

### S3/MinIO bağlantısı yok

MinIO container'ı ve bucket oluşturma servisini kontrol edin. Mobil cihazla testte `S3_ENDPOINT=http://localhost:9000` kullanmayın; PC LAN IP kullanın.

### Worker job almıyor

Backend ve worker aynı `DATABASE_URL` ile aynı veritabanına bağlı olmalı. Job state `queued` değilse worker claim etmez. Upload tamamlanmadan processing job oluşmaz.

### WHAM preflight fail

`WHAM_REPO_DIR` klasörü `demo.py` içermeli. `WHAM_SOLVER_SCRIPT` repo içindeki `worker/model_adapters/wham_solver.py` dosyasına işaret etmeli. `WHAM_PREFLIGHT_REQUIRED_PATHS` içindeki checkpoint dosyaları gerçekten var olmalı.

### SMPL asset missing

`WHAM_SMPL_ASSET_DIR` doğru klasöre işaret etmiyor veya lisanslı SMPL asset'leri indirilmemiştir. Bu asset'leri repo'ya commit etmeyin.

### CUDA/GPU yok

`WHAM_REQUIRE_CUDA=true` iken preflight `torch.cuda.is_available()` false görürse worker başlamamalıdır. NVIDIA driver, WSL2 GPU passthrough, container runtime ve PyTorch/CUDA uyumluluğunu kontrol edin. CPU-only WHAM production için önerilmez.

### ffmpeg veya ffprobe bulunamadı

PowerShell'de şu komutlar çalışmalı:

```powershell
ffmpeg -version
ffprobe -version
```

Çalışmıyorsa FFmpeg PATH'e eklenmemiştir veya terminal yeniden başlatılmalıdır. Gerekirse `FFMPEG_PATH` ve `FFPROBE_PATH` absolute executable path olarak verin.

### Video normalize edilemedi

Kaynak video bozuk, codec desteklenmiyor, dosya boyutu/süre limiti aşıldı veya `WORKER_TEMP_DIR` yazılabilir değil. Worker loglarında FFmpeg stderr çıktısını kontrol edin.

### Telefon backend'e bağlanamıyor

Telefon ve PC aynı ağda olmalı. `EXPO_PUBLIC_MOCAP_API_BASE_URL` için `localhost` değil PC LAN IP kullanılmalı. Windows Firewall `4010` portuna izin vermeli.

### Mobil upload başarısız

Backend API'ye erişmek yeterli değildir; signed upload URL içindeki `S3_ENDPOINT` de telefondan erişilebilir olmalıdır. Fiziksel cihazda `S3_ENDPOINT=http://<PC_LAN_IP>:9000` kullanın.

### Android build hatası

JDK 17, Android SDK, Platform Tools ve emulator/device kurulumunu kontrol edin. Native modül değişikliklerinden sonra `npm run android` ile dev client tekrar build edilmelidir.

### Expo Go çalışmıyor

Bu proje native camera modülleri kullandığı için Expo Go yeterli değildir. Android dev client/native build gerekir.

### iOS Windows'ta build edilemiyor

iOS build için macOS + Xcode gerekir. Windows üzerinde Android cihaz/emulator ile test yapılır.

### Artifact oluşmadı

Job state `succeeded` değilse export kayıtları eksik olabilir. Worker loglarında `solving_motion`, `cleaning`, `exporting` aşamalarını ve S3 put hatalarını kontrol edin.

### Job failed

Backend job endpointinden `message` ve `errorCode` değerlerini okuyun. Sık nedenler: WHAM runtime hatası, SMPL asset eksikliği, video normalize hatası, S3 erişim hatası veya timeout.

## 16. Doğrulama Komutları

Root TypeScript:

```powershell
npm run typecheck
```

Backend TypeScript ve build:

```powershell
cd backend
npm run typecheck
npm run build
```

WHAM adapter Python syntax check:

```powershell
python -m py_compile backend/worker/model_adapters/wham_solver.py
```

macOS/Linux ortamında veya Python binary adı `python3` ise:

```bash
python3 -m py_compile backend/worker/model_adapters/wham_solver.py
```

Android Kotlin compile:

```powershell
cd android
.\gradlew.bat :app:compileDebugKotlin
```

macOS/Linux için:

```bash
cd android
./gradlew :app:compileDebugKotlin
```

MediaPipe residue search için Git yüklüyse:

```powershell
git grep -n -i -e MediaPipe -e PoseLandmarker -e RTMW -e "built-in solver" -e "synthetic solver" -- README.md src backend android ios package.json backend/package.json
```

PowerShell built-in alternatif:

```powershell
findstr /s /i /n "MediaPipe PoseLandmarker RTMW" README.md src\* backend\* android\* package.json
```

`rg` kullanmak isterseniz önce ripgrep kurun:

```powershell
winget install --id BurntSushi.ripgrep.MSVC -e
rg -n -i "MediaPipe|PoseLandmarker|RTMW|built-in solver|synthetic solver" README.md src backend android ios package.json backend/package.json
```

## 17. MediaPipe Kaldırıldı Notu

MediaPipe artık aktif runtime değildir. Proje WHAM/SMPL/SMPLify-only çalışır.

- Mobil uygulama MediaPipe veya PoseLandmarker çalıştırmaz.
- MediaPipe dependency, native bridge ve worker pipeline aktif kurulum parçası değildir.
- Eski pose-frame/keypoint temelli akışlar ana sözleşme değildir.
- Worker motion fallback, built-in solver, synthetic solver veya RTMW tabanlı aktif yol kullanmaz.

README içinde MediaPipe aktif kurulum adımı olarak geçmemelidir; yeni kurulumda MediaPipe kurulmaz.
