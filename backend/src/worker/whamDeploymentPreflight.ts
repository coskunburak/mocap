import { stat } from "fs/promises";
import path from "path";
import { runCommand } from "./runtime/command";

type LoadedConfig = typeof import("../config");

type WorkerConfig = LoadedConfig["config"]["worker"];

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

async function main() {
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
    whamRepoDir: repoDir,
    whamSolverScript: solverScript,
    whamConfigPath: worker.whamConfigPath,
    whamRequireCuda: worker.whamRequireCuda,
    python: worker.pythonPath,
    probe: JSON.parse(probe.stdout.trim()),
  });
}

void main().catch((error) => {
  log("error", "WHAM production preflight failed.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
