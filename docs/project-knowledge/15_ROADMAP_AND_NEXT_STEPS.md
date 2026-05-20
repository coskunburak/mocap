# 15_ROADMAP_AND_NEXT_STEPS

## Basis And Limits

This roadmap is based only on repository evidence and existing docs inspected on 2026-05-19. It separates confirmed implementation from plans, scaffolds, and reasonable next steps.

Do not treat roadmap items as implemented unless verified in source.

## Current Confirmed Implementation

| Area | Confirmed status |
| --- | --- |
| Mobile app | React Native/Expo app with native iOS and Android projects |
| Live capture | Camera preview, native pose bridge, skeleton overlay, avatar preview, countdown/recording flow |
| Local persistence | FS-backed local takes with metadata and chunked pose frames |
| Review | Local motion preview, take review, analysis/status/note paths |
| Upload | Signed URL metadata/video upload to backend |
| Backend API | Fastify API for projects, takes, capture sessions, uploads, processing jobs, exports |
| Backend storage | PostgreSQL plus S3-compatible object storage/MinIO local dev |
| Worker | Video normalization, pose detection, solving, cleanup, reports, artifact registration |
| Export result | Backend artifact listing/download/report UI |
| Dual capture | LAN host/guest and calibration-related code exists; production readiness not confirmed |
| Pro 4 capture | Backend session/device concepts and mobile setup UI exist; end-to-end production readiness not confirmed |
| WHAM/SMPL/SMPLify | Required backend/model adapter path exists; production deployment depends on external runtime/assets |
| Analytics/monetization/push | Not confirmed in repository |

## Short-Term Next Steps

1. Fix capture metadata propagation from `CaptureScreen` through `useWhamCapture` into `useRecorder` and persisted `CaptureMetadata`.
2. Verify selected front/back camera position reaches native video recording.
3. Add focused tests or QA fixtures for solo, dual, and Pro 4 metadata.
4. Add minimal CI for root typecheck/bundle check and backend typecheck/build.
5. Run real-device solo capture to upload to processing to export result QA.
6. Document exact production environment requirements for backend worker deployments.

## Medium-Term Improvements

| Improvement | Rationale |
| --- | --- |
| Backend auth replacement | Required before public backend, teams, billing, or sensitive production data |
| Schema parity tests | Prevent mobile/backend metadata drift |
| Artifact schema registry | Keep `ExportResultScreen` robust as worker outputs evolve |
| Better job timeline UI | Improve support/debuggability for failed processing |
| Storage/provider QA | Ensure S3-compatible behavior works beyond MinIO |
| Native camera lifecycle QA | Stabilize preview/inference/recording across iOS and Android |
| Dual capture recovery UX | Make LAN pairing/sync failures recoverable |

## Long-Term Roadmap

Repository docs and code suggest these directions, but implementation is not fully confirmed:

- Production-grade multi-device capture.
- WHAM/SMPL/SMPLify production solving pipeline.
- More robust motion cleanup and validation.
- Team/project cloud workflows.
- Analytics, crash reporting, and release observability.
- Monetization through server-enforced entitlements.
- More complete privacy, retention, and account controls.
- Automated end-to-end QA fixtures for capture/upload/processing/export.

## Risky Or Deferred Ideas

| Idea | Why deferred |
| --- | --- |
| Payment SDK integration | Needs production auth, entitlement model, legal/privacy review |
| Broad architecture rewrite | Current system spans native, mobile, backend, worker; risk is high without tests |
| Local heavy export as primary production path | JS memory/performance risk; backend pipeline is better suited |
| Full WHAM production launch | Requires external licensed assets, GPU runtime, preflight, and QA |
| Pro 4 marketing launch | Needs real multi-device QA and capture metadata fix |
| Replacing persistence format | Requires migration and corrupt-data handling |

## Items Requiring Product Decision

- Which capture modes are free vs paid, if any.
- Whether Pro 4 is a premium tier, internal tool, or core feature.
- Accepted processing wait times and quality thresholds.
- Export formats that must be first-class.
- Whether local debug export remains user visible.
- Account/team/project collaboration model.
- Retention/deletion policy for videos and pose data.

## Items Requiring Real User Testing

- Capture onboarding and permission flow.
- Skeleton lock/readiness feedback.
- Two-device LAN setup flow.
- Four-device session setup and join token flow.
- Review/trim/approve UX.
- Processing failure/retry comprehension.
- Export artifact selection/download UX.

## Items Requiring Backend Work

- Production authentication and authorization.
- Entitlement enforcement if monetization is added.
- Production CORS/origin policy.
- Storage provider validation and lifecycle/retention policy.
- Worker deployment preflight and health/status endpoints.
- API contract tests for upload and processing state transitions.

## Items Requiring Design Work

- Pro 4 setup flow.
- Upload/processing failure recovery.
- Paywall/entitlement UX if monetization is chosen.
- Accessibility pass on capture/review/export controls.
- Clear visual language for local debug vs backend production artifacts.

## Items Requiring Legal/Privacy Review

- Video and body motion data collection.
- Retention/deletion policy.
- Cloud processing consent.
- Analytics payload design.
- Team/project sharing permissions.
- App store privacy labels.
- Use of third-party model providers or GPU infrastructure.

## Next Best Production Step

Fix and verify the capture metadata/recording path before expanding dual, Pro 4, upload, or monetization behavior. The backend and worker depend on accurate `captureMode`, device role/index, view count, session id, calibration, and media metadata.

## What Should Not Be Done Yet

- Do not add RevenueCat/Stripe/StoreKit/Play Billing before auth and entitlement design.
- Do not market Pro 4 or WHAM as production-ready without real QA evidence.
- Do not replace core persistence or native camera architecture during unrelated feature work.
- Do not expose local `.env` or signed URL values while documenting deployment.
- Do not assume planning docs describe shipped behavior.

## Suggested Sprint Plan

| Sprint | Goal | Deliverables |
| --- | --- | --- |
| Sprint 1 | Capture correctness | Fix metadata propagation, camera position forwarding, add targeted tests/QA checklist |
| Sprint 2 | Backend processing confidence | Add upload/processing contract tests, worker fixture validation, storage provider QA notes |
| Sprint 3 | Release hardening | CI, auth plan, CORS config, signing/privacy checklist |
| Sprint 4 | Multi-device stabilization | Dual/Pro 4 real-device QA, setup UX fixes, backend session edge cases |
| Sprint 5 | Product decisions | Entitlements, analytics, retention policy, premium solver rollout plan |
