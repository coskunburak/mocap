# Sprint 06-07 Cleanup, Quality and Result UX

Source plan:

- `docs/new_plan/sprints/sprint-06-cleanup-quality-v15.md`
- `docs/new_plan/sprints/sprint-07-result-preview-export-ux.md`
- `docs/new_plan/work_packages/wp-15-skeleton-definition-rotation-solve.md`
- `docs/new_plan/work_packages/wp-16-cleanup-foot-locking-quality-report.md`
- `docs/new_plan/work_packages/wp-17-export-validation-blender-smoke-test.md`
- `docs/new_plan/work_packages/wp-18-result-preview-export-result-ux.md`
- `docs/new_plan/work_packages/wp-21-qa-golden-dataset-e2e-validation.md`

## Sprint 6 Implementation

The backend worker now has a dedicated `cleaning` stage between raw skeleton solve and export generation.

```text
pose_frames.json
  -> raw_solved_motion.json
  -> cleanup_quality_v1_5
  -> solved_motion.json
  -> result.bvh
  -> cleanup_report.json
  -> quality_report.json
```

Implemented cleanup behavior:

- Confidence-aware interpolation for frames that failed raw solve.
- Root outlier rejection.
- Confidence-weighted smoothing for root and joint rotations.
- Root vertical stabilization.
- Basic foot contact detection.
- Basic foot locking using contact anchors.
- Bone length consistency measurement.
- Left/right swap count.
- User-actionable quality report actions.

Quality report metrics now include:

- `jitterScore`
- `jitterRms`
- `rootStability`
- `rootVerticalJitter`
- `footSlidingScore`
- `footSlidingDistance`
- `footContactFrameCount`
- `footLockFrameCount`
- `boneLengthConsistency`
- `boneLengthVariation`
- `leftRightSwapCount`
- `missingLandmarkRatio`
- `interpolatedFrameCount`
- `outlierFrameCount`

## Sprint 7 Implementation

`ExportResultScreen` now behaves as the production result surface:

- Lists backend-generated exports.
- Downloads and shares signed export URLs.
- Loads `quality_report.json`.
- Shows user-facing quality score, grade, validation state and actionable warnings.
- Loads `preview_summary.json` for lightweight result preview stats.
- Shows failed job reason when available.
- Supports retrying a failed job.
- Supports reprocessing the same remote take with a selected backend preset.

Production export remains backend-owned. Local mobile export stays behind `EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG=true`.

## Golden QA Harness

Golden E2E harness:

```bash
npm --prefix backend run qa:golden -- backend/qa/golden-samples.example.json
```

The harness performs:

```text
upload sample video + metadata
  -> start processing
  -> wait for worker completion
  -> list exports
  -> fetch quality_report.json
  -> enforce quality thresholds
  -> write golden-report.json
```

The example manifest declares three single-camera sample slots:

- walking
- turn
- low light

Actual sample videos are intentionally not committed. Place local videos and metadata under `backend/qa/samples/` or update paths in the manifest.

## Production Notes

- Blender smoke test still depends on `BLENDER_PATH`. For production worker images, set `REQUIRE_BLENDER_SMOKE_TEST=true`.
- Single-camera depth remains model-estimated. Sprint 6 improves stability and user feedback; true occlusion/depth recovery remains dual/pro camera scope.
- Aggressive foot locking is avoided by design. The V1.5 lock only applies when a low, stable ankle contact anchor exists.
