# 14_KNOWN_RISKS_AND_TECH_DEBT

## Risk Summary

This file documents risks found from repository inspection. It does not imply all items should be fixed immediately. Use it to prioritize safe production hardening.

| Risk | Severity | Evidence/file path | Why it matters | Recommended next step | Fix now/later |
| --- | --- | --- | --- | --- | --- |
| Recording options can be dropped before persistence | High | `src/features/capture/hooks/useWhamCapture.ts`, `src/features/capture/hooks/useRecorder.ts`, `src/features/capture/screens/CaptureScreen.tsx` | `CaptureScreen` passes capture mode/device/session metadata, but `useWhamCapture.startRecording` forwards only a subset to `useRecorder.startRecording`. Dual/Pro capture metadata may be saved incorrectly. | Add focused propagation test and patch option forwarding before relying on dual/pro uploads. | Fix now before Pro 4/dual production |
| Native recording camera may ignore UI camera selection | Medium | `src/features/capture/hooks/useRecorder.ts`, `CaptureScreen.tsx`, `NativeCameraEngine.ts` | UI has front/back selection, but video recording call currently uses a fixed camera position. Users may record the wrong camera angle. | Thread selected camera position into recorder/native call and QA both platforms. | Fix now for capture reliability |
| Backend auth is development-grade | High | `backend/src/http/auth.ts` | Bearer token is treated as a user id and a dev fallback exists. This is not production authentication. | Design real auth/session model before public backend or billing launch. | Fix before production launch |
| CORS is broad | Medium | `backend/src/server.ts` | Allowing broad origins is convenient for local dev but risky for production APIs. | Restrict production origins through env/config. | Fix before production launch |
| No product analytics/crash reporting | Medium | `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md`, dependency search | Production issues will be difficult to diagnose after release. | Add central analytics/error facade with redaction rules, then integrate SDK. | Later, before beta scale |
| Automated tests are sparse/not confirmed | High | Root `package.json`, `backend/package.json`, `11_TESTING_AND_QA.md` | Complex capture, upload, worker, and native paths can regress silently. | Add narrow unit/contract tests for capture metadata, upload state, backend service transitions, and worker artifact schemas. | Start now |
| CI/CD not confirmed | High | No workflow found in inspected files | Regressions may merge without typecheck/build verification. | Add CI that runs root typecheck/bundle check and backend typecheck/build. | Start now |
| Android release uses debug signing config | High | `android/app/build.gradle` | Debug signing is not production-safe for store release. | Configure secure release signing outside repo and document release steps. | Fix before release |
| Sensitive local backend env exists | Medium | `backend/.env` present locally, tracked examples only | Accidental exposure could leak backend/storage credentials. | Keep local env untracked; never copy values into docs/logs; add secret scanning before release. | Always enforce |
| Signed URLs can leak through logs/screenshots | High | `SignedUrlUploadManager.ts`, `ObjectStorage`, upload/download flows | Signed URLs grant temporary storage access. | Redact signed URLs in logs and avoid rendering them in UI. | Fix as needed before beta |
| Local FileSystem persistence is complex | Medium | `src/infra/persistence/TakeRepo.fs.ts`, `takeRepoFs.reader.ts` | Chunked JSONL storage avoids huge blobs but increases migration/read corruption risk. | Add repository read/write tests and corrupt-chunk recovery behavior. | Start soon |
| Legacy MMKV take repo can confuse agents | Low | `src/infra/persistence/takeRepo.ts`, `TakeRepo.fs.ts` | Future agents may edit the old repo instead of current FS-backed path. | Document current active repo and remove/retire legacy path only with approval. | Later |
| Mobile/backend capture metadata schemas can drift | Medium | `src/domain/mocap/models/CaptureMetadata.ts`, `backend/src/domain/types.ts`, validators | Upload and worker behavior depend on consistent capture mode/device metadata. | Add schema parity tests or shared contract fixtures. | Start soon |
| Export artifact schemas are duplicated across mobile/backend UI | Medium | `ExportResultScreen.tsx`, backend export types/services | UI may break when worker registers new artifact types or report shapes. | Centralize/validate artifact type handling and add rendering fallback tests. | Later |
| Pro 4 flow is partial/scaffolded | High | `MultiViewSetupScreen.tsx`, `useMultiViewCapture.ts`, backend session service, roadmap docs | Backend supports expected device counts, but end-to-end UX/device orchestration needs QA before promises. | Treat as partial until multi-device real hardware QA passes. | Fix before marketing/pro launch |
| Dual LAN networking is fragile | Medium | `PeerHost`, `PeerGuest`, `TimeSync`, `MultiViewSetupScreen.tsx` | Mobile LANs, permissions, NAT, and sleep states can break pairing/sync. | Add clearer connection recovery and manual QA scripts/checklists. | Later |
| Worker runtime has external dependencies | High | `backend/src/config.ts`, `backend/src/worker/processJob.ts`, `backend/worker/` | FFmpeg, Python, WHAM, SMPL assets, Blender, and GPU paths can fail independently. | Keep preflight checks strict and document per-deployment requirements. | Before production worker |
| WHAM/SMPL assets are external/licensed | High | `premiumMotionSolver.ts`, WHAM deployment docs | Licensed assets cannot be vendored and production runtime must be configured carefully. | Keep WHAM optional and verify preflight; never commit checkpoints/assets. | Always enforce |
| Local debug export is not production source of truth | Medium | `src/domain/mocap/pipeline/export/`, `ExportScreen.tsx`, env flags | Local JS export may freeze UI and diverge from backend artifact pipeline. | Keep debug gated; prefer backend exports for production workflows. | Later |
| JS memory/performance pressure during frame/export handling | Medium | `TakeRepo.fs.ts`, `readTakeFrames`, local exporters | Large takes can create memory spikes or UI stalls. | Stream/chunk reads and move heavy export work off JS thread if product keeps local export. | Later |
| Route params are not fully type-safe across all paths | Low | Navigation screens/routes | Navigation regressions can surface at runtime. | Strengthen route typing when editing navigation. | Later |
| UI copy/localization is hardcoded | Low | Feature screens | Localization and copy consistency are difficult. | Introduce i18n only when product requires it. | Later |
| Accessibility coverage not verified | Medium | `08_UI_UX_AND_DESIGN_SYSTEM.md` | Capture/review/export workflows may be hard to use with assistive tech. | Add VoiceOver/TalkBack checklist and labels for critical controls. | Before public release |
| Privacy/legal posture not fully documented | High | App handles video/body motion data; no legal flow confirmed | Video and body/pose data can be sensitive. | Product/legal review for retention, consent, privacy policy, deletion/export rights. | Before production launch |
| Android manifest allows backup | Medium | `android/app/src/main/AndroidManifest.xml` | Backups can include sensitive local app data if not constrained. | Review backup policy for video/pose data before release. | Before release |
| Backend object validation can vary by S3 provider | Medium | `ObjectStorage`, `UploadService`, config skip flags | S3-compatible HEAD/metadata behavior can differ from MinIO. | Test production storage provider with real uploads and avoid skip flags in production. | Before production launch |

## Highest Priority Production Risks

1. Fix capture metadata propagation before relying on dual/Pro capture uploads.
2. Replace development auth before public backend or billing.
3. Add minimal CI and targeted tests for capture metadata, uploads, processing states, and worker artifacts.
4. Harden release signing and privacy/security posture.
5. Treat WHAM/Pro 4 as partial until real deployment and multi-device QA prove the path.

## Refactor Opportunities

| Opportunity | Why | Caution |
| --- | --- | --- |
| Shared mobile/backend capture metadata contract | Reduces schema drift | Avoid broad monorepo refactor unless tests exist |
| Analytics/error facade | Gives a safe extension point | Must include PII redaction from day one |
| Worker artifact schema registry | Makes UI rendering robust | Keep backward compatibility with existing artifacts |
| Local export workerization | Avoids JS UI freezes | May require native/background runtime work |
| Retire legacy MMKV repo | Reduces agent confusion | Confirm no callers/imports first |

## Do Not Fix Blindly

- Do not rewrite capture state management without understanding native bridge timing.
- Do not replace storage format without migration and read-back tests.
- Do not enable WHAM production paths without licensed assets, preflight, and GPU runtime validation.
- Do not add monetization before real auth and server-side entitlement enforcement.
- Do not change native build/signing files during unrelated feature work.
