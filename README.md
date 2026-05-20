# MocapExpo Kurulum ve Çalıştırma Rehberi

Bu rehber, sıfır kurulmuş bir Windows bilgisayarda MocapExpo projesinin backend, worker ve Android mobil uygulama tarafını ayağa kaldırmak için hazırlanmıştır.

> Not: Bu projede `ios/` altında Swift, Xcode project ve CocoaPods dosyaları bulunur. iOS uygulaması Windows üzerinde derlenemez; iOS için macOS + Xcode gerekir. Windows PC'de mobil geliştirme hedefi Android'dir.

## 1. Mimari Özeti

MocapExpo üç ana parçadan oluşur:

- Mobil uygulama: Expo / React Native uygulaması. Android tarafında Kotlin native modülleri, kamera preview, video recording ve upload akışını çalıştırır.
- Backend API: `backend/src/index.ts` içinde başlayan Fastify API. Proje, take, upload, processing job ve export endpointlerini yönetir.
- Worker: `backend/src/worker/index.ts` içinde çalışan kuyruk tüketicisi. Veritabanındaki `queued` job kayıtlarını alır, videoyu işler ve export üretir.

Yerel geliştirmede servisler şu şekilde çalışır:

```text
Android uygulama
  -> Backend API, http://PC_IP:4010
  -> Signed upload URL alır
  -> Video + metadata MinIO/S3'e yüklenir
  -> Backend processing_jobs tablosuna queued job açar
  -> Worker job'u claim eder
  -> FFmpeg ile video normalize edilir
  -> WHAM/SMPL solve çalışır
  -> BVH ve rapor artifact'leri MinIO/S3'e yazılır
  -> Mobil uygulama job durumunu ve export download URL'lerini API'den okur
```

Yerel Docker Compose sadece altyapıyı getirir:

- PostgreSQL: `localhost:55432`
- MinIO S3 uyumlu storage: `localhost:9000`
- MinIO Console: `http://localhost:9001`

Backend API ve worker varsayılan olarak Node.js ile host üzerinde çalıştırılır. Aşağıda Docker üzerinden API/worker çalıştırma komutları da ayrıca verilmiştir.

## 2. Windows Üzerinde Gerekli Kurulumlar

PowerShell'i yönetici olarak açıp temel araçları kurun:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
winget install --id Python.Python.3.11 -e
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

## 3. Repo Kurulumu

Repo henüz bilgisayarda yoksa:

```powershell
git clone <REPO_URL> Mocapexpo
cd Mocapexpo
```

Repo zaten varsa:

```powershell
cd Mocapexpo
git pull
```

Mobil uygulama paketleri:

```powershell
npm ci
```

Backend paketleri:

```powershell
cd backend
npm ci
cd ..
```

## 4. Backend Ortam Dosyası

Backend `.env` dosyasını örnek dosyadan oluşturun:

```powershell
cd backend
copy .env.example .env
```

Windows üzerinde local worker çalıştıracaksanız `.env` içinde şu değerleri düzenleyin:

```env
PYTHON_PATH=.venv\Scripts\python.exe
WORKER_TEMP_DIR=.tmp\mocapexpo-worker
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

Mobil cihaz veya Android emulator ile gerçek upload testi yapacaksanız `S3_ENDPOINT=http://localhost:9000` yeterli değildir. Signed upload URL mobil cihaza döndüğü için bu adres mobil cihazdan da erişilebilir olmalıdır.

Önerilen yerel ayar:

```env
S3_ENDPOINT=http://<WINDOWS_PC_LAN_IP>:9000
```

Windows IP adresini bulmak için:

```powershell
ipconfig
```

Örnek:

```env
S3_ENDPOINT=http://192.168.1.35:9000
```

Backend API URL'i için:

- Android emulator: `http://10.0.2.2:4010`
- Fiziksel Android cihaz: `http://<WINDOWS_PC_LAN_IP>:4010`

Fiziksel cihaz kullanıyorsanız telefon ve PC aynı ağda olmalı, Windows Firewall `4010` ve `9000` portlarına izin vermelidir.

## 5. WHAM Worker Bağımlılıkları

Worker artık yalnızca WHAM/SMPL/SMPLify hattını destekler. WHAM repo, checkpoint ve SMPL asset'leri bu repoya vendored değildir; GPU worker ortamında kurulmalı ve `.env` içindeki WHAM değişkenleri o ortama işaret etmelidir:

```env
PYTHON_PATH=/opt/conda/bin/python
WHAM_SOLVER_SCRIPT=worker/model_adapters/wham_solver.py
WHAM_REPO_DIR=/workspace/WHAM
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
WHAM_SMPL_ASSET_DIR=/workspace/WHAM/dataset/body_models/smpl
WHAM_REQUIRE_CUDA=true
```

PowerShell script çalıştırmayı engellerse:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 6. Backend ve Worker'ı Host Üzerinde Çalıştırma

### 6.1 PostgreSQL ve MinIO

```powershell
cd backend
docker compose -p mocapexpo up -d
```

Kontrol:

```powershell
docker compose -p mocapexpo ps
```

MinIO Console:

```text
http://localhost:9001
Kullanıcı: mocap
Şifre: mocapdev
```

### 6.2 Veritabanı Migration

```powershell
cd backend
npm run migrate
```

### 6.3 Backend API

Ayrı bir PowerShell terminalinde:

```powershell
cd backend
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

### 6.4 Worker

Başka bir PowerShell terminalinde:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
npm run worker:dev
```

Worker boş kuyrukta şu mantıkla bekler:

```text
processing_jobs.state = queued
  -> worker job'u claim eder
  -> state sırasıyla ingesting / extracting_frames / solving_motion / cleaning / exporting olur
  -> başarılıysa succeeded, hatalıysa failed olur
```

## 7. Docker Üzerinden Backend + Worker Mimarisi

En pratik geliştirme akışı yukarıdaki gibi PostgreSQL ve MinIO'yu Docker'da, API ve worker'ı host Node.js ile çalıştırmaktır. Tamamen Docker komutları ile çalıştırmak isterseniz aşağıdaki akışı kullanabilirsiniz.

### 7.1 Docker Ortam Dosyası

`backend` klasöründe `.env.docker` oluşturun:

```env
NODE_ENV=development
PORT=4010
DATABASE_URL=postgres://mocap:mocap@postgres:5432/mocapexpo
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=mocapexpo-dev
S3_ACCESS_KEY_ID=mocap
S3_SECRET_ACCESS_KEY=mocapdev
S3_FORCE_PATH_STYLE=true
UPLOAD_URL_TTL_SECONDS=900
DOWNLOAD_URL_TTL_SECONDS=600
S3_REQUEST_TIMEOUT_MS=30000
MAX_VIDEO_BYTES=786432000
MAX_METADATA_BYTES=1048576
MAX_VIDEO_DURATION_SECONDS=180
WORKER_TARGET_FPS=30
WORKER_MAX_WIDTH=1280
WORKER_POLL_INTERVAL_MS=2000
WORKER_IDLE_LOG_INTERVAL_MS=30000
WORKER_TEMP_DIR=/tmp/mocapexpo-worker
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
PYTHON_PATH=python3
WHAM_SOLVER_SCRIPT=worker/model_adapters/wham_solver.py
WHAM_SOLVER_VERSION=wham_adapter_v1
WHAM_REPO_DIR=/workspace/WHAM
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
WHAM_SMPL_ASSET_DIR=/workspace/WHAM/dataset/body_models/smpl
WHAM_REQUIRE_CUDA=true
SKIP_OBJECT_HEAD_VALIDATION=false
```

Bu ayar Docker network içi backend/worker testleri içindir. Mobil cihazdan upload testi yapacaksanız `S3_ENDPOINT=http://minio:9000` mobil cihazdan çözülemez; bunun yerine PC LAN IP'sini kullanın.

### 7.2 Altyapıyı Başlatma

```powershell
cd backend
docker compose -p mocapexpo up -d
```

### 7.3 Migration'ı Docker ile Çalıştırma

```powershell
docker run --rm `
  --network mocapexpo_default `
  -v "${PWD}:/app" `
  -v mocapexpo_backend_node_modules:/app/node_modules `
  -w /app `
  --env-file .env.docker `
  node:20-bookworm `
  bash -lc "npm ci && npm run migrate"
```

### 7.4 Backend API'yi Docker ile Çalıştırma

```powershell
docker run --rm -it `
  --name mocapexpo-api `
  --network mocapexpo_default `
  -p 4010:4010 `
  -v "${PWD}:/app" `
  -v mocapexpo_backend_node_modules:/app/node_modules `
  -w /app `
  --env-file .env.docker `
  node:20-bookworm `
  bash -lc "npm ci && npm run dev"
```

### 7.5 Worker'ı Docker ile Çalıştırma

```powershell
docker run --rm -it `
  --name mocapexpo-worker `
  --network mocapexpo_default `
  -v "${PWD}:/app" `
  -v mocapexpo_backend_node_modules:/app/node_modules `
  -w /app `
  --env-file .env.docker `
  node:20-bookworm `
  bash -lc "apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg libgl1 libglib2.0-0 && npm ci && npm run worker:dev"
```

Bu komut yalnızca Node worker'ı başlatır. Gerçek motion solve için container'ın WHAM repo, checkpoint ve SMPL asset'lerine erişmesi gerekir; production için WHAM worker imajını kullanın.

### 7.6 Servisleri Durdurma

API ve worker container'larını terminalde `Ctrl+C` ile durdurun.

PostgreSQL ve MinIO:

```powershell
docker compose -p mocapexpo down
```

Verileri de silmek isterseniz:

```powershell
docker compose -p mocapexpo down -v
```

## 8. Production / GPU Worker Notu

Local ve production worker aynı motion pipeline'ı kullanır: WHAM, SMPL ve SMPLify. WHAM runtime için ek GPU/CUDA ortamı gerekir:

- WHAM deployment dokümanı: `docs/deployment/runpod_wham_worker.md`
- WHAM worker Dockerfile: `backend/worker/Dockerfile.wham-adapter`

WHAM worker imajı örnek build:

```powershell
cd backend
docker build -f worker/Dockerfile.wham-adapter -t mocapexpo-wham-worker:latest .
```

Bu imaj production GPU worker içindir; resmi WHAM repo, checkpoint ve SMPL asset'leri ayrıca sağlanmalıdır.

## 9. Android Mobil Uygulama Kurulumu

Bu uygulama Expo Go ile çalıştırılacak basit bir JS uygulaması değildir. Native modüller kullandığı için Android dev client build gerekir.

Backend çalışırken repo kökünde Android API URL'ini ayarlayın.

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
$env:EXPO_PUBLIC_MOCAP_API_BASE_URL="http://<WINDOWS_PC_LAN_IP>:4010"
$env:EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
$env:EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```

Fiziksel cihazı USB ile bağladıktan sonra kontrol:

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

## 10. Sık Karşılaşılan Sorunlar

### `DATABASE_URL is required`

Komutu `backend` klasöründe çalıştırdığınızdan ve `backend\.env` dosyasının var olduğundan emin olun.

### API çalışıyor ama mobil upload başarısız

`S3_ENDPOINT` mobil cihazdan erişilebilir bir adres olmalı. `localhost` telefon veya emulator için yanlış hedefe gider. Yerel mobil testlerde `http://<WINDOWS_PC_LAN_IP>:9000` kullanın.

### Android emulator API'ye bağlanamıyor

Emulator için API URL'i `http://10.0.2.2:4010` olmalı. Fiziksel cihazda ise PC'nin LAN IP adresi kullanılmalı.

### Worker `ffmpeg` veya `ffprobe` bulamıyor

`ffmpeg -version` komutu PowerShell'de çalışmalı. Çalışmıyorsa FFmpeg PATH'e eklenmemiştir veya terminal yeniden başlatılmalıdır.

### Worker WHAM Python hatası veriyor

`PYTHON_PATH`, `WHAM_REPO_DIR`, `WHAM_SOLVER_SCRIPT`, WHAM checkpoint'leri ve `WHAM_SMPL_ASSET_DIR` aynı GPU worker ortamında erişilebilir olmalıdır. Production worker başlangıcında `npm run worker:preflight:wham` bu gereksinimleri kontrol eder.

### iOS neden Windows'ta çalışmıyor?

Projede Swift native modüller ve Xcode workspace bulunur. iOS build için Apple toolchain gerektiğinden Windows üzerinde iOS kurulumu desteklenmez. Windows'ta Android build kullanılmalıdır.

## 11. Hızlı Başlangıç Özeti

Backend + worker local:

```powershell
cd backend
copy .env.example .env
npm ci
docker compose -p mocapexpo up -d
npm run migrate
npm run dev
```

Ayrı terminalde worker:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
npm run worker:dev
```

Ayrı terminalde Android:

```powershell
cd Mocapexpo
npm ci
$env:EXPO_PUBLIC_MOCAP_API_BASE_URL="http://10.0.2.2:4010"
$env:EXPO_PUBLIC_MOCAP_DEV_TOKEN="dev-user-id"
$env:EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW="true"
npm run android
```
