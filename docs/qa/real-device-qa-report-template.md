# MocapExpo Real-Device QA Report

Date:
Tester:
App build:
Backend commit:
Worker image/tag:
RunPod endpoint:

Feature flags:

- ENABLE_MULTI_VIEW_RECONSTRUCTION:
- ALLOW_PRIMARY_WHAM_FALLBACK:
- Worker runtime:
- Preflight passed:
- Preflight multi-view flag:

## Device Matrix

| Device | OS | App Build | Role | Device Index | Camera Position | Notes |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Test Runs

### Run 1 — iOS Single Camera

- Capture mode:
- Expected branch:
- Job ID:
- Take ID:
- Upload status:
- Processing status:
- Artifacts:
- quality_report schema:
- quality_report score:
- multiView section present:
- Result screen status:
- Pass/Fail:
- Notes:

### Run 2 — Android Single Camera

- Capture mode:
- Expected branch:
- Job ID:
- Take ID:
- Upload status:
- Processing status:
- Artifacts:
- quality_report schema:
- quality_report score:
- multiView section present:
- Result screen status:
- Pass/Fail:
- Notes:

### Run 3 — Dual Camera

- Devices:
- Take ID:
- Job ID:
- expectedVideoCount:
- selectedVideoCount:
- branch:
- reconstructionBranchEntered:
- poseExtractionStatus:
- syncStatus:
- calibrationStatus:
- triangulationStatus:
- fittingStatus:
- reconstructionAvailable:
- reconstructionUsedForConstraints:
- finalAnimationSource:
- primaryWhamFallbackUsed:
- primaryWhamFallbackReason:
- matchedFrameCount:
- averageTimeDeltaMs:
- reprojectionErrorPx:
- reprojectionErrorP95:
- triangulatedLandmarkRatio:
- reliableConstraintRatio:
- calibrationQualityScore:
- gateFailures:
- Artifacts:
- Result screen diagnostics:
- Pass/Fail:
- Notes:

### Run 4 — Cross-Platform Dual Camera

- Devices:
- expectedVideoCount:
- branch:
- reconstructionBranchEntered:
- timestamp units consistent:
- orientation consistent:
- fps/resolution metadata present:
- captureSessionId consistency:
- clock offset present or fallback documented:
- reconstructionAvailable:
- finalAnimationSource:
- primaryWhamFallbackUsed:
- primaryWhamFallbackReason:
- gateFailures:
- Artifacts:
- Result screen diagnostics:
- Pass/Fail:
- Notes:

### Run 5 — Pro 4-Camera Optional

- Devices:
- expectedVideoCount:
- unique roles:
- branch:
- reconstructionBranchEntered:
- reconstructionAvailable:
- finalAnimationSource:
- primaryWhamFallbackUsed:
- primaryWhamFallbackReason:
- artifactName collision:
- Artifacts:
- Result screen diagnostics:
- Pass/Fail/Skipped:
- Notes:

## Bugs Found

| Severity | Area | Description | Repro Steps | Logs/Job ID |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Final Verdict

- Single-camera regression passed:
- Dual-camera QA passed:
- Pro QA passed:
- Blockers:

## Attachments

- QA manifest path:
- Screenshots:
- Logs:
- Export artifact links:
