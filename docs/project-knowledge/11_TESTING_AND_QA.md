# 11_TESTING_AND_QA

## Current Test Status

Automated test coverage is limited.

| Area | Current evidence | Status |
| --- | --- | --- |
| Root mobile unit tests | No test script/config found in root `package.json` | Not confirmed |
| Root typecheck | `npm run typecheck` | Active |
| Root bundle check | `npm run bundle:check` | Active |
| Backend unit tests | No test script/config found in `backend/package.json` | Not confirmed |
| Backend typecheck/build | `npm run typecheck`, `npm run build` under `backend/` | Active |
| Backend QA scripts | `qa:golden`, `qa:wham-fixture`, `qa:wham-live-api` | Active |
| UI tests | Not confirmed | Not confirmed |
| Snapshot tests | Not confirmed | Not confirmed |
| Golden image tests | Not confirmed | Not confirmed |
| Native tests | Not confirmed | Not confirmed |

## Existing Verification Commands

Root app:

```bash
npm run typecheck
npm run bundle:check
npm run ios
npm run android
```

Backend:

```bash
cd backend
npm run typecheck
npm run build
npm run migrate
npm run qa:golden
npm run qa:wham-fixture
npm run qa:wham-live-api
```

Local backend infrastructure:

```bash
cd backend
docker compose up -d
```

Do not run dependency installation or destructive cleanup unless explicitly requested.

## Backend QA Scripts

| Script | File | Purpose |
| --- | --- | --- |
| `qa:golden` | `backend/src/qa/goldenE2e.ts` | Golden E2E validation |
| `qa:wham-fixture` | `backend/src/qa/whamFixtureJob.ts` | Validate WHAM conversion from fixture/precomputed output |
| `qa:wham-live-api` | `backend/src/qa/whamLiveApiJob.ts` | Validate live API/worker WHAM path |

Inputs and environment for these scripts can include sensitive backend and model configuration. Do not print or copy secrets.

## Worker Validation Mechanisms

The worker performs runtime validation:

- Video probe and duration limit.
- Pose detection must produce detected frames unless direct WHAM path is used.
- Solved motion validation.
- Cleaned motion validation.
- BVH text validation.
- Blender smoke test when available/required.
- Quality report generation.
- Pipeline report generation.

These are not replacements for automated tests, but they are important runtime safeguards.

## Minimum Safe Verification Before Merging

For documentation-only changes:

- Confirm only `docs/project-knowledge/` changed.
- No source/build/package/env changes.

For mobile TypeScript/UI changes:

- `npm run typecheck`
- `npm run bundle:check` if route/import/assets changed.
- Run app on the target platform if native/camera/UI behavior changed.

For backend API changes:

- `cd backend && npm run typecheck`
- `cd backend && npm run build`
- Run migrations against a safe local database if migrations changed.
- Exercise affected endpoint manually or with a QA script.

For worker changes:

- `cd backend && npm run typecheck`
- `cd backend && npm run build`
- Run the narrow relevant QA script.
- Verify artifact formats and job state transitions.

For native camera/pose changes:

- Rebuild native app.
- Test camera permission, preview, start/stop capture, start/stop recording.
- Verify local take has video metadata and capture metadata.
- Test on real device when possible.

## Feature-Specific Test Checklist

| Feature | Checks |
| --- | --- |
| Solo capture | Permission prompt, preview visible, pose lock, countdown, record, stop, local take saved, video metadata present |
| Local frame recording | Chunk files written, frames read back, no duplicate/out-of-order frame crash |
| Capture metadata | `mocap.capture.v1` validates, capture mode/device role/index are correct |
| Upload | Metadata/video signed URL upload, retry on failed attempt, local `remote` status updates |
| Processing status | Polling displays states, cancel/retry works, local `remote` mirrors terminal status |
| Export result | Export list loads, report JSON loads, signed download works, overlay preview plays if present |
| Review | Raw/cleaned playback, trim, approve/needs-work, note save |
| Local export | Formats write successfully from reviewed local take, share path works |
| Dual camera | Host listen, guest connect, time sync, remote frame preview, calibration wizard, matched frames |
| Pro 4 camera | Session create/join, device slots, join token flow, upload waits for all expected videos |
| Backend worker | Job transitions, normalized video stored, artifacts registered, quality report generated |

## Manual QA Checklist

1. Launch app and confirm no entry/module load crash.
2. Open Capture and grant camera permission.
3. Start capture and verify pose overlay updates.
4. Wait for skeleton lock, start countdown, record short clip, stop.
5. Confirm Motion Preview opens and playback works.
6. Open Take Review, save a review status.
7. Upload source to backend and watch Processing Status.
8. Confirm worker completes and Export Result opens.
9. Download/open primary backend artifact.
10. Confirm no secrets or signed URLs are visible in UI logs/screenshots.
11. For dual mode, test two devices on the same LAN.
12. For Pro 4, verify backend session/device count semantics before real production capture.

## Known Flaky/Fragile Areas

- Native camera lifecycle across preview, inference, and recording.
- Device-specific CameraX/AVFoundation recording behavior.
- LAN TCP connectivity on mobile networks.
- Large local frame chunks loaded into JS.
- Worker runtime dependencies and Python environments.
- WHAM GPU/asset availability.
- Backend storage HEAD validation with S3-compatible providers.

## Known Gaps

- No Jest/Vitest test suite confirmed.
- No Detox/Appium UI tests confirmed.
- No snapshot tests confirmed.
- No native test targets confirmed.
- No CI workflow confirmed.
- No formal local FileSystem schema migration tests.
- No central fixture set for mobile capture metadata validation confirmed.

## Recommended Test Additions

Priority test targets:

1. `CaptureMetadata` mobile/backend schema parity tests.
2. `useWhamCapture.startRecording` option propagation tests.
3. `TakeRepo.fs` read/write/chunk migration tests.
4. `MocapApiClient` contract tests against backend routes.
5. `UploadService` validation tests for capture mode/device role/index.
6. `ProcessingService` state transition tests.
7. Worker artifact schema validation tests.
8. Triangulator/frame matcher unit tests.
9. Native smoke checklist automated where possible.
