# Production WHAM Motion Pipeline

MocapExpo production motion capture is no longer hybrid. The only supported worker path is:

```text
source video + mocap.capture.v1 metadata
  -> backend processing job
  -> FFmpeg normalization
  -> WHAM solve
  -> SMPL parameters and SMPLify metadata
  -> cleanup, validation, preview summary
  -> BVH and JSON artifacts
```

## Required Configuration

| Variable | Purpose |
| --- | --- |
| `WHAM_SOLVER_SCRIPT` | Python adapter entry point, usually `backend/worker/model_adapters/wham_solver.py` |
| `WHAM_REPO_DIR` | External WHAM runtime checkout |
| `WHAM_CHECKPOINT_PATH` | WHAM checkpoint location |
| `SMPL_MODEL_PATH` | External SMPL model asset path |
| `PYTHON_PATH` | Python runtime with WHAM dependencies |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Video normalization/probing |
| `WHAM_REQUIRE_CUDA` | Production GPU requirement gate |

`WHAM_PRECOMPUTED_OUTPUT_PKL` is QA/demo-only and must not be used in production.

## Artifact Contract

The worker writes:

- `normalized_video_mp4`
- `smpl_parameters_json`
- `raw_solved_motion_json`
- `solved_motion_json`
- `cleanup_report_json`
- `quality_report_json`
- `preview_summary_json`
- `motion_pipeline_report_json`
- optional `wham_overlay_preview_mp4`
- `bvh`

## Deployment Notes

WHAM, SMPL assets, checkpoints, and GPU runtime dependencies are external to this repository. Use the RunPod/WHAM deployment docs and preflight checks before consuming jobs in production.

The worker must fail fast when WHAM runtime configuration is missing instead of selecting an alternate detector or local fallback.
