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
  }>;
};

type ApiExportFile = {
  id: string;
  format: string;
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
  score: number;
  metrics: Record<string, number>;
  warnings: string[];
  errors: string[];
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
    const signed = await request<{ downloadUrl: string }>(
      manifest,
      `/api/exports/${encodeURIComponent(qualityFile.id)}/download-url`,
    );
    const quality = (await (await fetch(signed.downloadUrl)).json()) as QualityReport;
    const minScore = sample.minQualityScore ?? manifest.thresholds.minQualityScore;
    const checks = {
      qualityScore: quality.score >= minScore,
      jitterScore: (quality.metrics.jitterScore ?? 0) >= manifest.thresholds.minJitterScore,
      footSlidingScore:
        (quality.metrics.footSlidingScore ?? 0) >= manifest.thresholds.minFootSlidingScore,
      boneLengthConsistency:
        (quality.metrics.boneLengthConsistency ?? 0) >=
        manifest.thresholds.minBoneLengthConsistency,
      noErrors: quality.errors.length === 0,
      hasBvh: exportList.exports.some((file) => file.format === "bvh"),
      hasExpectedReconstruction:
        preparedVideos.length < 2 ||
        exportList.exports.some((file) =>
          preparedVideos.length >= 4
            ? file.format === "multi_view_reconstruction_json"
            : file.format === "dual_reconstruction_json",
        ),
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
