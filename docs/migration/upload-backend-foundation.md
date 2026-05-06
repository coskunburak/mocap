# Upload Backend Foundation

Sprint 2 backend is intentionally an orchestration service, not a video processor.

It must support:

1. Project creation/listing.
2. Take creation/read by owner.
3. Signed upload init for video and metadata.
4. Upload complete with required part validation.
5. Processing job creation only after upload completion.
6. Processing job status read.
7. Export list and signed download URL endpoints.

The local dev stack uses PostgreSQL and MinIO so the privacy/storage assumptions match production S3-compatible deployment.

