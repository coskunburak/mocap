# 18_PROJECT_STATUS_CHECKPOINT

Date of generation: 2026-05-19

## App And Platform

MocapExpo is a React Native / Expo mobile motion-capture app with native iOS Swift and Android Kotlin pose/camera modules, plus a Fastify TypeScript backend and TypeScript/Python worker pipeline.

## Current Architecture Summary

- Mobile app uses feature folders under `src/features/`, domain models/services under `src/domain/`, infra adapters under `src/infra/`, and centralized DI in `src/app/di/container.ts`.
- Navigation is React Navigation with bottom tabs plus stack routes in `src/app/navigation/RootNavigator.tsx`.
- State uses Zustand stores for capture and multi-view flows.
- Current local take persistence is FS-backed via `src/infra/persistence/TakeRepo.fs.ts`.
- Backend API owns projects, takes, capture sessions, uploads, processing jobs, and export file records.
- Worker consumes DB jobs, downloads uploaded videos, normalizes/detects/solves/cleans motion, uploads artifacts, and updates job/take/session state.

## Implemented Features

- Solo capture UI with native pose stream, skeleton overlay, avatar preview, countdown, and recording flow.
- Local take storage and review flows.
- Upload to backend through signed URLs.
- Processing status polling with retry/cancel.
- Backend export artifact listing and download URL flow.
- Local debug/reference export paths.
- Backend worker pipeline with reports and artifact registration.

## Partial Or Scaffolded Features

- Dual-camera LAN capture/sync/calibration.
- Pro 4 capture session setup and expected device handling.
- WHAM/SMPL/SMPLify backend model path.
- Local debug export as a production-quality export path.
- Analytics, crash reporting, push notifications, and monetization are not confirmed.

## Main Integrations

- Native camera recording on iOS/Android.
- PostgreSQL backend database.
- S3-compatible object storage, with MinIO for local development.
- FFmpeg/ffprobe for worker video processing.
- Python WHAM model adapter.
- Optional Blender smoke validation.

## Current QA/Test Status

- Root has `npm run typecheck` and `npm run bundle:check`.
- Backend has typecheck/build plus QA scripts for selected worker/model paths.
- No Jest/Vitest/Detox/Appium/snapshot/native test suite was confirmed.
- Real-device QA is essential for camera, native pose, recording, dual/pro capture, and upload processing.

## Known Blockers/Risks

- Capture metadata propagation into recorder may drop dual/Pro fields.
- Native recording camera may not follow UI camera selection.
- Backend auth is development-grade.
- No confirmed CI/CD.
- No production monetization/entitlement model.
- WHAM/SMPL/SMPLify production depends on external runtime/assets.
- Android release signing is not production-ready based on inspected config.

## Immediate Next Step

Fix and verify capture metadata and camera-position propagation through the recording path, then add focused tests/QA for solo, dual, and Pro 4 capture metadata before expanding processing or monetization.

## What Not To Do Yet

- Do not assume Pro 4 or WHAM is production-ready.
- Do not add monetization before auth and server-side entitlements.
- Do not refactor native/capture/persistence architecture without tests.
- Do not expose `.env`, signed URL, token, signing, or model asset secrets.

## Best Source-Of-Truth Docs

- `01_PROJECT_OVERVIEW.md`
- `03_ARCHITECTURE.md`
- `05_FEATURE_MAP.md`
- `06_DATA_MODELS_AND_STATE.md`
- `07_BACKEND_AND_INTEGRATIONS.md`
- `11_TESTING_AND_QA.md`
- `14_KNOWN_RISKS_AND_TECH_DEBT.md`
