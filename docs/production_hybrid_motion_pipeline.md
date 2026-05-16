# Production Hybrid Motion Pipeline

Bu mimari mobilde hızlı ve stabil kayıt deneyimini korur, ağır pose/motion modellerini backend worker içinde izole eder. Capture ve Motion Preview ekranları mevcut akışla çalışmaya devam eder; kalite artışı worker artifact zincirinden gelir.

## Runtime Profile

```text
mobile capture/preview
  -> MediaPipe Pose Full/Heavy + existing 3D avatar
upload
  -> backend worker
  -> RTMW/RTMPose WholeBody adapter when configured
  -> MediaPipe fallback when allowed
  -> WHAM premium motion adapter when configured
  -> builtin humanoid fallback when allowed
  -> cleanup_quality_v1_5: temporal smoothing + outlier rejection + foot lock
  -> BVH + preview summary + motion_pipeline_report_json
```

## Worker Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSE_ENGINE` | `auto` | `auto`, `mediapipe`, or `rtmw`. |
| `RTMW_DETECTOR_SCRIPT` | empty | Python adapter path for WholeBody 133 keypoint detection. |
| `RTMW_DETECTOR_VERSION` | `rtmw_wholebody_adapter_v1` | Version label written into artifacts. |
| `RTMW_DEVICE` | `cpu` | `cpu`, `cuda`, or `mps` for the RTMW adapter runtime. |
| `RTMW_BACKEND` | `onnxruntime` | RTMW backend used by `rtmlib`. |
| `RTMW_MODE` | `balanced` | `performance`, `lightweight`, or `balanced`. |
| `RTMW_MIN_SCORE` | `0.2` | Minimum subject confidence to keep a frame. |
| `POSE_ENGINE_TIMEOUT_MS` | `900000` | Detection timeout per source video. |
| `ALLOW_POSE_FALLBACK` | `true` | Allows RTMW failure to fall back to MediaPipe. |
| `MOTION_SOLVER` | `auto` | `auto`, `builtin`, or `wham`. |
| `WHAM_SOLVER_SCRIPT` | empty | Python adapter path for WHAM/SMPL premium solve. |
| `WHAM_SOLVER_VERSION` | `wham_adapter_v1` | Version label written into solved motion artifacts. |
| `WHAM_REPO_DIR` | empty | Installed official WHAM checkout containing `demo.py`, configs, checkpoints, and SMPL assets. |
| `WHAM_CONFIG_PATH` | empty | Optional WHAM config path; relative paths resolve inside `WHAM_REPO_DIR`. |
| `WHAM_PRECOMPUTED_OUTPUT_PKL` | empty | QA/demo-only override that converts an existing `wham_output.pkl` instead of running WHAM inference. Leave unset in production. |
| `WHAM_CALIBRATION_PATH` | empty | Optional camera intrinsics file passed to WHAM. |
| `WHAM_LD_LIBRARY_PATH` | empty | Optional library path passed only to the WHAM child process, useful for conda PyTorch/DPVO libs such as `.../torch/lib:.../env/lib`. |
| `WHAM_ESTIMATE_LOCAL_ONLY` | `false` | Skips global SLAM when true. |
| `WHAM_ROOT_SCALE` | `100` | Converts WHAM meter-scale translation into exporter units. |
| `WHAM_REQUIRE_CUDA` | production WHAM: `true`, otherwise `false` | Preflight requires `torch.cuda.is_available()` before the worker starts. |
| `WHAM_PREFLIGHT_REQUIRED_MODULES` | `torch,cv2,joblib,smplx,mmcv,mmpose,loguru,mediapipe` | Python modules checked by the production WHAM preflight. |
| `WHAM_PREFLIGHT_REQUIRED_PATHS` | WHAM/HMR2 checkpoints | Comma-separated checkpoint/asset files; relative paths resolve inside `WHAM_REPO_DIR`. |
| `WHAM_SMPL_ASSET_DIR` | empty | Optional SMPL asset directory checked by the WHAM preflight. |
| `PREMIUM_MOTION_TIMEOUT_MS` | `1800000` | Premium solver timeout per job. |
| `REQUIRE_PREMIUM_MOTION` | `false` | Fails the job instead of falling back when premium solve is unavailable. |

Production worker startup fails fast if `NODE_ENV=production` and
`WHAM_PRECOMPUTED_OUTPUT_PKL` is set. It also requires `WHAM_SOLVER_SCRIPT`
when `MOTION_SOLVER=wham` or `REQUIRE_PREMIUM_MOTION=true`. In production
WHAM mode it also requires an explicit `WHAM_REPO_DIR` and `PYTHON_PATH`.

## Adapter Contracts

RTMW adapter input:

```text
python <RTMW_DETECTOR_SCRIPT> \
  --input <normalized-video> \
  --output <pose-json> \
  --detector-version <version> \
  --output-schema mocap.pose_frames.v1
```

The output may be either native `mocap.pose_frames.v1` or a compatible frame array with `landmarks`, `landmarks33`, or `wholeBodyLandmarks`. WholeBody 133 landmarks are preserved and mapped into the existing 33-landmark body schema so downstream reconstruction, cleanup, preview, and export do not break.

Included adapter: `backend/worker/model_adapters/rtmw_detector.py`.

WHAM adapter input:

```text
python <WHAM_SOLVER_SCRIPT> \
  --pose <pose-json> \
  --output <solved-motion-json> \
  --solver-version <version> \
  --source single_camera|dual_camera|multi_view \
  --preset <preset-id> \
  --take-id <take-id> \
  --job-id <job-id> \
  --video <normalized-video>
```

The WHAM adapter must output `mocap.solved_motion.v1` compatible frames: `frameIndex`, `timestampMs`, `rootTranslation`, and a `joints` map using the worker skeleton joint names.

Included adapter: `backend/worker/model_adapters/wham_solver.py`. It imports the official WHAM `demo.py` pipeline from `WHAM_REPO_DIR`, runs inference on the primary normalized video, selects the longest tracked subject from `wham_output.pkl`, and maps SMPL joints into the MocapExpo humanoid skeleton.

## Production Behavior

Default local/dev behavior stays safe: if no RTMW or WHAM script is configured, the worker uses MediaPipe plus the existing builtin humanoid solver.

Production high-quality mode:

```text
POSE_ENGINE=rtmw
RTMW_DETECTOR_SCRIPT=worker/model_adapters/rtmw_detector.py
RTMW_DEVICE=cuda
ALLOW_POSE_FALLBACK=false
MOTION_SOLVER=wham
WHAM_SOLVER_SCRIPT=worker/model_adapters/wham_solver.py
WHAM_REPO_DIR=/opt/WHAM
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
PYTHON_PATH=/opt/conda/bin/python
WHAM_LD_LIBRARY_PATH=/opt/conda/lib/python3.9/site-packages/torch/lib:/opt/conda/lib
WHAM_REQUIRE_CUDA=true
REQUIRE_PREMIUM_MOTION=true
```

Gradual rollout mode:

```text
POSE_ENGINE=auto
ALLOW_POSE_FALLBACK=true
MOTION_SOLVER=auto
REQUIRE_PREMIUM_MOTION=false
```

Each processed job emits `motion_pipeline_report_json`, which records the actual pose engine, motion solver, reconstruction source, fallback reasons, artifact keys, quality score, warnings, and errors. This is the operational source of truth for whether a job used premium processing or fallback.

## Production QA Gates

Two repeatable QA commands cover the WHAM integration:

```bash
npm --prefix backend run qa:wham-fixture -- \
  --video /path/to/source-or-rendered.mp4 \
  --wham-output-pkl /path/to/wham_output.pkl \
  --output-dir .local-artifacts/wham-fixture-job/latest \
  --python-path /path/to/python
```

This runs the real `WorkerJobProcessor` with file-backed fake repos/storage and
fails if the WHAM solved motion, BVH, quality report, or pipeline report is
missing or falls back.

```bash
npm --prefix backend run qa:wham-live-api -- \
  --video /path/to/source-or-rendered.mp4 \
  --output-dir .local-artifacts/wham-live-api-job/latest
```

This requires the local API, worker, Postgres, and MinIO to be running. It
creates a project/take through the API, uploads through signed URLs, creates a
real queued job, waits for the worker, downloads the same backend artifacts the
mobile `ExportResultScreen` reads, and fails unless the mobile card source is
`WHAM Premium Solve`, `backendMotion=wham@...`, all export sizes are numeric,
and no motion fallback was used.

## Runtime Images

RTMW can run in a lightweight ONNX image using `backend/worker/Dockerfile.rtmw`. WHAM should run in an image built from the official WHAM runtime or an equivalent CUDA/Python 3.9 environment because SMPL assets, ViTPose, DPVO, and WHAM checkpoints are licensed and installed outside this repo. `backend/worker/Dockerfile.wham-adapter` layers the MocapExpo backend worker over that runtime and starts with `node dist/worker/whamDeploymentPreflight.js` before consuming jobs.

RunPod production deployment checklist: `docs/deployment/runpod_wham_worker.md`.

Primary upstream references:

- WHAM official repository: https://github.com/yohanshin/WHAM
- rtmlib RTMW/RTMPose ONNX runtime: https://github.com/Tau-J/rtmlib
- MMPose inference docs: https://github.com/open-mmlab/mmpose/blob/main/docs/en/user_guides/inference.md
