# Production WHAM Motion Pipeline

MocapExpo production final animation path şu anda WHAM/SMPL/SMPLify merkezlidir. Single-camera WHAM üretim yolu korunur; dual-camera reconstruction stage eklemeli diagnostic katman olarak çalışır ve final BVH'yi otomatik olarak true dual-camera solve'a çevirmez.

```text
source video + mocap.capture.v1 metadata
  -> backend processing job
  -> FFmpeg normalization
  -> optional dual-camera reconstruction diagnostics
  -> WHAM solve
  -> SMPL parameters and SMPLify metadata
  -> cleanup, validation, preview summary
  -> BVH and JSON artifacts
```

## Dual Camera Reconstruction Durumu

- Tek kamera WHAM yapısı korunmuştur. `selectedVideoCount <= 1` ve solo capture mevcut single-camera WHAM yolunu kullanır.
- Dual camera tarafında backend reconstruction stage eklenmiştir: per-camera 2D pose extraction, frame sync, camera calibration, DLT triangulation, reconstruction artifact persistence ve quality metric üretimi.
- Bu stage diagnostic olarak çalışır. Calibration, sync veya keypoint eksikse fake başarı üretmez; durum artifact/report içinde açıkça görünür.
- Final animation hâlâ primary WHAM'dan geliyorsa `quality_report_json` bunu `primaryCameraFallbackUsed: true` ve `finalAnimationSource: "primary_wham"` ile belirtir.
- `motion_pipeline_report_json` dual/pro işler için reconstruction stage'lerini ve fallback reason'larını eklemeli olarak kaydeder.
- Sonraki fazlar audio/native sync, gerçek calibration clip, AprilTag/checkerboard/human-pose calibration, triangulated 3D constraints into WHAM/SMPL, direct kinematic/biomechanical fitting ve final BVH from true dual-camera solve'dur.

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

Worker single-camera WHAM path için şunları yazar:

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

Dual/pro diagnostic reconstruction çalıştığında ek olarak şunlar yazılabilir:

- `pose_frames_device_0.json`
- `pose_frames_device_1.json`
- `multi_view_sync.json`
- `camera_calibration.json`
- `dual_reconstruction.json`
- `multi_view_reconstruction.json`
- `pose_frames.json`, sadece diagnostic world-landmark formatı güvenliyse

`quality_report_json` içinde multi-view metric'leri optional/additive olmalıdır:

- `matchedFrameCount`
- `averageTimeDeltaMs`
- `syncConfidence`
- `reprojectionErrorPx`
- `reprojectionP95Px`
- `triangulatedLandmarkRatio`
- `fallbackLandmarkRatio`
- `calibrationQualityScore`
- `intrinsicsFallbackUsed`
- `primaryCameraFallbackUsed`
- `finalAnimationSource`

## Deployment Notes

WHAM, SMPL assets, checkpoints, and GPU runtime dependencies are external to this repository. Use the RunPod/WHAM deployment docs and preflight checks before consuming jobs in production.

The worker must fail fast when WHAM runtime configuration is missing instead of selecting an alternate detector or local fallback.
