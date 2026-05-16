# Model Adapters

These scripts are the production boundary between the Node worker and heavy
model runtimes. They are called as local Python executables by the backend
worker and must write the JSON contracts expected by `backend/src/worker`.

## RTMW WholeBody

Script:

```text
worker/model_adapters/rtmw_detector.py
```

Install:

```bash
pip install -r backend/worker/requirements.model-rtmw.txt
```

Worker env:

```text
POSE_ENGINE=rtmw
RTMW_DETECTOR_SCRIPT=worker/model_adapters/rtmw_detector.py
RTMW_DEVICE=cuda
RTMW_BACKEND=onnxruntime
RTMW_MODE=balanced
ALLOW_POSE_FALLBACK=false
```

The adapter uses `rtmlib.Wholebody`, selects the most stable detected subject,
stores 133 COCO-WholeBody landmarks, and lets the TypeScript worker map them
into the existing 33-landmark body schema.

The default requirement file installs CPU ONNX Runtime. In GPU images, replace
`onnxruntime` with the CUDA-matched `onnxruntime-gpu` package and set
`RTMW_DEVICE=cuda`.

## WHAM Premium Solve

Script:

```text
worker/model_adapters/wham_solver.py
```

The WHAM repo and SMPL assets are not vendored here. Install the official WHAM
checkout and assets in the model image, then point the backend worker to it:

```text
MOTION_SOLVER=wham
WHAM_SOLVER_SCRIPT=worker/model_adapters/wham_solver.py
PYTHON_PATH=/opt/conda/bin/python
WHAM_REPO_DIR=/workspace/WHAM
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
WHAM_LD_LIBRARY_PATH=/opt/conda/lib/python3.9/site-packages/torch/lib:/opt/conda/lib
WHAM_REQUIRE_CUDA=true
WHAM_PREFLIGHT_REQUIRED_PATHS=checkpoints/wham_vit_bedlam_w_3dpw.pth.tar,checkpoints/hmr2a.ckpt
WHAM_SMPL_ASSET_DIR=/workspace/WHAM/dataset/body_models/smpl
REQUIRE_PREMIUM_MOTION=true
```

The adapter imports the official WHAM `demo.py` pipeline, runs inference on the
primary normalized video with `save_pkl=True`, selects the longest tracked
subject from `wham_output.pkl`, maps SMPL joints into the MocapExpo humanoid
skeleton, and writes `mocap.solved_motion.v1` compatible frames.

For a manual RunPod validation where WHAM has already produced
`wham_output.pkl`, the same adapter can convert that cached result without
rerunning inference:

```bash
python worker/model_adapters/wham_solver.py \
  --wham-output-pkl /workspace/WHAM/output/demo/IMG_9732/wham_output.pkl \
  --video /workspace/WHAM/examples/IMG_9732.mov \
  --output /workspace/WHAM/output/demo/IMG_9732/solved_motion.json \
  --solver-version wham_adapter_v1 \
  --source single_camera \
  --take-id IMG_9732 \
  --job-id runpod_manual
```

For local backend job validation only, the TypeScript worker can pass the same
cached result by setting:

```text
WHAM_PRECOMPUTED_OUTPUT_PKL=/absolute/path/to/wham_output.pkl
```

Do not set this variable in production GPU worker deployments. The worker
startup guard rejects it when `NODE_ENV=production`.

## WHAM Production Worker Image

`backend/worker/Dockerfile.wham-adapter` builds the Node backend worker on top
of a WHAM CUDA runtime image:

```bash
cd backend
docker build -f worker/Dockerfile.wham-adapter -t mocapexpo-wham-worker:latest .
```

If your RunPod image name is different, override the base image:

```bash
docker build \
  --build-arg WHAM_PLATFORM=linux/amd64 \
  --build-arg WHAM_BASE_IMAGE=your-registry/wham-runtime:cuda11.3 \
  -f worker/Dockerfile.wham-adapter \
  -t your-registry/mocapexpo-wham-worker:latest \
  .
```

The Dockerfile defaults to `WHAM_PLATFORM=linux/amd64` so the Node build stage
matches the NVIDIA CUDA WHAM runtime even when the image is built from Apple
Silicon.

The final runtime installs `nodejs=20` into a dedicated `mocap-node` conda env
inside the WHAM image instead of copying the Debian build-stage Node binary.
This avoids glibc mismatches on the Ubuntu 18.04 CUDA WHAM base image. The
public `yusun9/wham-vitpose-dpvo-cuda11.3-python3.9` image already includes the
CUDA/Python runtime; production still needs the official WHAM checkout,
checkpoints, and SMPL assets supplied by a custom base image or mounted volume.

The image entrypoint runs `node dist/worker/whamDeploymentPreflight.js` before
`node dist/worker/index.js`. The preflight verifies the configured conda Python,
CUDA availability, WHAM checkout, checkpoints, SMPL directory, FFmpeg tools,
and required Python modules. Use `backend/.env.wham-worker.production.example`
as the RunPod env template.

## End-to-End WHAM QA

After a RunPod/manual WHAM solve has produced `wham_output.pkl`, use the fixture
job to validate the backend worker contract without local GPU inference:

```bash
npm --prefix backend run qa:wham-fixture -- \
  --video /path/to/source-or-rendered.mp4 \
  --wham-output-pkl /path/to/wham_output.pkl \
  --output-dir .local-artifacts/wham-fixture-job/latest \
  --python-path /path/to/python
```

With the local API, worker, Postgres, and MinIO running, use the live API gate
to verify the same artifacts consumed by the mobile result screen:

```bash
npm --prefix backend run qa:wham-live-api -- \
  --video /path/to/source-or-rendered.mp4 \
  --output-dir .local-artifacts/wham-live-api-job/latest
```

## Local Contract Checks

The scripts should at least compile in the base Python environment:

```bash
python3 -m py_compile \
  backend/worker/model_adapters/rtmw_detector.py \
  backend/worker/model_adapters/wham_solver.py
```

Full inference checks require the model runtime, GPU driver, and model weights.
