type ProcessLike = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
}>;

function readEnv(name: string) {
  const maybeProcess = (globalThis as { process?: ProcessLike }).process;
  return maybeProcess?.env?.[name];
}

export const captureFlags = {
  localFrameRecording:
    readEnv("EXPO_PUBLIC_MOCAP_LOCAL_FRAME_RECORDING") === "debug" ||
    readEnv("MOCAP_LOCAL_FRAME_RECORDING") === "debug",
};

