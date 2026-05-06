import { ensureUser } from "../infra/db/postgres";
import { ProjectRepository } from "../infra/db/repositories";
import { requireString } from "./validators";

export class ProjectService {
  constructor(private readonly projects = new ProjectRepository()) {}

  async create(userId: string, body: unknown) {
    await ensureUser(userId);
    const name = requireString((body as Record<string, unknown>)?.name, "name");
    return this.projects.create(userId, name);
  }

  async list(userId: string) {
    await ensureUser(userId);
    return this.projects.list(userId);
  }
}

