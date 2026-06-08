import assert from "node:assert/strict";
import {
  buildPreflightRuntimeSummary,
  validatePreflightEnvironment,
} from "./whamDeploymentPreflight";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@example.invalid:5432/postgres",
    S3_ENDPOINT: "https://example.supabase.co/storage/v1/s3",
    S3_REGION: "eu-west-1",
    S3_BUCKET: "mocapexpo-production",
    S3_ACCESS_KEY_ID: "present",
    S3_SECRET_ACCESS_KEY: "present",
    WHAM_SOLVER_SCRIPT: "worker/model_adapters/wham_solver.py",
    WHAM_REPO_DIR: "/workspace/WHAM",
    PYTHON_PATH: "/opt/conda/bin/python",
    FFMPEG_PATH: "ffmpeg",
    FFPROBE_PATH: "ffprobe",
    ENABLE_MULTI_VIEW_RECONSTRUCTION: "true",
    ALLOW_PRIMARY_WHAM_FALLBACK: "true",
    ...overrides,
  };
}

function testMissingDatabaseUrlFailsClearly() {
  const env = baseEnv({ DATABASE_URL: "" });
  const result = validatePreflightEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("DATABASE_URL is required"));
  assert.equal(result.runtime.databaseUrlPresent, false);
}

function testMissingS3ConfigFailsClearly() {
  const env = baseEnv({
    S3_ENDPOINT: "",
    S3_BUCKET: "",
    S3_ACCESS_KEY_ID: "",
    S3_SECRET_ACCESS_KEY: "",
  });
  const result = validatePreflightEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("S3_ENDPOINT is required"));
  assert.ok(result.errors.includes("S3_BUCKET is required"));
  assert.ok(result.errors.includes("S3_ACCESS_KEY_ID is required"));
  assert.ok(result.errors.includes("S3_SECRET_ACCESS_KEY is required"));
}

function testMultiViewAndFallbackFlagsAreReported() {
  const env = baseEnv({
    ENABLE_MULTI_VIEW_RECONSTRUCTION: "false",
    ALLOW_PRIMARY_WHAM_FALLBACK: "false",
  });
  const result = validatePreflightEnvironment(env);
  assert.equal(result.ok, true);
  assert.equal(result.runtime.enableMultiViewReconstruction, false);
  assert.equal(result.runtime.allowPrimaryWhamFallback, false);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("ENABLE_MULTI_VIEW_RECONSTRUCTION is false"),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("ALLOW_PRIMARY_WHAM_FALLBACK is false"),
    ),
  );
}

function testRunpodRuntimeWarnsWhenMultiViewDisabled() {
  const env = baseEnv({
    RUNPOD_SERVERLESS: "true",
    ENABLE_MULTI_VIEW_RECONSTRUCTION: "false",
  });
  const summary = buildPreflightRuntimeSummary(env);
  const result = validatePreflightEnvironment(env);
  assert.equal(summary.runtimeKind, "runpod_serverless");
  assert.equal(summary.runpodServerless, true);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("local backend flags are not enough"),
    ),
  );
}

function testProductionWhamConfigRequired() {
  const env = baseEnv({
    WHAM_SOLVER_SCRIPT: "",
    WHAM_REPO_DIR: "",
    PYTHON_PATH: "",
  });
  const result = validatePreflightEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("WHAM_SOLVER_SCRIPT is required in production"));
  assert.ok(result.errors.includes("WHAM_REPO_DIR is required in production"));
  assert.ok(result.errors.includes("PYTHON_PATH is required in production"));
}

testMissingDatabaseUrlFailsClearly();
testMissingS3ConfigFailsClearly();
testMultiViewAndFallbackFlagsAreReported();
testRunpodRuntimeWarnsWhenMultiViewDisabled();
testProductionWhamConfigRequired();
console.log("worker preflight tests passed");
