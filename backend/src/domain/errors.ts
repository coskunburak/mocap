export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown) {
  return new ApiError(400, "validation_failed", message, details);
}

export function forbidden(message = "Forbidden") {
  return new ApiError(403, "forbidden", message);
}

export function notFound(message = "Not found") {
  return new ApiError(404, "not_found", message);
}

export function conflict(message: string, details?: unknown) {
  return new ApiError(409, "conflict", message, details);
}

