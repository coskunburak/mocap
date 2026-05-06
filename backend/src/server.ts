import cors from "@fastify/cors";
import fastify from "fastify";
import { ApiError } from "./domain/errors";
import { registerRoutes } from "./http/routes";

export async function buildServer() {
  const app = fastify({
    logger: true,
    requestIdHeader: "x-request-id",
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Internal server error",
        requestId,
      },
    });
  });

  await registerRoutes(app);
  return app;
}

