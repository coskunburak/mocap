type ProcessLike = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
}>;

function readEnv(name: string) {
  const maybeProcess = (globalThis as { process?: ProcessLike }).process;
  return maybeProcess?.env?.[name];
}

function readPreviewFrameRecording() {
  const value =
    readEnv("EXPO_PUBLIC_MOCAP_LOCAL_FRAME_RECORDING") ??
    readEnv("MOCAP_LOCAL_FRAME_RECORDING");

  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

export const captureFlags = {
  localFrameRecording: readPreviewFrameRecording(),
};
