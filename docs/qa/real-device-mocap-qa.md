# MocapExpo Real-Device QA Plan

## Purpose

This QA plan validates production behavior on physical devices after the synthetic and golden multi-view checks have passed.

- Confirm the single-camera WHAM path still works on real devices.
- Confirm dual/pro capture upload waits for the expected video count and produces honest sync, calibration, reconstruction, and result metrics when multi-view reconstruction is available.
- Confirm multi-view reconstruction is currently a diagnostics and quality layer only. It is not a WHAM constraint path in this version.

## Non-Goals

- No Move.ai-level robustness claim.
- No WHAM constraint integration.
- No SMPL fitting change.
- No bundle adjustment.
- No occlusion handling.
- No production-quality real pose detector guarantee.
- No claim that single-device testing validates multi-device behavior.
- Pro 4-camera QA is optional until enough devices are available.

## Test Matrix

| Scenario | Required devices | Capture mode | expectedVideoCount | Expected backend branch | Expected artifacts | Expected result metrics | Pass/fail criteria |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| iOS single camera | 1 iOS device | `solo` | 1 | `single_camera_wham` | Existing single-camera artifact set | No multi-view metrics | Upload, WHAM solve, quality report, result download pass; Multi-View Diagnostics absent |
| Android single camera | 1 Android device | `solo` | 1 | `single_camera_wham` | Existing single-camera artifact set | No multi-view metrics | Upload, WHAM solve, quality report, result download pass; Multi-View Diagnostics absent |
| iOS + iOS dual | 2 iOS devices | `dual` | 2 | flag false: `primary_wham_fallback`; flag true: `multi_view_reconstruction` if adapter available | Dual artifacts when reconstruction succeeds | matched frames, sync delta, reprojection, triangulation, calibration | Both uploads complete; backend waits for 2 videos; result screen is honest about WHAM primary fallback |
| Android + Android dual | 2 Android devices | `dual` | 2 | flag false: `primary_wham_fallback`; flag true: `multi_view_reconstruction` if adapter available | Dual artifacts when reconstruction succeeds | matched frames, sync delta, reprojection, triangulation, calibration | Both uploads complete; backend waits for 2 videos; result screen is honest about WHAM primary fallback |
| iOS + Android dual | 1 iOS + 1 Android device | `dual` | 2 | flag false: `primary_wham_fallback`; flag true: `multi_view_reconstruction` if adapter available | Dual artifacts when reconstruction succeeds | matched frames, sync delta, reprojection, triangulation, calibration | Cross-platform metadata is consistent; fallback warnings are documented |
| Pro 4-camera mixed roles | 4 devices, optional | `pro_4_camera` | 4 | `multi_view_reconstruction` if adapter available | Pro multi-view artifacts | matched frames, sync delta, reprojection, triangulation, calibration | Optional pass; no production claim if not run |

## Single-Camera WHAM Regression Checklist

- Preview starts.
- Recording starts.
- Recording stops.
- Upload completes.
- Backend job starts.
- Branch is `single_camera_wham`.
- Multi-view branch is not entered.
- WHAM primary solve completes.
- Existing artifact set exists:
  - `smpl_parameters_json`
  - `raw_solved_motion_json`
  - `solved_motion_json`
  - `cleanup_report_json`
  - `quality_report_json`
  - `preview_summary_json`
  - `motion_pipeline_report_json`
  - `wham_overlay_preview_mp4`
  - `bvh`
- `quality_report.schema === "mocap.quality_report.v1"`.
- `quality_report.multiView` is absent or undefined.
- Result screen does not show the Multi-View Diagnostics section.
- BVH downloads and opens.

## Dual-Camera QA Checklist

- Both devices can join the same session.
- Host/guest role is visible.
- Device index consistency is preserved:
  - `device_0`
  - `device_1`
- Recording starts on both devices.
- Recording stops on both devices.
- Upload completes for both devices.
- Backend waits until `expectedVideoCount === 2`.
- Branch behavior:
  - flag false: `primary_wham_fallback`
  - flag true: `multi_view_reconstruction`
- If the real pose adapter is unavailable:
  - expected fallback/error is documented.
  - no reconstruction artifact is claimed.
- If a fixture/test adapter or real adapter is available:
  - `pose_frames_device_0_json` exists.
  - `pose_frames_device_1_json` exists.
  - `multi_view_sync_json` exists.
  - `camera_calibration_json` exists.
  - `dual_reconstruction_json` exists.
- `quality_report.multiView` exists when dual/pro metrics are available.
- `reconstructionUsedForConstraints === false`.
- `whamInputUsage.primaryVideoUsed === true`.
- `whamInputUsage.additionalVideosProvided === 1`.
- `matchedFrameCount > 0` if reconstruction is available.
- `averageTimeDeltaMs` is finite.
- `reprojectionErrorPx` is finite.
- `triangulatedLandmarkRatio` is finite.
- `calibrationQualityScore` is finite.
- Result screen shows Multi-View Diagnostics.
- Artifact download works.

## Cross-Platform Dual QA

For iOS + Android dual runs, additionally verify:

- timestamp units are consistent.
- orientation metadata is consistent.
- fps and resolution metadata are present.
- upload session grouping is correct.
- `captureSessionId` consistency is preserved.
- clock offset is present or fallback behavior is documented.

## Pro 4-Camera Optional QA

- `expectedVideoCount === 4`.
- device roles are unique.
- `pose_frames_device_0_json` exists.
- `pose_frames_device_1_json` exists.
- `pose_frames_device_2_json` exists.
- `pose_frames_device_3_json` exists.
- `multi_view_reconstruction_json` exists when reconstruction succeeds.
- no `artifactName` collision occurs.
- result screen shows multi-view metrics.

## Failure Modes

| Failure mode | Expected error/warning | User-visible expected behavior | Backend expected behavior |
| --- | --- | --- | --- |
| Missing video | `source_video_missing` or upload wait timeout | Processing does not claim success | Job fails or waits until expected video count is met |
| Upload failed | upload error or missing completed upload | User sees upload/process failure | No successful job artifacts are claimed |
| expectedVideoCount mismatch | source video count mismatch | Processing cannot complete normally | Worker rejects incomplete take |
| Pose adapter missing | `multi_view_pose_extraction_failed` | Result should explain primary WHAM fallback if allowed | No reconstruction artifacts are persisted |
| Sync confidence low | `sync_confidence_low` | Result screen shows warning | Sync report may exist with low confidence warning |
| Camera intrinsics fallback | `camera_intrinsics_fov_fallback_used` | Result screen shows fallback warning | Calibration artifact marks fallback source |
| Reprojection error high | `reprojection_error_high` | Result screen shows quality warning | Reconstruction artifact remains diagnostic |
| Reconstruction artifact missing | missing reconstruction artifact | Result must not claim multi-view solve | quality report says reconstruction unavailable |
| Primary WHAM fallback used | fallback reason code | Result clearly says WHAM used primary camera | `multiViewConstraintsUsed` remains false |

## Required Evidence

- Completed QA report using `docs/qa/real-device-qa-report-template.md`.
- JSON run manifest matching `backend/qa/real-device-qa.example.json`.
- Validator result from `npm --prefix backend run test:real-device-qa-validator` or equivalent manifest validation run.
- Links or IDs for jobs, takes, export files, and screenshots/logs where applicable.
