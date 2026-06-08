# RunPod WHAM GPU Worker Deployment

This deployment runs the real backend WHAM/SMPL worker. It is the production
path for the mobile Export Result screen's `WHAM Premium Solve` card. The
QA-only `WHAM_PRECOMPUTED_OUTPUT_PKL` path must never be set here.

## Dual Camera Notu

Dual/pro capture işlerinde backend ek olarak reconstruction diagnostic stage çalıştırabilir; bu RunPod WHAM gereksinimlerini kaldırmaz. Production dual QA için reconstruction branch'in gerçekten çalışması isteniyorsa `ENABLE_MULTI_VIEW_RECONSTRUCTION=true` değeri **RunPod worker runtime** içinde set edilmelidir. Local backend `.env` tek başına serverless job davranışını değiştirmez.

- RunPod worker WHAM repo, checkpoint, SMPL asset ve CUDA/Python runtime gereksinimlerini aynı şekilde ister.
- Dual-camera diagnostic artifact'leri (`multi_view_sync.json`, `camera_calibration.json`, `dual_reconstruction.json`, `multi_view_reconstruction.json`) final BVH'nin true dual-camera solve'dan geldiği anlamına gelmez.
- Final animation primary WHAM'dan geldiyse `quality_report_json` içinde `primaryCameraFallbackUsed: true` ve `finalAnimationSource: "primary_wham"` görünmelidir.
- Calibration, sync veya keypoint eksikse sistem fake başarı üretmemeli; diagnostic status ve fallback reason rapora yazılmalıdır.
- QA sırasında `ALLOW_PRIMARY_WHAM_FALLBACK=true` kalmalıdır. Gate veya artifact validation başarısızsa final BVH primary WHAM olarak kalır.

## Image Contract

Build the worker image from the backend directory:

```bash
cd backend
docker build \
  -f worker/Dockerfile.wham-adapter \
  -t mocapexpo-wham-worker:latest \
  .
```

For a self-contained production image, `worker/Dockerfile.wham-adapter` expects
a CUDA WHAM base image that already contains the official WHAM checkout, conda
env, DPVO extension, checkpoints, and SMPL assets. If those are mounted from a
RunPod volume instead, keep the image env pointed at the mounted paths.
Override the base image when needed:

```bash
docker build \
  --build-arg WHAM_PLATFORM=linux/amd64 \
  --build-arg WHAM_BASE_IMAGE=your-registry/wham-runtime:cuda11.3 \
  -f worker/Dockerfile.wham-adapter \
  -t your-registry/mocapexpo-wham-worker:latest \
  .
```

For a registry deploy, tag the image with an immutable version and push it:

```bash
cd backend
export IMAGE=ghcr.io/your-org/mocapexpo-wham-worker:2026-05-13-wham
docker build \
  --build-arg WHAM_PLATFORM=linux/amd64 \
  --build-arg WHAM_BASE_IMAGE=your-registry/wham-runtime:cuda11.3 \
  -f worker/Dockerfile.wham-adapter \
  -t "$IMAGE" \
  .
docker push "$IMAGE"
```

The Dockerfile defaults to `WHAM_PLATFORM=linux/amd64` because the WHAM CUDA
runtime is an NVIDIA GPU production image. Keep the Node build stage and WHAM
runtime on the same platform; otherwise an Apple Silicon build can accidentally
copy an ARM Node binary into an AMD64 CUDA image.

The final runtime installs `nodejs=20` into a dedicated `mocap-node` conda env
inside the WHAM image instead of copying the Node binary from the Debian build
stage. The current public WHAM image is Ubuntu 18.04 based, so Debian Node
binaries can require a newer glibc than the CUDA runtime provides.

`backend/.dockerignore` intentionally keeps local `.env`, `.venv`,
`node_modules`, and generated artifacts out of the Docker build context.

The final image starts with:

```text
node dist/worker/whamDeploymentPreflight.js
node dist/worker/index.js
```

Set `SKIP_WHAM_PREFLIGHT=true` only for emergency debugging. Normal production
pods should keep preflight enabled.

For RunPod Serverless endpoints, set:

```text
RUNPOD_SERVERLESS=true
```

That switches the same image to `worker/docker/runpod-wham-handler.py`, which
uses RunPod's Python serverless handler API. A test request of
`{"input":{"jobId":"preflight"}}` runs only
`node dist/worker/whamDeploymentPreflight.js` and returns the result to the
RunPod request output. A production request with a real backend processing job
id claims that queued job and processes it once.

For DB-free serverless validation, send:

```json
{
  "input": {
    "mode": "benchmark",
    "sourceVideoPath": "/workspace/WHAM/examples/IMG_9732.mov",
    "clipSeconds": 5,
    "outputDir": "/workspace/WHAM/output/runpod_benchmark",
    "timeoutSeconds": 3600
  }
}
```

This creates a 5-second benchmark clip, runs the WHAM adapter directly without
Postgres or object storage, and returns timing plus the output paths for
`solved_motion.json` and, when `WHAM_RENDER_OVERLAY_PREVIEW=true`,
`wham_work/output.mp4`. If a prepared short clip already exists, pass
`videoPath` instead of `sourceVideoPath` and `clipSeconds`.

## Required Runtime Paths

The preflight checks these paths inside the worker container/pod:

```text
PYTHON_PATH=/opt/conda/bin/python
WHAM_REPO_DIR=/workspace/WHAM
WHAM_SOLVER_SCRIPT=worker/model_adapters/wham_solver.py
WHAM_CONFIG_PATH=configs/yamls/demo.yaml
WHAM_PREFLIGHT_REQUIRED_PATHS=checkpoints/wham_vit_bedlam_w_3dpw.pth.tar,checkpoints/hmr2a.ckpt
WHAM_SMPL_ASSET_DIR=/workspace/WHAM/dataset/body_models/smpl
WHAM_LD_LIBRARY_PATH=/opt/conda/lib/python3.9/site-packages/torch/lib:/opt/conda/lib
```

If the WHAM image stores assets in different paths, keep `WHAM_REPO_DIR`
pointing at the official checkout and update the env values. Relative
`WHAM_CONFIG_PATH` and `WHAM_PREFLIGHT_REQUIRED_PATHS` values resolve inside
`WHAM_REPO_DIR`.

The Dockerfile defaults target the RunPod production layout under
`/workspace/...`. If your custom WHAM base image stores the official checkout,
conda env, or assets elsewhere, override the environment variables and the
`WHAM_PIP` build arg. The preflight is the source of truth: whichever values
you set must exist inside the running container.

The public `yusun9/wham-vitpose-dpvo-cuda11.3-python3.9` image is useful as a
CUDA/Python runtime, but it does not include the official WHAM checkout,
checkpoints, or SMPL assets. A production deployment must provide those through
a custom base image or a mounted RunPod volume.

## RunPod Environment

Use `backend/.env.wham-worker.production.example` as the deployment template.
The worker is not tied to AWS S3, but it does require a public Postgres database
and an S3-compatible object store that the Mac backend, mobile upload flow, and
RunPod worker can all reach. Supabase can provide both Postgres and
S3-compatible Storage; copy the database connection string from the project
database settings, enable Storage S3 protocol, create S3 access keys, and set
`S3_ENDPOINT` to the project's Storage S3 endpoint.

The minimum production posture is:

```text
NODE_ENV=production
WHAM_REQUIRE_CUDA=true
ENABLE_MULTI_VIEW_RECONSTRUCTION=true
ALLOW_PRIMARY_WHAM_FALLBACK=true
```

`ENABLE_MULTI_VIEW_RECONSTRUCTION=true` reconstruction branch'i açar; `true_dual_solve` kabulü anlamına gelmez. Pose detector, sync, calibration, triangulation, fitting gates ve optimized BVH persistence ayrı ayrı geçmelidir.

Set the optional reconstruction pose detector env in the same RunPod template when real dual triangulation QA is expected:

```text
MOCAPEXPO_POSE_DETECTOR=rtmpose_mmpose
MOCAPEXPO_RTMPOSE_CLI_PATH=/workspace/pose/rtmpose_cli.py
MOCAPEXPO_RTMPOSE_MODEL_PATH=/workspace/pose/models/rtmpose.pth
MOCAPEXPO_RTMPOSE_CONFIG_PATH=/workspace/pose/configs/rtmpose.py
MOCAPEXPO_RTMPOSE_TIMEOUT_MS=120000
```

If this detector is missing or fails, the worker should report `multi_view_pose_extraction_failed`, persist any safe missing-pose diagnostic artifacts, and continue primary WHAM fallback when allowed.

Production startup fails if any of these are wrong:

```text
WHAM_PRECOMPUTED_OUTPUT_PKL is set
WHAM_SOLVER_SCRIPT is missing
WHAM_REPO_DIR is missing
PYTHON_PATH is not explicit
```

## RunPod Template

Create a RunPod pod/template with:

```text
Container image: the pushed mocapexpo-wham-worker image
GPU: CUDA GPU compatible with the WHAM/PyTorch base image
Container disk / volume: large enough for WHAM checkpoints, SMPL assets, temp video files
Start command: leave empty unless doing a debug preflight pod
Expose ports: none required for the worker
```

Set secrets/env from `backend/.env.wham-worker.production.example`. Do not bake
`DATABASE_URL`, S3 keys, or `WHAM_PRECOMPUTED_OUTPUT_PKL` into the image.

For Serverless, also set:

```text
RUNPOD_SERVERLESS=true
```

Do not use the long-running DB polling entrypoint for Serverless. Without
`RUNPOD_SERVERLESS=true`, RunPod can pull the image and show the worker as ready,
but `/run` requests remain queued because no serverless handler is consuming
them.

The API backend must also submit jobs to the Serverless endpoint. In the backend
environment, set:

```text
RUNPOD_DISPATCH_ENABLED=true
RUNPOD_ENDPOINT_ID=your_endpoint_id
RUNPOD_API_KEY=your_runpod_api_key
RUNPOD_API_BASE_URL=https://api.runpod.ai/v2
```

Without these backend-side dispatch settings, mobile uploads can create
PostgreSQL jobs that stay at `queued` forever because no RunPod `/run` request
is created.

For a debug pod that should not consume queue jobs, override the command to:

```bash
sh -lc 'cd /app/backend && node dist/worker/whamDeploymentPreflight.js && sleep infinity'
```

If the mounted `/workspace/WHAM` volume has not been prepared yet, run:

```bash
cd /app/backend
FETCH_WHAM_DEMO_DATA=true sh worker/docker/runpod-wham-volume-setup.sh
```

That script clones the official WHAM repository and then runs WHAM's
`fetch_demo_data.sh`, which prompts for the licensed SMPLify and SMPL
credentials required by the official project. Re-run it without
`FETCH_WHAM_DEMO_DATA=true` to check whether the expected repo, checkpoints,
and SMPL asset paths are present.

## First-Pod Verification

Before letting the worker consume queue jobs, open a shell in the RunPod image:

```bash
cd /app/backend
node dist/worker/whamDeploymentPreflight.js
```

Expected result:

```text
"message":"WHAM production preflight passed."
```

The preflight output also includes a safe runtime summary: DB/S3 presence, WHAM/Python/ffmpeg paths, `ENABLE_MULTI_VIEW_RECONSTRUCTION`, and `ALLOW_PRIMARY_WHAM_FALLBACK`. It does not print secrets. A RunPod serverless request with `{"input":{"jobId":"preflight"}}` returns the same summary under `runtimeEnv`.

Then start the worker normally through the image entrypoint. Submit one real
mobile/API export job and verify:

```text
job.status = succeeded
motion_pipeline_report_json.backendMotion starts with wham@
motion_pipeline_report_json.motionFallbackUsed = false
solved_motion_json.solver.name = wham
Export Result screen shows WHAM Premium Solve from downloaded backend artifacts
```

The local live gate can still be used against a deployed API/worker by pointing
the app API URL at that environment and running:

```bash
npm --prefix backend run qa:wham-live-api -- \
  --video /path/to/validation-video.mp4 \
  --output-dir .local-artifacts/wham-live-api-job/production
```

Do not pass `WHAM_PRECOMPUTED_OUTPUT_PKL` for this production validation.

## Common Failure Modes

`WHAM_PRECOMPUTED_OUTPUT_PKL is QA/demo-only` means a fixture-only override was
left in production env. Remove it.

`WHAM_REPO_DIR is required` means the worker does not know where the official
WHAM checkout is mounted. Set it to the directory that contains `demo.py`.

`WHAM asset ... is missing` means the checkpoint path in
`WHAM_PREFLIGHT_REQUIRED_PATHS` does not match the image or mounted volume.

`CUDA is required but torch.cuda.is_available() is false` means the pod was
started without a usable GPU, the CUDA/PyTorch versions do not match, or
RunPod did not expose the device to the container.
