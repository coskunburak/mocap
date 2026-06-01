# 20_MODEL_INFERENCE_AND_EXPORT

## Scope

This doc covers the active model inference, solving, cleanup, and export path in MocapExpo after the WHAM-only cleanup.

Production final animation inference is WHAM/SMPL/SMPLify only. Dual-camera reconstruction now exists as an additive diagnostic stage; it does not replace the primary WHAM final animation path.

## Dual Camera Reconstruction Durumu

- Tek kamera WHAM yapısı korunmuştur. Solo jobs ve `selectedVideoCount <= 1` single-camera WHAM production yolunda kalır.
- Dual camera tarafında backend reconstruction stage eklenmiştir.
- Dual camera hattı per-camera 2D pose extraction, frame sync, camera calibration, DLT triangulation, `dual_reconstruction.json`, `multi_view_reconstruction.json` ve quality metric üretir.
- Calibration, sync veya keypoint eksikse sistem fake başarı üretmez; artifact ve report status değerleri bunu açıkça belirtir.
- Final animation hâlâ primary WHAM'dan geliyorsa `quality_report_json` içinde `primaryCameraFallbackUsed: true` ve `finalAnimationSource: "primary_wham"` yer alır.
- Bu aşama Move.ai seviyesinde kalite iddiası değildir. Sonraki fazlar audio/native sync, gerçek calibration clip, AprilTag/checkerboard/human-pose calibration, triangulated 3D constraints into WHAM/SMPL, direct kinematic/biomechanical fitting ve final BVH from true dual-camera solve'dur.

## Active Model Path

| Model/path | Location | Purpose | Status |
| --- | --- | --- | --- |
| WHAM adapter | `backend/worker/model_adapters/wham_solver.py`, `backend/src/worker/export/premiumMotionSolver.ts` | Run WHAM from normalized source video and return motion/SMPL payloads | Required production path |
| SMPL parameters | `backend/src/worker/types.ts` | Persist body pose, global orientation, shape/betas, translation, camera, joints, mesh, and SMPLify metadata | Required artifact |
| Cleanup/export | `backend/src/worker/cleanup/motionCleanup.ts`, `backend/src/worker/export/*` | Clean solved motion, validate quality, write BVH/report artifacts | Active |

## Runtime Requirements

WHAM requires external runtime assets that are intentionally not vendored:

- WHAM repository/runtime
- WHAM checkpoints
- SMPL model assets
- Python environment compatible with the adapter
- FFmpeg/ffprobe
- CUDA/GPU where deployment requires it

Production startup must fail if the WHAM solver script, WHAM repo, Python runtime, or required CUDA setting is missing.

## Worker Pipeline

Main orchestrator:

- `backend/src/worker/processJob.ts`

Stages:

| Stage | Files | Output |
| --- | --- | --- |
| Probe/normalize video | `backend/src/worker/video/videoPipeline.ts` | `normalized_video_mp4` |
| Dual diagnostic reconstruction | `backend/src/worker/pose/poseExtraction.ts`, `backend/src/worker/reconstruction/*` | `pose_frames_device_json`, `multi_view_sync_json`, `camera_calibration_json`, `dual_reconstruction_json`, `multi_view_reconstruction_json` |
| WHAM solve | `premiumMotionSolver.ts`, `wham_solver.py` | raw WHAM motion and SMPL payload |
| SMPL normalization | `premiumMotionSolver.ts`, `types.ts` | `smpl_parameters_json` |
| Motion cleanup | `motionCleanup.ts` | `solved_motion_json`, `cleanup_report_json` |
| BVH write | `bvhWriter.ts` | `bvh` |
| Validation | `exportValidation.ts`, optional `blenderSmokeTest.ts` | `quality_report_json` |
| Artifact registration | `processJob.ts`, repositories | export records for mobile UI |

## Backend Artifacts

| Artifact | Purpose |
| --- | --- |
| `normalized_video_mp4` | Worker-normalized source video |
| `pose_frames_device_json` | Per-camera 2D pose frame artifact for dual/pro diagnostics |
| `multi_view_sync_json` | Frame sync report for multi-camera diagnostics |
| `camera_calibration_json` | Camera intrinsics/extrinsics/projection matrix readiness artifact |
| `dual_reconstruction_json` | Dual-camera DLT triangulation diagnostic artifact |
| `multi_view_reconstruction_json` | Multi-view reconstruction summary artifact |
| `pose_frames_json` | Main pose frames artifact; dual diagnostic world landmarks may use this only when compatibility is safe |
| `smpl_parameters_json` | WHAM/SMPL body model output |
| `raw_solved_motion_json` | Uncleaned WHAM solved motion |
| `solved_motion_json` | Cleaned solved motion |
| `cleanup_report_json` | Cleanup metrics/actions |
| `quality_report_json` | Quality score, grade, warnings/errors |
| `preview_summary_json` | Duration/fps/root motion/summary |
| `motion_pipeline_report_json` | WHAM/SMPL/SMPLify engine and artifact report |
| `wham_overlay_preview_mp4` | Optional visual overlay preview from WHAM |
| `bvh` | Primary backend animation export |

## Mobile Result Consumption

`ExportResultScreen.tsx` loads backend export records and presents WHAM/SMPL artifacts. When `quality_report_json` contains `multiView`, it also shows compact Multi-View Diagnostics such as sync confidence, calibration quality, reprojection error, triangulated coverage, fallback state, final animation source, and reconstruction status.

## Removed Paths

Unsupported production final-animation paths include native detector runners, bundled detector model assets, detector package dependencies that bypass WHAM, and any fallback path that can replace WHAM as the final solver. The backend per-camera pose extraction module is allowed only as a dual/pro diagnostic reconstruction input unless a future phase explicitly wires it into a real fitting solver.
