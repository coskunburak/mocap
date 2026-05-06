# New Plan Dokuman Haritasi

Bu klasor, backend-core production MoCap donusum planinin calisma dokumanlarini icerir.

Ana plan aynen korunur:

- [new_plan.md](./new_plan.md)

Sprint bazli uygulama planlari:

- [Sprint 0 - Architecture Freeze ve Audit](./sprints/sprint-00-architecture-freeze-audit.md)
- [Sprint 1 - Native Video Recording Foundation](./sprints/sprint-01-native-video-recording-foundation.md)
- [Sprint 2 - Backend API ve Upload Temeli](./sprints/sprint-02-backend-api-upload-foundation.md)
- [Sprint 3 - Mobile Upload ve Processing Status UX](./sprints/sprint-03-mobile-upload-processing-status.md)
- [Sprint 4 - Worker V1 Pose Extraction](./sprints/sprint-04-worker-v1-pose-extraction.md)
- [Sprint 5 - Backend Export V1](./sprints/sprint-05-backend-export-v1.md)
- [Sprint 6 - Cleanup ve Quality V1.5](./sprints/sprint-06-cleanup-quality-v15.md)
- [Sprint 7 - Result Preview ve Export UX](./sprints/sprint-07-result-preview-export-ux.md)
- [Sprint 8 - Dual-Camera Backend Session](./sprints/sprint-08-dual-camera-backend-session.md)
- [Sprint 9 - Dual-Camera Reconstruction V1](./sprints/sprint-09-dual-camera-reconstruction-v1.md)
- [Sprint 10 - Pro 4-Camera Mode](./sprints/sprint-10-pro-4-camera-mode.md)

Detayli is paketleri:

- [WP01 - Current Codebase Audit](./work_packages/wp-01-current-codebase-audit.md)
- [WP02 - Architecture ve API Contract Freeze](./work_packages/wp-02-architecture-api-contract-freeze.md)
- [WP03 - CameraEngine ve Native Video Recorder](./work_packages/wp-03-camera-engine-native-video-recorder.md)
- [WP04 - PosePreview Quality Mode](./work_packages/wp-04-pose-preview-quality-mode.md)
- [WP05 - Capture Metadata Schema](./work_packages/wp-05-capture-metadata-schema.md)
- [WP06 - Backend Domain Model ve API Foundation](./work_packages/wp-06-backend-domain-api-foundation.md)
- [WP07 - Signed Upload ve Object Storage](./work_packages/wp-07-signed-upload-object-storage.md)
- [WP08 - Mobile ApiClient ve Environment Config](./work_packages/wp-08-mobile-api-client-env-config.md)
- [WP09 - UploadManager](./work_packages/wp-09-upload-manager.md)
- [WP10 - Processing Status UX](./work_packages/wp-10-processing-status-ux.md)
- [WP11 - Worker Queue ve Job Consumer](./work_packages/wp-11-worker-queue-job-consumer.md)
- [WP12 - Video Normalization ve Frame Extraction](./work_packages/wp-12-video-normalization-frame-extraction.md)
- [WP13 - MediaPipe Pose Extraction](./work_packages/wp-13-mediapipe-pose-extraction.md)
- [WP14 - Backend Export Core V1](./work_packages/wp-14-backend-export-core-v1.md)
- [WP15 - SkeletonDefinition ve Rotation Solve](./work_packages/wp-15-skeleton-definition-rotation-solve.md)
- [WP16 - Cleanup, Foot Locking ve Quality Report](./work_packages/wp-16-cleanup-foot-locking-quality-report.md)
- [WP17 - Export Validation ve Blender Smoke Test](./work_packages/wp-17-export-validation-blender-smoke-test.md)
- [WP18 - Result Preview ve Export Result UX](./work_packages/wp-18-result-preview-export-result-ux.md)
- [WP19 - Security, Privacy ve Retention](./work_packages/wp-19-security-privacy-retention.md)
- [WP20 - Cost, Operations ve Observability](./work_packages/wp-20-cost-operations-observability.md)
- [WP21 - QA Golden Dataset ve E2E Validation](./work_packages/wp-21-qa-golden-dataset-e2e-validation.md)
- [WP22 - Dual-Camera Session ve Multi-Video Upload](./work_packages/wp-22-dual-camera-session-multi-video-upload.md)
- [WP23 - Dual-Camera Reconstruction](./work_packages/wp-23-dual-camera-reconstruction.md)
- [WP24 - Pro 4-Camera Mode](./work_packages/wp-24-pro-4-camera-mode.md)

Okuma sirasi:

1. Once [new_plan.md](./new_plan.md) ile ana strateji okunur.
2. Sonra ilgili sprint dosyasi acilir.
3. Sprint dosyasindaki work package linkleri uzerinden implementasyon detayina inilir.
4. Her sprint bitisinde kabul kriterleri ve QA maddeleri kapatilir.

