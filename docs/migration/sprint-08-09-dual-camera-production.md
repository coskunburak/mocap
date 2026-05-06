# Sprint 8-9 Dual Camera Production Implementation

## Scope

Sprint 8 and Sprint 9 now move dual-camera capture from a local prototype into the backend production path:

- Backend capture sessions with join token pairing.
- Host/guest device registration with stable `deviceIndex`.
- Multi-video upload grouping under one take.
- Processing guard that blocks jobs until every expected video is uploaded.
- Per-camera pose detection for dual takes.
- Audio-waveform sync with metadata/timestamp fallback.
- Metadata-based stereo projection estimate.
- DLT triangulation with reprojection error metrics.
- Triangulated 3D artifact and dual-camera quality report integration.

## Backend API

New endpoints:

```text
POST /api/projects/:projectId/capture-sessions
GET  /api/capture-sessions/:captureSessionId
POST /api/capture-sessions/:captureSessionId/devices/register
POST /api/capture-sessions/join
```

The create endpoint creates both the backend `CaptureSession` and shared `Take`.
The response includes a `joinToken` suitable for QR or manual pairing.

## Storage And Artifacts

Dual jobs now produce:

```text
takes/{takeId}/jobs/{jobId}/normalized/device_0.mp4
takes/{takeId}/jobs/{jobId}/normalized/device_1.mp4
takes/{takeId}/jobs/{jobId}/pose_frames_device_0.json
takes/{takeId}/jobs/{jobId}/pose_frames_device_1.json
takes/{takeId}/jobs/{jobId}/pose_frames.json
takes/{takeId}/jobs/{jobId}/dual_reconstruction.json
takes/{takeId}/jobs/{jobId}/solved_motion.json
takes/{takeId}/jobs/{jobId}/result.bvh
takes/{takeId}/jobs/{jobId}/quality_report.json
```

`pose_frames.json` is the final source for skeleton solve. For dual jobs it contains triangulated world landmarks.

## Quality Metrics

`quality_report_json` now includes dual-camera metrics when available:

- `syncOffsetMs`
- `syncConfidence`
- `matchedFrameCount`
- `averageTimeDeltaMs`
- `reprojectionErrorPx`
- `reprojectionP95Px`
- `triangulatedLandmarkRatio`
- `fallbackLandmarkRatio`
- `dualQualityGain`
- `calibrationQualityScore`

## QA

The golden E2E harness supports single-camera and dual-camera samples. Dual samples use a `videos` array and assert that `dual_reconstruction_json` is produced.

```bash
npm --prefix backend run qa:golden -- qa/golden-samples.example.json
```

## Production Notes

This is a real dual-video reconstruction path, but not full Move.ai parity. Move.ai-level robustness still depends on a calibrated multi-view dataset, stronger camera calibration, occlusion recovery, and the later pro 4-camera sprint. The implemented Sprint 8/9 path is production-ready for dual-video grouping, sync reporting, triangulated artifact generation, validation, and measurable quality uplift when calibration/input quality is sufficient.
