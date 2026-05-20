# 02_TECH_STACK

## Stack Summary

MocapExpo is a TypeScript React Native/Expo app with custom Swift and Kotlin native modules, plus a Node.js/Fastify/PostgreSQL/S3 backend and TypeScript/Python worker pipeline.

## Mobile App Stack

| Category | Library/tool | Configured in | Key files | Status |
| --- | --- | --- | --- | --- |
| Language | TypeScript | `tsconfig.json` | `src/**/*.ts`, `src/**/*.tsx` | Active |
| UI runtime | React 19, React Native 0.81 | `package.json` | `App.tsx`, `src/app/App.tsx` | Active |
| Expo | Expo SDK 54, Expo dev client | `app.json`, `package.json` | `index.ts`, native folders | Active |
| Navigation | React Navigation native stack and bottom tabs | `package.json` | `src/app/navigation/RootNavigator.tsx`, `routes.ts` | Active |
| State management | Zustand | `package.json` | `captureStore.ts`, `multiViewStore.ts` | Active |
| Dependency injection | Manual singleton container | `src/app/di/container.ts` | API client, session service, export service, upload manager | Active |
| App providers | Gesture handler, safe area, status bar, error boundary | `src/app/providers/AppProviders.tsx` | `ErrorBoundary.tsx` | Active |
| Local file storage | Expo FileSystem legacy API | `package.json` | `TakeRepo.fs.ts`, `takeRepoFs.reader.ts`, `TakeExporter.ts` | Active |
| Key/value storage | react-native-mmkv | `package.json` | `src/infra/persistence/storage.ts`, `takeRepo.ts` | Scaffolded/legacy, not used by current screens |
| Camera permission | react-native-vision-camera | `package.json`, `app.json` plugin | `CameraView.tsx` | Active for permission hook |
| Native camera | Custom `PoseEngineModule` and `PosePreviewView` | iOS/Android native projects | `NativeCameraEngine.ts`, native Swift/Kotlin camera files | Active |
| 3D rendering | `@react-three/fiber/native`, `three`, `three-stdlib`, Expo GL, Expo Asset | `package.json`, `metro.config.js` | `LiveAvatarViewer.tsx`, `src/assets/avatarAssets.ts` | Active |
| SVG overlay | react-native-svg | `package.json` | `OverlaySkeleton.tsx` | Active |
| Video playback | expo-video | `package.json` | `ExportResultScreen.tsx` | Active for WHAM overlay preview |
| Sharing | expo-sharing | `package.json` | `TakeExporter.ts`, export UI | Active |
| LAN networking | react-native-tcp-socket, react-native-network-info | `package.json` | `PeerHost.ts`, `PeerGuest.ts`, `PeerProtocol.ts` | Active for dual-camera prototype |
| Animation/gestures | react-native-gesture-handler, react-native-reanimated | `package.json` | `AppProviders.tsx`; reanimated usage not confirmed | Partially active |
| Skia | @shopify/react-native-skia | `package.json` | No source usage found | Unused/not confirmed |

## Native Mobile Stack

| Platform | Technology | Key files | Status |
| --- | --- | --- | --- |
| iOS | Swift native module and view managers | `ios/MocapExpo/pose/PoseEngineModule.swift`, `PoseCameraSession.swift`, `PosePreviewView.swift`, `VideoRecorder.swift` | Active |
| iOS dependencies | CocoaPods, AVFoundation camera stack | `ios/Podfile`, `ios/Podfile.lock` | Active |
| Android | Kotlin native module and CameraX | `android/app/src/main/java/com/anonymous/MocapExpo/pose/*` | Active |
| Android dependencies | Gradle, CameraX | `android/app/build.gradle` | Active |
| New Architecture | Enabled in Expo config, native projects exist | `app.json`, generated native folders | Active/configured |

## Backend Stack

| Category | Library/tool | Configured in | Key files | Status |
| --- | --- | --- | --- | --- |
| Language | TypeScript | `backend/tsconfig.json` | `backend/src/**/*.ts` | Active |
| Runtime | Node.js >=20 | `backend/package.json` | `backend/src/index.ts` | Active |
| HTTP server | Fastify 5 | `backend/package.json` | `backend/src/server.ts`, `backend/src/http/routes.ts` | Active |
| CORS | `@fastify/cors` | `backend/src/server.ts` | CORS origin currently true | Active, needs production hardening |
| Database | PostgreSQL via `pg` | `backend/src/infra/db/postgres.ts` | repositories, migrations | Active |
| Migrations | Custom Node script | `backend/scripts/migrate.cjs` | `backend/migrations/*.sql` | Active |
| Object storage | AWS SDK S3 client and presigner | `backend/package.json` | `backend/src/infra/storage/objectStorage.ts` | Active |
| Local infra | Docker Compose for Postgres and MinIO | `backend/docker-compose.yml` | development only | Active |
| Auth | Bearer token string used as user id | `backend/src/http/auth.ts`, `src/app/di/container.ts` | No real auth provider | Scaffolded/dev only |
| API validation | Hand-written validators | `backend/src/services/validators.ts` | service layer | Active |
| Queue | Database polling over `processing_jobs` | `backend/src/worker/index.ts`, `JobRepository.claimNextQueued` | Active |
| Worker logs | JSON console lines | `backend/src/worker/index.ts` | no external log sink confirmed | Active/local |

## Worker And AI/ML Stack

| Category | Library/tool | Configured in | Key files | Status |
| --- | --- | --- | --- | --- |
| Video tools | FFmpeg and ffprobe | backend env names in `backend/src/config.ts` | `videoPipeline.ts` | Active requirement |
| Motion solve | WHAM/SMPL/SMPLify adapter | env-driven | `premiumMotionSolver.ts`, `wham_solver.py`, deployment docs | Required production path |
| Cleanup | Custom cleanup/foot locking | source code | `motionCleanup.ts` | Active |
| Export validation | Built-in validation plus optional Blender smoke test | env-driven for Blender requirement | `exportValidation.ts`, `blenderSmokeTest.ts` | Active |
| RunPod | Serverless WHAM worker support | docs and Docker files | `backend/worker/docker/*`, `docs/deployment/runpod_wham_worker.md` | Documented/scaffolded |

## Remote Backend, Authentication, Analytics, Monetization

| Capability | Current repository status | Evidence |
| --- | --- | --- |
| Remote backend | Active custom backend | `backend/src/http/routes.ts`, `src/infra/api/MocapApiClient.ts` |
| Authentication | Dev/scaffolded only | `userIdFromRequest` maps bearer token to user id and falls back to a dev user |
| Authorization | Basic per-user DB filtering | repository queries use `user_id` |
| Analytics | Not confirmed in repository | no analytics SDK or event facade found |
| Crash reporting | Not confirmed in repository | no Sentry/Crashlytics/Bugsnag usage found |
| Payments/subscriptions | Not confirmed in repository | no RevenueCat, StoreKit, Stripe, IAP code found |
| Push notifications | Not confirmed in repository | no Expo notifications or APNs/FCM integration found |
| Remote config | Not confirmed in repository | no Firebase Remote Config or feature flag service found |
| Feature flags | Local env flags only | `env.ts`, `captureFlags.ts` |

## Package Managers And Build Tools

| Area | Tool | Files | Status |
| --- | --- | --- | --- |
| Root JS packages | npm | `package.json`, `package-lock.json` | Active |
| Backend JS packages | npm | `backend/package.json`, `backend/package-lock.json` | Active |
| iOS native deps | CocoaPods | `ios/Podfile`, `ios/Podfile.lock` | Active |
| Android native deps | Gradle | `android/build.gradle`, `android/app/build.gradle` | Active |
| Expo bundling | Metro | `metro.config.js` | Active, extended for GLB/GLTF/FBX assets |
| Type checking | TypeScript | root and backend scripts | Active |
| Lint/format packages | ESLint, Prettier installed | root `package.json` | Scripts not confirmed |

## Test Frameworks And CI/CD

| Capability | Status | Evidence |
| --- | --- | --- |
| Root unit tests | Not confirmed in repository | no root test script, no Jest/Vitest config found |
| Backend unit tests | Not confirmed in repository | no test script in `backend/package.json` |
| Backend QA scripts | Active scripts | `qa:golden`, `qa:wham-fixture`, `qa:wham-live-api` |
| Python tests | Not confirmed in repository | no pytest config found |
| CI/CD | Not confirmed in repository | no GitHub Actions files found in inspected tree |
| Bundle check | Active command | root `npm run bundle:check` |

## Sensitive Configuration

Sensitive configuration exists. A local `backend/.env` file is present in the working copy, and backend config requires database and S3 credentials. Do not copy any values from `.env`, signing files, certificates, provisioning files, storage keys, API tokens, or signed URLs into documentation, prompts, or logs.
