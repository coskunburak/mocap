# 12_BUILD_RUN_AND_DEPLOYMENT

## Local Run Overview

MocapExpo has three runnable parts:

1. Mobile app from repo root.
2. Backend API from `backend/`.
3. Backend worker from `backend/`.

Local backend infrastructure uses Docker Compose for PostgreSQL and MinIO.

## Required Tools

| Tool | Purpose | Notes |
| --- | --- | --- |
| Node.js | Root app and backend | Backend requires Node >=20 |
| npm | Package manager | Root and backend have separate lockfiles |
| Expo CLI/dev client | Mobile app run/build | Used by scripts |
| Xcode/macOS | iOS build/run | iOS cannot be built on Windows |
| CocoaPods | iOS dependencies | `ios/Podfile` |
| Android Studio/JDK/SDK | Android build/run | Gradle project exists |
| Docker | Local Postgres/MinIO | `backend/docker-compose.yml` |
| Python | Worker pose/model adapters | Python requirements under `backend/worker/` |
| FFmpeg/ffprobe | Worker video normalization/probing | Configured through backend env |
| Blender | Optional export smoke test | Required only if configured |
| CUDA/GPU runtime | WHAM production worker | External setup, not vendored |

## Root Mobile Commands

From repository root:

```bash
npm run start
npm run ios
npm run android
npm run web
npm run typecheck
npm run bundle:check
```

Notes:

- `npm run ios` and `npm run android` use Expo native run commands.
- The app depends on custom native modules, so Expo Go is not expected to cover all functionality.
- `bundle:check` exports iOS and Android bundles into `.expo-export-check`.

## Backend Commands

From `backend/`:

```bash
npm run dev
npm run build
npm run start
npm run worker:dev
npm run worker:start
npm run worker:preflight:wham
npm run migrate
npm run typecheck
npm run qa:golden
npm run qa:wham-fixture
npm run qa:wham-live-api
```

## Local Backend Infrastructure

From `backend/`:

```bash
docker compose up -d
```

This starts local PostgreSQL and MinIO. Development credentials are present in `backend/docker-compose.yml`; do not reuse them in production and do not copy sensitive values from local `.env`.

## Environment Files

Sensitive config exists. A local `backend/.env` file is present in the working copy.

Tracked examples:

- `backend/.env.example`
- `backend/.env.model-worker.example`
- `backend/.env.wham-worker.production.example`

Do not expose actual values from untracked local `.env` files.

Important config categories:

| Area | Env names/categories |
| --- | --- |
| Mobile API | `EXPO_PUBLIC_MOCAP_API_BASE_URL`, dev token, default project, timeouts |
| Mobile feature flags | backend capture flow, local debug export, local frame recording |
| Backend API | port, node env, database URL |
| Storage | S3 endpoint/region/bucket/access keys/TTL/timeouts |
| Limits | video bytes, metadata bytes, expected videos, duration, worker FPS/width |
| Worker runtime | temp dir, FFmpeg, ffprobe, Python path, pose detector script |
| Model runtime | WHAM/SMPL/SMPLify settings |
| WHAM | solver script, repo dir, config path, CUDA/preflight/assets/library path |
| Blender | optional Blender path and smoke test requirement |

## Build Variants, Flavors, Schemes

| Platform | Current evidence |
| --- | --- |
| Expo | Single app config in `app.json` |
| iOS | Xcode project/workspace `MocapExpo`, scheme file exists |
| Android | Single application id/namespace `com.anonymous.MocapExpo` |
| Flavors | No custom product flavors confirmed |
| Backend | Development/build/start scripts, no multi-env deployment code beyond env files |

## Debug/Release Differences

Mobile:

- Android release build currently uses debug signing config in `android/app/build.gradle`. This is not production release signing.
- Expo updates disabled in Android manifest metadata.
- Native modules require rebuild for bridge or native dependency changes.

Backend:

- `NODE_ENV=production` changes WHAM runtime assertions in `assertWorkerRuntimeConfig`.
- WHAM production forbids QA-only precomputed PKL and requires explicit runtime paths.

## Simulator/Device Differences

| Area | Simulator/emulator notes |
| --- | --- |
| Camera capture | Real device is strongly recommended for camera, video recording, and performance |
| Android emulator backend URL | Often uses special host mapping; README mentions emulator/device network differences |
| Physical devices | Backend API and S3 endpoint must be reachable from phone LAN |
| Dual camera | Requires two devices or careful emulator/device network setup |
| Pro 4 | Requires multiple devices and backend session coordination |

## Code Signing And Provisioning Notes

- iOS signing/provisioning details are not documented here and may be local/private.
- Android includes a debug keystore and debug signing config.
- Do not expose signing secrets, certificates, provisioning profiles, keystore passwords, or private Apple/Google credentials.
- Production Android release signing must not rely on the debug signing config.

## CI/CD

CI/CD is not confirmed in repository. No GitHub Actions workflow was found in inspected files.

## Deployment/Release Process

Backend/local:

1. Start Postgres/MinIO or point env to production services.
2. Run migrations.
3. Start backend API.
4. Start worker.
5. Confirm `/health`.

WHAM/RunPod:

- Deployment guidance exists in `docs/deployment/runpod_wham_worker.md`.
- Runtime needs external WHAM checkout, checkpoints, SMPL assets, and GPU-compatible Python environment.
- Preflight is handled by `backend/src/worker/whamDeploymentPreflight.ts`.

Mobile:

- Native builds are generated/present for iOS/Android.
- Release hardening, signing, store deployment, and CI are not confirmed.

## Common Build Errors And Likely Fixes

| Symptom | Likely cause | Inspect |
| --- | --- | --- |
| Native module `PoseEngineModule` not found | Native app not rebuilt after adding/changing module | iOS/Android native build, module registration |
| Camera permission denied | Permission not granted or manifest/plist mismatch | `CameraView`, native permissions, platform settings |
| WHAM assets missing | External WHAM checkpoints or SMPL assets not configured | WHAM runtime env paths |
| GLB/GLTF asset import fails | Metro asset extensions missing | `metro.config.js` |
| Backend fails on startup | Missing required env such as DB/storage config | `backend/src/config.ts` |
| Upload fails with storage validation | S3 endpoint unreachable from phone or object size mismatch | `SignedUrlUploadManager`, `UploadService`, storage config |
| Worker fails immediately | FFmpeg/Python/model env missing | `backend/src/config.ts`, `worker/index.ts` logs |
| WHAM preflight fails | WHAM repo/assets/CUDA/Python path missing | `whamDeploymentPreflight.ts`, deployment docs |
| Android release not production-safe | Release build uses debug signing | `android/app/build.gradle` |

## Build Files Future Agents Should Not Modify Without Approval

- `package.json`, `package-lock.json`
- `backend/package.json`, `backend/package-lock.json`
- `ios/Podfile`, `ios/Podfile.lock`
- Xcode project files and schemes
- Android Gradle files
- Signing files, certificates, provisioning profiles, keystores
- `.env` files

These are especially sensitive because dependency, native, or signing changes can break builds or expose credentials.
