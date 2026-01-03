import type { IPoseEngine, PoseEngineOptions } from "./IPoseEngine";

export const PoseEngineMock: IPoseEngine = {
  async ping() { return { ok: true, version: "mock-1.0" }; },
  async start(_o: PoseEngineOptions) {},
  async stop() {},
  addListener(_cb) { return () => {}; },
};
