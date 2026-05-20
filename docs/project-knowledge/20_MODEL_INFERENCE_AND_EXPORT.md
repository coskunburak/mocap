# 20_MODEL_INFERENCE_AND_EXPORT

## Scope

This doc covers the active model inference, solving, cleanup, and export path in MocapExpo after the WHAM-only cleanup.

Production inference is WHAM/SMPL/SMPLify only. The worker does not run an alternate detector or a built-in pose-to-motion fallback.

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

`ExportResultScreen.tsx` loads backend export records and presents WHAM/SMPL artifacts. It does not consume detector-style result fields or detector-specific reconstruction reports.

## Removed Paths

Deleted or unsupported paths include backend pose detectors, native detector runners, bundled detector model assets, detector package dependencies, detector feature flags, and any fallback path that can bypass WHAM.
