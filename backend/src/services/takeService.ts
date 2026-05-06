import { config } from "../config";
import { badRequest } from "../domain/errors";
import { ProjectRepository, TakeRepository } from "../infra/db/repositories";
import { asRecord, optionalString, requireInt, requireString } from "./validators";

export class TakeService {
  constructor(
    private readonly projects = new ProjectRepository(),
    private readonly takes = new TakeRepository(),
  ) {}

  async create(userId: string, projectId: string, body: unknown) {
    await this.projects.get(userId, projectId);
    const obj = asRecord(body);
    const name = requireString(obj.name, "name");
    const captureMode = optionalString(obj.captureMode, "solo");
    if (!["solo", "dual", "pro_4_camera"].includes(captureMode)) {
      throw badRequest("captureMode is invalid", { captureMode });
    }
    const expectedVideoCount = requireInt(
      obj.expectedVideoCount ?? 1,
      "expectedVideoCount",
      1,
      config.limits.maxExpectedVideos,
    );
    return this.takes.create({
      userId,
      projectId,
      name,
      captureMode,
      expectedVideoCount,
    });
  }

  async get(userId: string, takeId: string) {
    return this.takes.get(userId, takeId);
  }
}

