import type { FastifyInstance } from "fastify";
import { userIdFromRequest } from "./auth";
import { ExportService } from "../services/exportService";
import { ProcessingService } from "../services/processingService";
import { ProjectService } from "../services/projectService";
import { TakeService } from "../services/takeService";
import { UploadService } from "../services/uploadService";

type ProjectParams = { projectId: string };
type TakeParams = { takeId: string };
type JobParams = { jobId: string };
type ExportParams = { exportId: string };

export async function registerRoutes(app: FastifyInstance) {
  const projects = new ProjectService();
  const takes = new TakeService();
  const uploads = new UploadService();
  const processing = new ProcessingService();
  const exports = new ExportService();

  app.get("/health", async () => ({ ok: true }));

  app.post("/api/projects", async (request, reply) => {
    const project = await projects.create(userIdFromRequest(request), request.body);
    reply.code(201).send({ project });
  });

  app.get("/api/projects", async (request) => {
    const list = await projects.list(userIdFromRequest(request));
    return { projects: list };
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:projectId/takes", async (request, reply) => {
    const take = await takes.create(
      userIdFromRequest(request),
      request.params.projectId,
      request.body,
    );
    reply.code(201).send({ take });
  });

  app.get<{ Params: TakeParams }>("/api/takes/:takeId", async (request) => {
    const take = await takes.get(userIdFromRequest(request), request.params.takeId);
    return { take };
  });

  app.post<{ Params: TakeParams }>("/api/takes/:takeId/uploads/init", async (request, reply) => {
    const result = await uploads.init(
      userIdFromRequest(request),
      request.params.takeId,
      request.body,
    );
    reply.code(201).send(result);
  });

  app.post<{ Params: TakeParams }>("/api/takes/:takeId/uploads/complete", async (request) => {
    return uploads.complete(
      userIdFromRequest(request),
      request.params.takeId,
      request.body,
    );
  });

  app.post<{ Params: TakeParams }>("/api/takes/:takeId/process", async (request, reply) => {
    const job = await processing.create(
      userIdFromRequest(request),
      request.params.takeId,
      request.body,
    );
    reply.code(201).send({ job });
  });

  app.get<{ Params: JobParams }>("/api/jobs/:jobId", async (request) => {
    const job = await processing.get(userIdFromRequest(request), request.params.jobId);
    return { job };
  });

  app.post<{ Params: JobParams }>("/api/jobs/:jobId/retry", async (request, reply) => {
    const job = await processing.retry(userIdFromRequest(request), request.params.jobId);
    reply.code(201).send({ job });
  });

  app.post<{ Params: JobParams }>("/api/jobs/:jobId/cancel", async (request) => {
    const job = await processing.cancel(userIdFromRequest(request), request.params.jobId);
    return { job };
  });

  app.get<{ Params: TakeParams }>("/api/takes/:takeId/exports", async (request) => {
    const list = await exports.listByTake(userIdFromRequest(request), request.params.takeId);
    return { exports: list };
  });

  app.get<{ Params: ExportParams }>("/api/exports/:exportId/download-url", async (request) => {
    return exports.downloadUrl(userIdFromRequest(request), request.params.exportId);
  });
}
