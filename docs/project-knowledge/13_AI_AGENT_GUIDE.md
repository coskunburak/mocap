# 13_AI_AGENT_GUIDE

## Purpose

This guide is for future coding agents working on the **MocapExpo** repository through Codex, Claude Code, Gemini, Antigravity, or similar tools.

The documentation package belongs to:

- Repository: `Mocapexpo`
- App: `MocapExpo`
- Platform: React Native / Expo mobile app with native iOS Swift and Android Kotlin modules
- Backend: Fastify TypeScript API plus TypeScript worker and Python model adapters
- Documentation snapshot date: 2026-05-19

Use these docs to avoid loading the entire repository into context before every task. They are a retrieval aid, not a replacement for source inspection.

## How To Use These Docs With NotebookLM MCP

1. Ask NotebookLM targeted questions about the relevant area.
2. Retrieve only the docs needed for the task.
3. Inspect the exact source files named by the docs.
4. Treat repository files as the current source of truth.
5. Report uncertainty when the docs and source do not match.

Do not ask NotebookLM to summarize the whole documentation package unless the user explicitly wants onboarding context. Broad retrieval wastes context and can blur implemented features with roadmap ideas.

## Which Docs To Query First

| Task | Query these docs first |
| --- | --- |
| Understand the app | `01_PROJECT_OVERVIEW.md`, `18_PROJECT_STATUS_CHECKPOINT.md` |
| Architecture or large behavior change | `03_ARCHITECTURE.md`, `04_PROJECT_STRUCTURE.md`, `14_KNOWN_RISKS_AND_TECH_DEBT.md` |
| Capture, pose, native camera | `05_FEATURE_MAP.md`, `19_POSE_PIPELINE.md`, `20_MODEL_INFERENCE_AND_EXPORT.md` |
| Data model or persistence change | `06_DATA_MODELS_AND_STATE.md`, `03_ARCHITECTURE.md` |
| Backend/upload/processing | `07_BACKEND_AND_INTEGRATIONS.md`, `20_MODEL_INFERENCE_AND_EXPORT.md` |
| UI change | `08_UI_UX_AND_DESIGN_SYSTEM.md`, relevant feature doc sections |
| Analytics/logging | `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md` |
| Monetization | `10_MONETIZATION_AND_PRODUCT_GATING.md`, `15_ROADMAP_AND_NEXT_STEPS.md` |
| QA/test planning | `11_TESTING_AND_QA.md`, `21_QA_AND_ANIMATION_VALIDATION.md` |
| Build/run/deploy | `12_BUILD_RUN_AND_DEPLOYMENT.md` |

## How To Avoid Token Waste

- Query one feature or concern at a time.
- Prefer docs that name exact files, then open only those files.
- Use `rg` for symbols and routes before reading directories.
- Do not load all `src/`, all `backend/`, or all docs into context.
- Do not ask for full source listings from NotebookLM.
- For repeated tasks, start with `18_PROJECT_STATUS_CHECKPOINT.md`.

## Safe Repo Inspection Workflow

Start with:

```bash
rg --files
rg "TargetSymbolOrRoute"
```

Important inspection files:

| Area | Inspect first |
| --- | --- |
| App boot/providers | `App.tsx`, `src/app/App.tsx`, `src/app/providers/AppProviders.tsx` |
| DI/services | `src/app/di/container.ts` |
| Env/config | `src/app/config/env.ts`, `backend/src/config.ts` |
| Navigation | `src/app/navigation/RootNavigator.tsx`, `src/app/navigation/routes.ts` |
| Capture | `src/features/capture/screens/CaptureScreen.tsx`, `src/features/capture/hooks/useWhamCapture.ts`, `src/features/capture/hooks/useRecorder.ts` |
| Persistence | `src/infra/persistence/TakeRepo.fs.ts`, `src/infra/persistence/takeRepoFs.reader.ts` |
| Backend API | `backend/src/http/routes.ts`, `backend/src/services/*.ts` |
| Worker | `backend/src/worker/processJob.ts`, `backend/src/worker/index.ts` |
| Native camera | `ios/MocapExpo/pose/`, `android/app/src/main/java/com/anonymous/MocapExpo/pose/` |

## How To Make Small Targeted Changes

1. Identify the feature slice: `src/features/<feature>/`, `src/domain/<domain>/`, `src/infra/<adapter>/`, or `backend/src/<area>/`.
2. Read the screen/hook/service that owns the behavior.
3. Follow existing dependency direction.
4. Change the narrowest layer that owns the behavior.
5. Add or update docs/tests only where they directly match the change.
6. Run the smallest relevant checks from `11_TESTING_AND_QA.md`.
7. List changed files and residual risk.

## How To Avoid Breaking Architecture

Keep these boundaries intact:

| Boundary | Rule |
| --- | --- |
| UI screens | Can call hooks/stores/services, but should not create backend clients directly |
| DI container | Central place for shared API/session/export/upload service singletons |
| Domain models | Keep capture/take/export shapes reusable across features |
| Infra adapters | Own FileSystem, MMKV, HTTP, signed URL uploads, native bridge adapters |
| Backend services | Own state transitions and storage validation; routes should stay thin |
| Worker | Own video normalization, pose/model execution, solving, cleanup, and artifact registration |
| Native modules | Own camera bridge behavior; JS should not assume implementation details not exposed by the bridge |

Do not bypass:

- `src/app/di/container.ts` for shared services.
- `src/infra/api/MocapApiClient.ts` for backend API calls.
- `src/infra/persistence/TakeRepo.fs.ts` for current local take storage.
- Backend service/repository layers for state mutations.
- Worker artifact registration for export outputs.

## Files To Inspect Before Editing Core Systems

| Change type | Required inspection |
| --- | --- |
| Capture recording | `CaptureScreen.tsx`, `useWhamCapture.ts`, `useRecorder.ts`, `TakeRepo.fs.ts`, `CaptureMetadata.ts` |
| Dual/Pro capture | `MultiViewSetupScreen.tsx`, `multiViewStore.ts`, `useMultiViewCapture.ts`, `backend/src/services/captureSessionService.ts` |
| Upload | `SignedUrlUploadManager.ts`, `UploadProgressScreen.tsx`, `backend/src/services/uploadService.ts` |
| Processing | `ProcessingStatusScreen.tsx`, `backend/src/services/processingService.ts`, `backend/src/worker/processJob.ts` |
| Export | `ExportResultScreen.tsx`, `ExportService.ts`, `backend/src/worker/export/`, `src/domain/mocap/pipeline/export/` |
| Model inference | WHAM adapter, SMPL artifacts, Python runtime configuration |
| Data model | `06_DATA_MODELS_AND_STATE.md`, all mobile/backend type definitions for the model |

## What Not To Touch Without Explicit User Approval

- `package.json`, lockfiles, dependency versions.
- Native project settings, Gradle files, Podfiles, signing files.
- `.env` files or any secret-bearing config.
- Certificates, provisioning profiles, keystores, private keys.
- Backend migrations in a destructive way.
- Generated build artifacts.
- Large architecture rewrites.
- Authentication, billing, or legal/privacy behavior.
- WHAM/SMPL licensed assets or private model checkpoints.

## Distinguish Implementation From Roadmap

The repository contains production plans and roadmap docs under `docs/`. Some describe intended future features, not current behavior.

Treat these as roadmap unless source confirms them:

- Fully production-ready Pro 4 capture.
- Fully production-ready WHAM/SMPL/SMPLify deployment.
- Monetization/paywalls/entitlements.
- Analytics/crash reporting.
- Team collaboration/billing.
- Full localization/accessibility support.

## How To Report Uncertainty

Use direct language:

- "Not confirmed in repository."
- "The docs mention this as a roadmap item, but I did not find source implementation."
- "I found a scaffold/config flag, but not a completed user flow."
- "I could not verify this because the relevant tool/runtime was unavailable."

Do not invent missing implementation details.

## Secrets And Sensitive Files

Sensitive configuration exists in this repository environment. Do not expose values.

Never paste:

- `.env` contents.
- Database URLs.
- S3 access keys or secret keys.
- Signed upload/download URLs.
- Bearer tokens.
- Private backend URLs.
- Device-specific local file paths if they reveal user data.
- Signing certificates, provisioning profiles, keystores, or passwords.
- Licensed model paths/checkpoints if they identify private infrastructure.

## Recommended Workflow

1. Query NotebookLM targeted docs.
2. Inspect relevant repo files.
3. Propose a concise plan for non-trivial changes.
4. Make minimal source changes.
5. Run relevant checks.
6. Summarize changed files, behavior, verification, and residual risks.

## Never Assume Roadmap Items Are Implemented Unless Verified In Repository

This is the strongest rule for future agents.

Existing planning docs mention advanced motion capture, premium WHAM solving, Pro 4 capture, analytics, and monetization ideas. Those items must be verified in current source before being treated as active product behavior. If a feature appears in a plan but not in `src/`, `backend/src/`, native files, or current configuration, document it as roadmap or "Not confirmed in repository."
