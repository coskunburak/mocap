import { readFile } from "fs/promises";
import path from "path";
import { config } from "../../config";
import { runCommand } from "../runtime/command";

export type BlenderSmokeResult = {
  ok: boolean;
  skipped: boolean;
  warnings: string[];
  errors: string[];
  metrics?: Record<string, number>;
};

function scriptPath() {
  return path.join(process.cwd(), "worker", "blender_smoke_test.py");
}

export async function runBlenderSmokeTest(
  bvhPath: string,
  outputPath: string,
): Promise<BlenderSmokeResult> {
  if (!config.worker.blenderPath) {
    const warning = "Blender smoke test skipped because BLENDER_PATH is not configured.";
    if (config.worker.requireBlenderSmokeTest) {
      return { ok: false, skipped: true, warnings: [], errors: [warning] };
    }
    return { ok: true, skipped: true, warnings: [warning], errors: [] };
  }

  try {
    await runCommand(config.worker.blenderPath, [
      "--background",
      "--factory-startup",
      "--python",
      scriptPath(),
      "--",
      bvhPath,
      outputPath,
    ]);
    return JSON.parse(await readFile(outputPath, "utf8")) as BlenderSmokeResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blender smoke test failed.";
    if (config.worker.requireBlenderSmokeTest) {
      return { ok: false, skipped: false, warnings: [], errors: [message] };
    }
    return { ok: true, skipped: false, warnings: [message], errors: [] };
  }
}
