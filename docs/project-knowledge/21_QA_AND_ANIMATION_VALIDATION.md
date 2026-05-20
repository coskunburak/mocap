# 21_QA_AND_ANIMATION_VALIDATION

## Purpose

Motion capture QA must validate more than "the app runs." It must check camera lifecycle, pose tracking, local persistence, upload state, backend processing, artifact quality, and animation playback.

Use this doc with `11_TESTING_AND_QA.md` for feature-specific verification.

## QA Source Files

| Area | Files |
| --- | --- |
| Capture QA signals | `useWhamCapture.ts`, `CaptureScreen.tsx` |
| Local review analysis | `src/domain/mocap/pipeline/review/TakeReviewAnalyzer.ts`, `TakeReviewScreen.tsx`, `MotionPreviewScreen.tsx` |
| Local cleanup | `src/domain/mocap/pipeline/cleanup/PoseCleanupPipeline.ts` |
| Multi-view metrics | `multiViewStore.ts`, `FrameMatcher.ts`, `Triangulator.ts`, reconstruction worker files |
| Backend validation | `backend/src/worker/export/exportValidation.ts`, `blenderSmokeTest.ts`, `processJob.ts` |
| Backend QA scripts | `backend/src/qa/goldenE2e.ts`, `whamFixtureJob.ts`, `whamLiveApiJob.ts` |
| Blender smoke script | `backend/worker/blender_smoke_test.py` |

## Minimum Animation Quality Review

For each capture/export path, review:

- Does the skeleton follow the actor without major jumps?
- Are hips/root motion stable?
- Do feet slide excessively?
- Do knees/elbows bend in plausible directions?
- Are shoulders and spine orientation stable?
- Are hands/face present only when holistic data is actually available?
- Does playback duration match the source capture?
- Are there missing or duplicated frame sections?
- Are NaN/Infinity values absent from exported artifacts?
- Does the exported BVH import into Blender without structural errors?

## Solo Capture QA

1. Launch app on a real device.
2. Grant camera permission.
3. Open Capture.
4. Verify native preview appears.
5. Verify pose overlay and FPS update.
6. Switch tracking profile if UI supports it and confirm status.
7. Start countdown and record a short take.
8. Stop recording.
9. Confirm a local take is created.
10. Open Motion Preview and verify playback.
11. Open Take Review and save status/note if relevant.
12. Confirm local take metadata has video and capture metadata.

Critical checks:

- Camera selected in UI should match recorded video.
- Captured frame count should be plausible for duration/FPS.
- App should not freeze on stop/finalize.

## Local Persistence QA

Inspect through repository functions rather than manually editing files.

Checks:

- `TakeRepo.fs.ts` writes metadata.
- Chunk files are present and readable.
- `readTakeFrames` returns ordered frames.
- Corrupt/missing chunks fail gracefully where intended.
- Review/export status updates do not erase media or capture metadata.

Known gap:

- No automated persistence migration/corruption test suite was confirmed.

## Upload And Processing QA

1. Capture a short local take with video and metadata.
2. Start upload.
3. Verify upload stages:
   - create/ensure backend project
   - create/ensure backend take
   - initialize upload
   - upload metadata
   - upload video
   - complete upload
   - create processing job when expected video count is satisfied
4. Open Processing Status.
5. Verify job states move toward terminal success/failure.
6. On success, open Export Result.
7. Verify export list and report sections load.
8. Request download URL only through UI/service, not by printing signed values.

Failure checks:

- Network timeout retry.
- Signed URL expiration/retry.
- Missing local video.
- Backend validation failure.
- Worker failure with readable job state.
- Retry/cancel behavior.

## Dual-Camera QA

Hardware:

- Two real devices on same reachable network.
- Stable camera placement.
- Known calibration target or repeatable actor motion.

Flow:

1. Start host.
2. Join guest.
3. Confirm connection state and clock sync.
4. Run calibration.
5. Record simultaneous short take.
6. Verify remote frame age, matched/dropped frame metrics, and triangulation FPS.
7. Stop and inspect saved metadata for device roles, indexes, session id, view count, and calibration.
8. Upload and verify backend treats the take/session as dual.

Metrics to watch:

- remote frame age
- round-trip/sync metrics
- matched frames
- dropped frames
- reprojection error
- triangulation FPS

Known fragile areas:

- LAN discovery/manual IP entry.
- Phone sleep/background behavior.
- Calibration changes if devices move.
- Persisted metadata option propagation.

## Pro 4/Multi-View QA

Hardware:

- Four devices or a controlled multi-device test setup.
- Backend reachable from all devices.
- Storage endpoint reachable from all devices.

Flow:

1. Create backend capture session.
2. Register/join all expected devices.
3. Confirm each device slot and role/index.
4. Record synchronized sources.
5. Upload all source videos and metadata.
6. Verify backend waits for expected device count.
7. Verify worker enters multi-view reconstruction path.
8. Inspect `smpl_parameters_json`, quality report, pipeline report, and BVH.

Status:

- This is not confirmed production-ready. Treat it as partial until real-device QA passes.

## Backend Worker Validation

Commands from `backend/` when environment is configured:

```bash
npm run typecheck
npm run build
npm run qa:golden
npm run qa:wham-fixture
npm run qa:wham-live-api
```

Use only relevant QA scripts. WHAM scripts require external model/runtime configuration and may expose sensitive paths in logs if mishandled.

Worker validation should confirm:

- source videos download successfully
- video probe/normalization succeeds
- pose detection or premium solve succeeds
- reconstruction artifacts are produced when expected
- solved motion has correct frame count/duration
- BVH validates structurally
- quality report has meaningful warnings/errors
- pipeline report records engines/fallbacks
- job/take/session states are terminal and correct

## Blender Validation

Backend script:

- `backend/worker/blender_smoke_test.py`

Wrapper:

- `backend/src/worker/export/blenderSmokeTest.ts`

What it validates:

- BVH can be imported by Blender.
- Import does not immediately fail due to hierarchy or motion block structure.
- Optional JSON output can report import details.

What it does not validate:

- Artistic quality.
- Foot sliding.
- Retargeting to a specific production character.
- Unreal/Unity/Maya compatibility.

## External DCC QA

Recommended manual tools:

- Blender for BVH import and skeletal playback.
- Unreal Engine/Unity for game-engine retargeting if those are target workflows.
- MotionBuilder/Maya if pipeline users require them.

Manual review focus:

- root motion scale/orientation
- skeleton naming compatibility
- frame rate and duration
- floor contact
- shoulder/hip rotations
- hand and face data if present
- import warnings

## Golden Fixture Strategy

Suggested fixture set:

| Fixture | Purpose |
| --- | --- |
| Short solo front-facing capture | Baseline body pose |
| Side-view capture | Depth/limb ambiguity |
| Turn-in-place | Root orientation and heading |
| Walk cycle | Foot sliding/root motion |
| Arm raise | Shoulder/elbow behavior |
| Dual-camera synchronized clip | Triangulation and timestamp match |
| Four-view session | Pro 4 reconstruction |
| WHAM fixture | Premium solver path |

Store only safe, approved fixtures. Do not commit private user videos without explicit consent.

## Quality Report Review

Inspect:

- score/grade
- warnings
- errors
- frame count
- FPS
- dropped/invalid frames
- solver engine/fallback reason
- reconstruction metrics
- cleanup actions
- artifact registration

Quality warnings are useful even when jobs succeed. Do not hide them from QA summaries.

## Regression Checklist For Pose/Animation Changes

- Solo capture still works on target platform.
- Native camera events still serialize into `PoseFrame`.
- Local persistence reads previously captured takes.
- Motion preview still plays.
- Upload still sends metadata/video with correct capture mode.
- Processing job completes or fails with clear state.
- Export result screen still renders artifact/report types.
- BVH validation passes.
- No signed URLs, tokens, or private paths are printed in logs/screenshots.

## Known QA Gaps

- No confirmed automated UI test suite.
- No confirmed native unit test suite.
- No confirmed golden animation fixture suite in repository.
- No confirmed CI pipeline.
- Pro 4 real-device QA not confirmed.
- WHAM production runtime not self-contained in repository.
- Accessibility and localization QA not confirmed.

## Future Agent Rules

- For documentation-only work, do not run heavy model or device QA.
- For code changes, run the narrowest relevant checks and state what was not run.
- For native changes, rebuild and test on real device when possible.
- For worker/model changes, verify artifact outputs and reports, not just TypeScript build.
- For multi-device changes, do not claim success from single-device testing.
