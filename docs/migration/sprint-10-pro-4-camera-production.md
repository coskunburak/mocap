# Sprint 10 Pro 4-Camera Production Implementation

## Scope

Sprint 10 extends the dual-camera backend into a pro multi-view foundation:

- 4-device capture sessions with `front`, `right`, `back`, `left` roles.
- 4-video upload grouping under one take.
- Processing guard that requires all expected pro videos before job creation.
- Per-camera normalization and pose detection for all four videos.
- Pairwise audio sync from the reference camera to every secondary camera.
- Multi-view frame matching.
- Best-pair DLT triangulation per landmark.
- Baseline occlusion recovery using temporal hold plus available-view fallback.
- Camera placement scoring and feedback.
- Multi-view quality score, reprojection metrics, coverage metrics, and export validation.

## Artifact

Pro jobs now produce:

```text
takes/{takeId}/jobs/{jobId}/multi_view_reconstruction.json
```

The artifact schema is `mocap.multi_view_reconstruction.v1` and includes:

- camera placement scores and angle feedback
- sync offsets and confidence
- matched frame coverage
- reprojection average and p95
- triangulated landmark ratio
- occlusion recovery counts
- multi-view quality gain against single-camera baseline

## Result UX

The result screen now surfaces pro multi-view feedback:

- camera count
- placement quality
- matched view coverage
- occlusion recovery ratio
- reprojection error
- triangulated landmark ratio
- per-camera angle and placement score

## QA

The golden E2E manifest supports a `pro_4_camera` sample with four videos. The harness asserts `multi_view_reconstruction_json` for 4-camera samples.

```bash
npm --prefix backend run qa:golden -- qa/golden-samples.example.json
```

## Production Notes

This completes the Sprint 10 production foundation. It is not custom model training or full enterprise Move.ai parity, but it gives the app a real 4-video backend solve path with measurable placement, sync, reprojection, occlusion recovery, and validation gates.
