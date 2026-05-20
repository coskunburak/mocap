# Job State Machine V1

## States

| State | Owner | Meaning |
| --- | --- | --- |
| `queued` | Backend | Job accepted and waiting for a worker. |
| `ingesting` | Worker | Original video and metadata are being fetched and validated. |
| `extracting_frames` | Worker | Source video is being normalized for WHAM. |
| `solving_motion` | Worker | WHAM, SMPL, and SMPLify motion solve are running. |
| `cleaning` | Worker | Jitter cleanup, foot locking, and validation are running. |
| `exporting` | Worker | BVH/GLB/FBX/JSON artifacts are being written. |
| `succeeded` | Worker | Exports and quality report are available. |
| `failed` | Worker | Terminal failure with a stable error code. |
| `canceled` | Backend | User/system canceled before terminal worker completion. |

## Transition Rules

1. Backend creates only `queued`.
2. Worker transitions jobs forward; backward transitions are rejected.
3. `failed` and `canceled` are terminal.
4. Retry creates a new job row linked by `retryOfJobId`.
5. Every transition appends a timeline event with timestamp, state, message, and optional metrics.

## Mobile Mapping

| Job state | Mobile status |
| --- | --- |
| `queued` | Waiting |
| `ingesting` | Preparing video |
| `extracting_frames` | Normalizing video |
| `solving_motion` | Running WHAM solve |
| `cleaning` | Cleaning motion |
| `exporting` | Creating exports |
| `succeeded` | Ready |
| `failed` | Failed |
| `canceled` | Canceled |
