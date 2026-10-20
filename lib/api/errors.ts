/* Typed API errors + helpers. */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  static badRequest(message = "Invalid request") {
    return new ApiError(400, "BAD_REQUEST", message);
  }
  static unauthorized(message = "Please log in to continue") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "You don't have permission to do that") {
    return new ApiError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }
  static conflict(message = "Conflict") {
    return new ApiError(409, "CONFLICT", message);
  }
  static tooMany(message = "Too many requests. Try again later.") {
    return new ApiError(429, "RATE_LIMITED", message);
  }
}