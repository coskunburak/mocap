import { stat } from "fs/promises";
import path from "path";
import { Client } from "pg";
import { runCommand } from "./runtime/command";

type LoadedConfig = typeof import("../config");

type WorkerConfig = LoadedConfig["config"]["worker"];
type AppConfig = LoadedConfig["config"];

export type PreflightRuntimeKind = "runpod_serverless" | "runpod_worker" | "local";

export type PreflightRuntimeSummary = {
  runtimeKind: PreflightRuntimeKind;
  cwd: string;
  nodeEnv?: string;
  runpodServerless: boolean;
  runpodEndpointConfigured: boolean;
  databaseUrlPresent: boolean;
  s3EndpointPresent: boolean;
  s3BucketPresent: boolean;
  s3AccessKeyPresent: boolean;
  s3SecretKeyPresent: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  pythonPath?: string;
  whamSolverScript?: string;
  whamRepoDirPresent: boolean;
  whamConfigPathPresent: boolean;
  whamSmplAssetDirPresent: boolean;
  enableMultiViewReconstruction: boolean;
  allowPrimaryWhamFallback: boolean;
};

export type PreflightEnvironmentValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  runtime: PreflightRuntimeSummary;
};

function log(level: "info" | "error", message: string, data?: unknown) {
  const payload = {
    level,
    message,
    service: "mocap-worker-preflight",
    at: new Date().toISOString(),
    ...(data && typeof data === "object" ? { data } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else console.log(line);
}

function splitList(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPathList(value: string | undefined) {
  if (!value) return [];
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean) {
  const raw = env[name];
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function present(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  return Boolean(value && value.length > 0);
}

function runtimeKind(env: NodeJS.ProcessEnv): PreflightRuntimeKind {
  if (boolEnv(env, "RUNPOD_SERVERLESS", false)) return "runpod_serverless";
  if (present(env, "RUNPOD_POD_ID") || present(env, "RUNPOD_ENDPOINT_ID")) {
    return "runpod_worker";
  }
  return "local";
}

export function buildPreflightRuntimeSummary(
  env: NodeJS.ProcessEnv = process.env,
): PreflightRuntimeSummary {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  return {
    runtimeKind: runtimeKind(env),
    cwd: process.cwd(),
    nodeEnv,
    runpodServerless: boolEnv(env, "RUNPOD_SERVERLESS", false),
    runpodEndpointConfigured: present(env, "RUNPOD_ENDPOINT_ID"),
    databaseUrlPresent: present(env, "DATABASE_URL"),
    s3EndpointPresent: present(env, "S3_ENDPOINT"),
    s3BucketPresent: present(env, "S3_BUCKET"),
    s3AccessKeyPresent: present(env, "S3_ACCESS_KEY_ID"),
    s3SecretKeyPresent: present(env, "S3_SECRET_ACCESS_KEY"),
    ffmpegPath: env.FFMPEG_PATH?.trim() || "ffmpeg",
    ffprobePath: env.FFPROBE_PATH?.trim() || "ffprobe",
    pythonPath: env.PYTHON_PATH?.trim() || undefined,
    whamSolverScript: env.WHAM_SOLVER_SCRIPT?.trim() || undefined,
    whamRepoDirPresent: present(env, "WHAM_REPO_DIR"),
    whamConfigPathPresent: present(env, "WHAM_CONFIG_PATH"),
    whamSmplAssetDirPresent: present(env, "WHAM_SMPL_ASSET_DIR"),
    enableMultiViewReconstruction: boolEnv(
      env,
      "ENABLE_MULTI_VIEW_RECONSTRUCTION",
      false,
    ),
    allowPrimaryWhamFallback: boolEnv(env, "ALLOW_PRIMARY_WHAM_FALLBACK", true),
  };
}

export function validatePreflightEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): PreflightEnvironmentValidation {
  const runtime = buildPreflightRuntimeSummary(env);
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeEnv = runtime.nodeEnv ?? "development";

  for (const name of [
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ]) {
    if (!present(env, name)) errors.push(`${name} is required`);
  }

  if (nodeEnv === "production") {
    if (present(env, "WHAM_PRECOMPUTED_OUTPUT_PKL")) {
      errors.push("WHAM_PRECOMPUTED_OUTPUT_PKL must not be set in production");
    }
    if (!present(env, "WHAM_SOLVER_SCRIPT")) {
      errors.push("WHAM_SOLVER_SCRIPT is required in production");
    }
    if (!present(env, "WHAM_REPO_DIR")) {
      errors.push("WHAM_REPO_DIR is required in production");
    }
    if (!present(env, "PYTHON_PATH")) {
      errors.push("PYTHON_PATH is required in production");
    }
  }

  if (!runtime.enableMultiViewReconstruction) {
    warnings.push(
      "ENABLE_MULTI_VIEW_RECONSTRUCTION is false; dual/pro jobs will use primary WHAM fallback.",
    );
  }
  if (!runtime.allowPrimaryWhamFallback) {
    warnings.push(
      "ALLOW_PRIMARY_WHAM_FALLBACK is false; QA dual/pro jobs can fail instead of falling back.",
    );
  }
  if (runtime.runtimeKind !== "local" && !runtime.enableMultiViewReconstruction) {
    warnings.push(
      "RunPod worker runtime has multi-view reconstruction disabled; local backend flags are not enough.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    runtime,
  };
}

function resolveFromCwd(filePath: string) {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function resolveWhamPath(repoDir: string, filePath: string) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoDir, filePath);
}

async function assertExists(label: string, filePath: string, kind: "file" | "dir") {
  try {
    const item = await stat(filePath);
    if (kind === "file" && !item.isFile()) {
      throw new Error(`${label} must be a file: ${filePath}`);
    }
    if (kind === "dir" && !item.isDirectory()) {
      throw new Error(`${label} must be a directory: ${filePath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes(" must be ")) {
      throw error;
    }
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

async function commandVersion(label: string, command: string, args: string[]) {
  await runCommand(command, args, { timeoutMs: 15_000 }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not executable: ${message}`);
  });
}

function whamChildEnv(worker: WorkerConfig) {
  if (!worker.whamLibraryPath) return undefined;
  return {
    LD_LIBRARY_PATH: [worker.whamLibraryPath, process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":"),
  };
}

function pythonProbe(modules: string[], requireCuda: boolean) {
  return `
import importlib
import json
import sys

modules = ${JSON.stringify(modules)}
missing = []
versions = {}
for name in modules:
    try:
        mod = importlib.import_module(name)
        versions[name] = getattr(mod, "__version__", "installed")
    except Exception as exc:
        missing.append({"module": name, "error": repr(exc)})

torch_info = {}
try:
    import torch
    torch_info = {
        "version": getattr(torch, "__version__", None),
        "cuda": bool(torch.cuda.is_available()),
        "cudaVersion": getattr(torch.version, "cuda", None),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }
except Exception as exc:
    missing.append({"module": "torch", "error": repr(exc)})

print(json.dumps({"modules": versions, "torch": torch_info}, sort_keys=True))

if missing:
    print(json.dumps({"missing": missing}, sort_keys=True), file=sys.stderr)
    raise SystemExit(2)
if ${requireCuda ? "True" : "False"} and not torch_info.get("cuda"):
    print("CUDA is required but torch.cuda.is_available() is false", file=sys.stderr)
    raise SystemExit(3)
`;
}

async function loadConfig() {
  try {
    return await import("../config");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Configuration failed before preflight checks: ${message}`);
  }
}

async function checkDatabaseConnection(config: AppConfig) {
  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runWhamDeploymentPreflight() {
  const environment = validatePreflightEnvironment();
  log("info", "WHAM production preflight starting.", {
    runtime: environment.runtime,
    warnings: environment.warnings,
  });
  if (!environment.ok) {
    throw new Error(
      `Environment validation failed before config import: ${environment.errors.join("; ")}`,
    );
  }

  const { assertWorkerRuntimeConfig, config } = await loadConfig();
  assertWorkerRuntimeConfig();

  const worker = config.worker;
  if (!worker.whamSolverScript || !worker.whamRepoDir) {
    throw new Error("WHAM_SOLVER_SCRIPT and WHAM_REPO_DIR must be configured.");
  }

  const repoDir = worker.whamRepoDir;
  const solverScript = resolveFromCwd(worker.whamSolverScript);
  await assertExists("WHAM_REPO_DIR", repoDir, "dir");
  await assertExists("WHAM demo.py", path.join(repoDir, "demo.py"), "file");
  await assertExists("WHAM solver adapter", solverScript, "file");
  if (worker.whamConfigPath) {
    await assertExists(
      "WHAM_CONFIG_PATH",
      resolveWhamPath(repoDir, worker.whamConfigPath),
      "file",
    );
  }
  if (worker.whamSmplAssetDir) {
    await assertExists(
      "WHAM_SMPL_ASSET_DIR",
      resolveWhamPath(repoDir, worker.whamSmplAssetDir),
      "dir",
    );
  }

  const requiredAssetPaths = splitList(worker.whamPreflightRequiredPaths, [
    "checkpoints/wham_vit_bedlam_w_3dpw.pth.tar",
    "checkpoints/hmr2a.ckpt",
  ]);
  for (const assetPath of requiredAssetPaths) {
    await assertExists(
      `WHAM asset ${assetPath}`,
      resolveWhamPath(repoDir, assetPath),
      "file",
    );
  }

  for (const libraryDir of splitPathList(worker.whamLibraryPath)) {
    await assertExists("WHAM_LD_LIBRARY_PATH entry", libraryDir, "dir");
  }

  await commandVersion("ffmpeg", worker.ffmpegPath, ["-version"]);
  await commandVersion("ffprobe", worker.ffprobePath, ["-version"]);
  await checkDatabaseConnection(config).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DATABASE_URL connection check failed: ${message}`);
  });
  await commandVersion("WHAM Python", worker.pythonPath, ["--version"]);
  await runCommand(worker.pythonPath, ["-m", "py_compile", solverScript], {
    timeoutMs: 30_000,
    env: whamChildEnv(worker),
  });

  const requiredModules = Array.from(new Set([
    ...splitList(worker.whamPreflightRequiredModules, [
    "torch",
    "cv2",
    "joblib",
    "smplx",
    "mmcv",
    "mmpose",
    "loguru",
    ]),
    ...(worker.whamRenderOverlayPreview ? ["pytorch3d"] : []),
  ]));
  const probe = await runCommand(
    worker.pythonPath,
    ["-c", pythonProbe(requiredModules, worker.whamRequireCuda)],
    {
      cwd: repoDir,
      timeoutMs: 60_000,
      env: whamChildEnv(worker),
    },
  );
  log("info", "WHAM production preflight passed.", {
    runtime: environment.runtime,
    whamRepoDir: repoDir,
    whamSolverScript: solverScript,
    whamConfigPath: worker.whamConfigPath,
    whamRequireCuda: worker.whamRequireCuda,
    enableMultiViewReconstruction: worker.enableMultiViewReconstruction,
    allowPrimaryWhamFallback: worker.allowPrimaryWhamFallback,
    python: worker.pythonPath,
    probe: JSON.parse(probe.stdout.trim()),
  });
}

if (require.main === module) {
  void runWhamDeploymentPreflight().catch((error) => {
    log("error", "WHAM production preflight failed.", {
      error: error instanceof Error ? error.message : String(error),
      runtime: buildPreflightRuntimeSummary(),
      warnings: validatePreflightEnvironment().warnings,
    });
    process.exit(1);
  });
}
