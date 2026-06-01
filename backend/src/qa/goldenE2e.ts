import { readFile, stat, writeFile } from "fs/promises";
import path from "path";

type GoldenManifest = {
  apiBaseUrl: string;
  token: string;
  projectName?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  thresholds: {
    minQualityScore: number;
    minJitterScore: number;
    minFootSlidingScore: number;
    minBoneLengthConsistency: number;
  };
  samples: Array<{
    name: string;
    source?: "single_camera" | "dual_camera" | "multi_view" | "pro_4_camera";
    videoPath?: string;
    metadataPath?: string;
    videos?: Array<{
      videoPath: string;
      metadataPath: string;
      deviceIndex?: number;
      deviceRole?: string;
    }>;
    captureMode?: "solo" | "dual" | "pro_4_camera";
    expectedVideoCount?: number;
    preset?: string;
    minQualityScore?: number;
    expectedArtifacts?: string[];
    multiViewExpectations?: {
      reconstructionAvailable?: boolean;
      reconstructionUsedForConstraints?: boolean;
      primaryWhamFallbackUsed?: boolean;
      primaryCameraFallbackUsed?: boolean;
      primaryWhamFallbackReason?: string;
      finalAnimationSource?:
        | "primary_wham"
        | "dual_triangulation_diagnostic"
        | "dual_triangulation_constraint"
        | "true_dual_solve"
        | "unavailable";
      forbiddenFinalAnimationSources?: string[];
      reconstructionStatus?: string;
      minMatchedFrameCount?: number;
      minTriangulatedLandmarkRatio?: number;
      maxReprojectionErrorPx?: number;
      minCalibrationQualityScore?: number;
      requireArtifactNameUnique?: boolean;
      requiredMotionPipelineStages?: string[];
    };
  }>;
};

type ApiExportFile = {
  id: string;
  format: string;
  artifactName?: string;
  fileSizeBytes: number | null;
};

type ApiJob = {
  id: string;
  takeId: string;
  state: string;
  progress: number;
  message?: string | null;
  errorCode?: string | null;
};

type QualityReport = {
  schema: "mocap.quality_report.v1";
  score: number;
  metrics: Record<string, number>;
  warnings: string[];
  errors: string[];
  multiView?: {
    reconstructionAvailable: boolean;
    reconstructionUsedForConstraints: boolean;
    primaryWhamFallbackUsed: boolean;
    primaryCameraFallbackUsed?: boolean;
    finalAnimationSource?: string;
    reconstructionStatus?: string;
    primaryWhamFallbackReason?: string;
    metrics?: {
      matchedFrameCount?: number;
      reprojectionErrorPx?: number;
      triangulatedLandmarkRatio?: number;
      calibrationQualityScore?: number;
    };
  };
};

type PreparedSampleVideo = {
  videoPath: string;
  metadataPath: string;
  videoInfo: Awaited<ReturnType<typeof stat>>;
  metadataRaw: string;
  videoBytes: Buffer;
  metadata: Record<string, unknown>;
  deviceIndex: number;
  deviceRole: string;
};

type MotionPipelineReport = {
  schema: "mocap.motion_pipeline_report.v1";
  fallback?: {
    motionFallbackUsed?: boolean;
    reasons?: string[];
  };
  stages?: Array<{
    stageName: string;
    status: string;
    artifactRefs?: Record<string, string>;
    warnings?: string[];
  }>;
  whamInputUsage?: {
    primaryVideoUsed?: boolean;
    additionalVideosProvided?: number;
    multiViewConstraintsUsed?: boolean;
  };
};

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error("Usage: npm --prefix backend run qa:golden -- qa/golden-samples.example.json");
}

const manifestDir = path.dirname(path.resolve(manifestPath));

function resolveSamplePath(value: string) {
  return path.isAbsolute(value) ? value : path.join(manifestDir, value);
}

async function request<T>(
  manifest: GoldenManifest,
  apiPath: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${manifest.apiBaseUrl}${apiPath}`, {
    method: options?.method ?? "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${manifest.token}`,
      ...(options?.body ? { "content-type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `${options?.method ?? "GET"} ${apiPath} failed: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload as T;
}

function videoContentType(filePath: string): "video/mp4" | "video/quicktime" {
  return filePath.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
}

async function waitForJob(manifest: GoldenManifest, jobId: string): Promise<ApiJob> {
  const deadline = Date.now() + (manifest.timeoutMs ?? 20 * 60_000);
  while (Date.now() < deadline) {
    const { job } = await request<{ job: ApiJob }>(
      manifest,
      `/api/jobs/${encodeURIComponent(jobId)}`,
    );
    if (job.state === "succeeded" || job.state === "failed" || job.state === "canceled") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, manifest.pollIntervalMs ?? 2500));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function putSigned(url: string, headers: Record<string, string>, body: Buffer | string) {
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(`Signed upload failed: ${response.status}`);
  }
}

async function prepareSampleVideo(
  manifestDir: string,
  input: {
    videoPath: string;
    metadataPath: string;
    deviceIndex?: number;
    deviceRole?: string;
  },
): Promise<PreparedSampleVideo> {
  const videoPath = path.isAbsolute(input.videoPath)
    ? input.videoPath
    : path.join(manifestDir, input.videoPath);
  const metadataPath = path.isAbsolute(input.metadataPath)
    ? input.metadataPath
    : path.join(manifestDir, input.metadataPath);
  const [videoInfo, metadataRaw, videoBytes] = await Promise.all([
    stat(videoPath),
    readFile(metadataPath, "utf8"),
    readFile(videoPath),
  ]);
  const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
  return {
    videoPath,
    metadataPath,
    videoInfo,
    metadataRaw,
    videoBytes,
    metadata,
    deviceIndex:
      input.deviceIndex ??
      (typeof metadata.deviceIndex === "number" ? metadata.deviceIndex : 0),
    deviceRole:
      input.deviceRole ??
      (typeof metadata.deviceRole === "string" ? metadata.deviceRole : "primary"),
  };
}

function exportMatches(file: ApiExportFile, expected: string) {
  return file.format === expected || file.artifactName === expected;
}

function hasUniqueArtifactNames(exports: ApiExportFile[]) {
  const identities = exports.map((file) => file.artifactName ?? file.format);
  return new Set(identities).size === identities.length;
}

function resolveSampleSource(input: {
  source?: "single_camera" | "dual_camera" | "multi_view" | "pro_4_camera";
  captureMode: string;
}) {
  if (input.source) return input.source;
  if (input.captureMode === "dual") return "dual_camera";
  if (input.captureMode === "pro_4_camera") return "multi_view";
  return "single_camera";
}

function buildExpectedArtifactChecks(
  expectedArtifacts: string[] | undefined,
  exports: ApiExportFile[],
) {
  const checks: Record<string, boolean> = {};
  for (const expected of expectedArtifacts ?? []) {
    checks[`artifact:${expected}`] = exports.some((file) =>
      exportMatches(file, expected),
    );
  }
  return checks;
}

function buildMultiViewExpectationChecks(input: {
  expectations: NonNullable<GoldenManifest["samples"][number]["multiViewExpectations"]>;
  quality: QualityReport;
  exports: ApiExportFile[];
  motionPipeline?: MotionPipelineReport;
}) {
  const checks: Record<string, boolean> = {};
  const section = input.quality.multiView;
  checks.multiViewSectionPresent = Boolean(section);
  if (!section) {
    return checks;
  }
  if (input.expectations.reconstructionAvailable != null) {
    checks.multiViewReconstructionAvailable =
      section.reconstructionAvailable === input.expectations.reconstructionAvailable;
  }
  if (input.expectations.reconstructionUsedForConstraints != null) {
    checks.multiViewConstraints =
      section.reconstructionUsedForConstraints ===
      input.expectations.reconstructionUsedForConstraints;
  }
  if (input.expectations.primaryWhamFallbackUsed != null) {
    checks.primaryWhamFallbackUsed =
      section.primaryWhamFallbackUsed === input.expectations.primaryWhamFallbackUsed;
  }
  if (input.expectations.primaryCameraFallbackUsed != null) {
    checks.primaryCameraFallbackUsed =
      section.primaryCameraFallbackUsed === input.expectations.primaryCameraFallbackUsed;
  }
  if (input.expectations.primaryWhamFallbackReason) {
    checks.primaryWhamFallbackReason =
      section.primaryWhamFallbackReason === input.expectations.primaryWhamFallbackReason;
  }
  if (input.expectations.finalAnimationSource) {
    checks.finalAnimationSource =
      section.finalAnimationSource === input.expectations.finalAnimationSource;
  }
  if (input.expectations.forbiddenFinalAnimationSources?.length) {
    checks.noForbiddenFinalAnimationSource =
      !section.finalAnimationSource ||
      !input.expectations.forbiddenFinalAnimationSources.includes(
        section.finalAnimationSource,
      );
  }
  if (input.expectations.reconstructionStatus) {
    checks.reconstructionStatus =
      section.reconstructionStatus === input.expectations.reconstructionStatus;
  }
  if (input.expectations.minMatchedFrameCount != null) {
    checks.minMatchedFrameCount =
      (section.metrics?.matchedFrameCount ?? 0) >=
      input.expectations.minMatchedFrameCount;
  }
  if (input.expectations.minTriangulatedLandmarkRatio != null) {
    checks.minTriangulatedLandmarkRatio =
      (section.metrics?.triangulatedLandmarkRatio ?? 0) >=
      input.expectations.minTriangulatedLandmarkRatio;
  }
  if (input.expectations.maxReprojectionErrorPx != null) {
    checks.maxReprojectionErrorPx =
      (section.metrics?.reprojectionErrorPx ?? Infinity) <=
      input.expectations.maxReprojectionErrorPx;
  }
  if (input.expectations.minCalibrationQualityScore != null) {
    checks.minCalibrationQualityScore =
      (section.metrics?.calibrationQualityScore ?? -Infinity) >=
      input.expectations.minCalibrationQualityScore;
  }
  if (input.expectations.requireArtifactNameUnique) {
    checks.artifactNameUnique = hasUniqueArtifactNames(input.exports);
  }
  if (input.expectations.requiredMotionPipelineStages?.length) {
    const stageNames = new Set(
      input.motionPipeline?.stages?.map((stage) => stage.stageName) ?? [],
    );
    checks.requiredMotionPipelineStages =
      input.expectations.requiredMotionPipelineStages.every((stageName) =>
        stageNames.has(stageName),
      );
  }
  if (
    input.expectations.primaryWhamFallbackUsed != null &&
    input.motionPipeline
  ) {
    checks.motionPipelineFallbackUsed =
      input.motionPipeline.fallback?.motionFallbackUsed ===
      input.expectations.primaryWhamFallbackUsed;
  }
  if (input.motionPipeline) {
    checks.motionPipelineDoesNotUseMultiViewConstraints =
      input.motionPipeline.whamInputUsage?.multiViewConstraintsUsed === false;
  }
  return checks;
}

async function fetchExportJson<T>(
  manifest: GoldenManifest,
  file: ApiExportFile,
): Promise<T> {
  const signed = await request<{ downloadUrl: string }>(
    manifest,
    `/api/exports/${encodeURIComponent(file.id)}/download-url`,
  );
  return (await (await fetch(signed.downloadUrl)).json()) as T;
}

async function run() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as GoldenManifest;
  const project = await request<{ project: { id: string } }>(manifest, "/api/projects", {
    method: "POST",
    body: { name: manifest.projectName ?? `Golden QA ${new Date().toISOString()}` },
  });
  const results = [];

  for (const sample of manifest.samples) {
    const sampleInputs =
      sample.videos ??
      (sample.videoPath && sample.metadataPath
        ? [{ videoPath: sample.videoPath, metadataPath: sample.metadataPath }]
        : []);
    if (sampleInputs.length === 0) {
      throw new Error(`Sample ${sample.name} has no video inputs`);
    }
    const preparedVideos = await Promise.all(
      sampleInputs.map((video) => prepareSampleVideo(manifestDir, video)),
    );
    const firstMetadata = preparedVideos[0].metadata;
    const captureMode =
      sample.captureMode ??
      (typeof firstMetadata.captureMode === "string"
        ? firstMetadata.captureMode
        : preparedVideos.length > 1
          ? "dual"
          : "solo");
    const expectedVideoCount = sample.expectedVideoCount ?? preparedVideos.length;
    const sampleSource = resolveSampleSource({
      source: sample.source,
      captureMode,
    });

    const take = await request<{ take: { id: string } }>(
      manifest,
      `/api/projects/${encodeURIComponent(project.project.id)}/takes`,
      {
        method: "POST",
        body: {
          name: sample.name,
          captureMode,
          expectedVideoCount,
        },
      },
    );

    for (const prepared of preparedVideos) {
      const metadata = {
        ...prepared.metadata,
        takeId: take.take.id,
        captureSessionId:
          typeof prepared.metadata.captureSessionId === "string"
            ? prepared.metadata.captureSessionId
            : take.take.id,
        deviceIndex: prepared.deviceIndex,
        deviceRole: prepared.deviceRole,
        captureMode,
      };
      const metadataRaw = JSON.stringify(metadata);
      const init = await request<{
        uploadSession: { id: string };
        video: { uploadUrl: string; headers: Record<string, string> };
        metadata: { uploadUrl: string; headers: Record<string, string> };
      }>(manifest, `/api/takes/${encodeURIComponent(take.take.id)}/uploads/init`, {
        method: "POST",
        body: {
          deviceIndex: prepared.deviceIndex,
          deviceRole: prepared.deviceRole,
          video: {
            contentType: videoContentType(prepared.videoPath),
            fileName: path.basename(prepared.videoPath),
            fileSizeBytes: prepared.videoInfo.size,
          },
          metadata: {
            contentType: "application/json",
            fileName: path.basename(prepared.metadataPath),
            fileSizeBytes: Buffer.byteLength(metadataRaw, "utf8"),
          },
        },
      });

      await putSigned(init.metadata.uploadUrl, init.metadata.headers, metadataRaw);
      await putSigned(init.video.uploadUrl, init.video.headers, prepared.videoBytes);
      await request(manifest, `/api/takes/${encodeURIComponent(take.take.id)}/uploads/complete`, {
        method: "POST",
        body: {
          uploadSessionId: init.uploadSession.id,
          videoUploaded: true,
          metadataUploaded: true,
          videoSizeBytes: prepared.videoInfo.size,
          metadataSizeBytes: Buffer.byteLength(metadataRaw, "utf8"),
          captureMetadata: metadata,
        },
      });
    }

    const created = await request<{ job: ApiJob }>(
      manifest,
      `/api/takes/${encodeURIComponent(take.take.id)}/process`,
      {
        method: "POST",
        body: { preset: sample.preset ?? "humanoid_bvh_quality_v1_5" },
      },
    );
    const job = await waitForJob(manifest, created.job.id);
    if (job.state !== "succeeded") {
      results.push({
        sample: sample.name,
        ok: false,
        job,
        reason: job.message ?? job.errorCode ?? "job_failed",
      });
      continue;
    }

    const exportList = await request<{ exports: ApiExportFile[] }>(
      manifest,
      `/api/takes/${encodeURIComponent(take.take.id)}/exports`,
    );
    const qualityFile = exportList.exports.find((file) => file.format === "quality_report_json");
    if (!qualityFile) {
      results.push({ sample: sample.name, ok: false, reason: "quality_report_missing" });
      continue;
    }
    const motionPipelineFile = exportList.exports.find(
      (file) => file.format === "motion_pipeline_report_json",
    );
    const quality = await fetchExportJson<QualityReport>(manifest, qualityFile);
    const motionPipeline = motionPipelineFile
      ? await fetchExportJson<MotionPipelineReport>(manifest, motionPipelineFile)
      : undefined;
    const minScore = sample.minQualityScore ?? manifest.thresholds.minQualityScore;
    const checks = {
      qualityReportSchema: quality.schema === "mocap.quality_report.v1",
      qualityScore: quality.score >= minScore,
      jitterScore: (quality.metrics.jitterScore ?? 0) >= manifest.thresholds.minJitterScore,
      footSlidingScore:
        (quality.metrics.footSlidingScore ?? 0) >= manifest.thresholds.minFootSlidingScore,
      boneLengthConsistency:
        (quality.metrics.boneLengthConsistency ?? 0) >=
        manifest.thresholds.minBoneLengthConsistency,
      noErrors: quality.errors.length === 0,
      hasBvh: exportList.exports.some((file) => file.format === "bvh"),
      hasMotionPipelineReport: exportList.exports.some(
        (file) => file.format === "motion_pipeline_report_json",
      ),
      hasSmplParameters: exportList.exports.some(
        (file) => file.format === "smpl_parameters_json",
      ),
      singleCameraMultiViewAbsent:
        sampleSource === "single_camera" ? quality.multiView == null : true,
      ...buildExpectedArtifactChecks(sample.expectedArtifacts, exportList.exports),
      ...(sample.multiViewExpectations
        ? buildMultiViewExpectationChecks({
            expectations: sample.multiViewExpectations,
            quality,
            exports: exportList.exports,
            motionPipeline,
          })
        : {}),
    };
    results.push({
      sample: sample.name,
      ok: Object.values(checks).every(Boolean),
      takeId: take.take.id,
      jobId: job.id,
      score: quality.score,
      checks,
      warnings: quality.warnings,
      exports: exportList.exports.map((file) => ({
        format: file.format,
        artifactName: file.artifactName,
        size: file.fileSizeBytes,
      })),
    });
  }

  const report = {
    schema: "mocap.golden_e2e_report.v1",
    generatedAt: new Date().toISOString(),
    sampleCount: results.length,
    passCount: results.filter((result) => result.ok).length,
    results,
  };
  const outPath = path.join(manifestDir, "golden-report.json");
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.passCount !== report.sampleCount) {
    process.exitCode = 1;
  }
}

void run();
