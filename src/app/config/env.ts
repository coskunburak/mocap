type ProcessLike = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
}>;

function readProcessEnv(name: string) {
  return (globalThis as { process?: ProcessLike }).process?.env?.[name];
}

function readString(name: string, fallback: string) {
  const value = readProcessEnv(name);
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(name: string, fallback: number) {
  const value = readProcessEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean) {
  const value = readProcessEnv(name);
  if (!value) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export const env = {
  apiBaseUrl: readString("EXPO_PUBLIC_MOCAP_API_BASE_URL", "http://127.0.0.1:4010"),
  devToken: readString("EXPO_PUBLIC_MOCAP_DEV_TOKEN", "dev-user-id"),
  defaultProjectId: readProcessEnv("EXPO_PUBLIC_MOCAP_DEFAULT_PROJECT_ID"),
  apiTimeoutMs: readNumber("EXPO_PUBLIC_MOCAP_API_TIMEOUT_MS", 20_000),
  uploadTimeoutMs: readNumber("EXPO_PUBLIC_MOCAP_UPLOAD_TIMEOUT_MS", 180_000),
  uploadRetryCount: readNumber("EXPO_PUBLIC_MOCAP_UPLOAD_RETRY_COUNT", 2),
  enableBackendCaptureFlow: readBoolean(
    "EXPO_PUBLIC_MOCAP_BACKEND_CAPTURE_FLOW",
    true,
  ),
  enableLocalDebugExport: readBoolean(
    "EXPO_PUBLIC_MOCAP_LOCAL_EXPORT_DEBUG",
    false,
  ),
} as const;
