import type { IPoseEngine, PoseEngineOptions } from "./IPoseEngine";

export const PoseEngineMock: IPoseEngine = {
  async ping() { return { ok: true, version: "mock-1.0" }; },
  async setPreviewActive(_active: boolean) {},
  async start(_o: PoseEngineOptions) {},
  async stop() {},
  addListener(_cb) { return () => {}; },
  addStatusListener(_cb) { return () => {}; },
};
