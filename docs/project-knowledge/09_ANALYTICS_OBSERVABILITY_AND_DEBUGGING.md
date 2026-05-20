# 09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING

## Current Status

No product analytics SDK, analytics facade, crash reporting SDK, remote config service, or feature flag SaaS was confirmed in the repository.

Current observability is mostly:

- Mobile console logs/warnings/errors.
- React error boundary.
- Backend Fastify logger.
- Worker JSON console logs.
- PostgreSQL job timeline events.
- Worker output artifacts such as quality reports and pipeline reports.
- Backend QA scripts for selected worker/model paths.

## Analytics Service/Facade

Status: Not confirmed in repository.

No central `AnalyticsService`, event naming convention, screen tracking integration, or tap tracking API was found in `src/` or `backend/`.

Do not add ad hoc analytics calls directly to screens. If analytics is added later, create a small facade with typed events and redaction rules.

## Screen Tracking

Status: Not confirmed.

Navigation is centralized in `RootNavigator.tsx`, which is the right place to add future screen tracking if a navigation-aware analytics facade is introduced.

## UI Tap Tracking

Status: Not confirmed.

Many buttons exist across capture, review, upload, processing, and export flows. There is no confirmed tap/event tracking.

## Error Tracking And Crash Reporting

| Area | Current behavior |
| --- | --- |
| React UI crash | `ErrorBoundary.componentDidCatch` logs `UI Crash` and shows a reset panel |
| Native bridge errors | Promise rejections and console warnings/errors |
| API errors | Structured `ApiClientError` on mobile |
| Backend errors | Fastify structured error response with request id |
| Worker errors | Failed job state, timeline event, JSON console log |
| Crash reporting SDK | Not confirmed |

## Logging

Mobile logging:

- Entry modules log guarded loading success/failure.
- Capture and native bridge paths log errors and status.
- Networking logs host/guest connection and sync information.
- Export and preview paths log selected failures.

Backend logging:

- Fastify logger is enabled in `backend/src/server.ts`.
- Worker logs structured JSON in `backend/src/worker/index.ts`.

PII/sensitive data risk:

- Avoid logging signed URLs, bearer tokens, full `.env` values, storage credentials, or private backend URLs.
- Capture metadata can include device ids, file paths, timing, and capture details. Treat it as sensitive operational data.

## Job Timeline Observability

The strongest current observability mechanism is the backend job timeline.

Files:

- `backend/src/infra/db/repositories.ts` (`JobRepository.appendTimeline`)
- `backend/src/worker/processJob.ts`
- `src/features/upload/screens/ProcessingStatusScreen.tsx`

Each job state update can append:

- state
- message
- metrics JSON
- timestamp

The mobile processing screen displays timeline count, not the full detailed timeline.

## Worker Quality Artifacts

Worker output artifacts serve as post-run observability:

| Artifact | Purpose |
| --- | --- |
| `quality_report_json` | Score, grade, warnings, errors, validation |
| `preview_summary_json` | Duration, FPS, frame count, root motion, warnings |
| `motion_pipeline_report_json` | Engines, fallback reasons, artifact keys, quality |
| `cleanup_report_json` | Cleanup metrics and actions |
| `smpl_parameters_json` | Dual-camera sync, calibration, triangulation metrics |
| `smpl_parameters_json` | Multi-view placement, coverage, occlusion recovery |
| `wham_overlay_preview_mp4` | Visual WHAM overlay preview when enabled |

## Debug Views And Tools

| Tool/surface | Purpose | Status |
| --- | --- | --- |
| Capture debug overlays | Dual/pro connection, remote frame age, match stats, triangulation FPS | Active |
| `MotionPreviewScreen` gallery/player | Visual local take inspection | Active |
| `TakeReviewScreen` raw/cleaned toggle | Compare local cleanup/review decisions | Active |
| `ExportResultScreen` report sections | Inspect backend quality, pipeline, reconstruction, WHAM output | Active |
| Local debug export | Generate local bundle/reference files | Active behind feature flag in parts of UI |
| Backend QA scripts | Golden/WHAM validation | Active scripts |

## Performance Instrumentation

Confirmed utility files:

- `src/utils/perf/fps.ts`
- `src/utils/perf/fpsMeter.ts`
- `src/utils/perf/profiler.ts`

Confirmed UI metrics:

- Capture screen displays pose FPS.
- Multi-view debug panel displays triangulation FPS, sync RTT, reprojection error, matched/dropped frames.
- Capture quality accumulates pose confidence, visibility, tracking loss, FPS.

No external APM/performance SDK was found.

## Feature Flags And Remote Config

Local env flags:

| Flag | File | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW` | `env.ts` | Enable backend capture flow after recording |
| `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG` | `env.ts` | Enable local debug export path |
| `EXPO_PUBLIC_MOCAP_LOCAL_FRAME_RECORDING` / `MOCAP_LOCAL_FRAME_RECORDING` | `captureFlags.ts` | Control local pose frame recording |

Remote config: Not confirmed in repository.

## How Future Agents Should Add Analytics Safely

1. Create a central analytics facade, for example under `src/infra/analytics/`, instead of importing an SDK in screens.
2. Define typed event names and payloads.
3. Add redaction helpers for device ids, take ids, job ids, paths, URLs, and notes.
4. Hook screen tracking at the navigation container level.
5. Add workflow events at service boundaries where possible, such as upload started/completed/failed, processing state changed, export downloaded.
6. Keep analytics best-effort; analytics failures must not block capture, upload, review, or export.
7. Document any new events in this file.

## Events Or Logs That Must Not Contain PII/Sensitive Data

Never include:

- `.env` values.
- Storage credentials.
- Signed URLs.
- Bearer tokens.
- Local file URIs if they include user/device-specific paths.
- Full capture metadata payloads without redaction.
- User-entered review notes.
- Private backend hostnames.
- Device ids unless hashed/redacted.

Safe-ish aggregated fields:

- Capture mode.
- Expected device count.
- Job state.
- Export format.
- Numeric quality score.
- Duration bucket.
- Error code without raw exception context.

## Debug-Only Code Boundaries

Keep these paths clearly debug/reference unless product decides otherwise:

- Local `TakeExporter` production handoff from mobile pose frames.
- `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG`.
- Synthetic pose fallback in worker.
- WHAM precomputed output PKL.
- Local MinIO/Postgres credentials in Docker Compose.
- Console-heavy entry/module diagnostics.

## Current Gaps

- No central analytics or crash reporting.
- No privacy/PII redaction library.
- No external log aggregation.
- Job timeline exists but is not richly surfaced in mobile UI.
- No confirmed CI checks for observability regressions.
