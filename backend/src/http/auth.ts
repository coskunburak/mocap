import type { FastifyRequest } from "fastify";
import { badRequest } from "../domain/errors";

export function userIdFromRequest(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header) {
    return "dev-user-id";
  }
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw badRequest("Authorization must be Bearer token");
  }
  return token;
}

