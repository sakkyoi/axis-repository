export class AxisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class UnauthorizedError extends AxisError {
  constructor() {
    super("Unauthorized", "unauthorized", 401);
  }
}

export class ForbiddenError extends AxisError {
  constructor(message = "Forbidden") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AxisError {
  constructor(message = "Not Found") {
    super(message, "not_found", 404);
  }
}

export class ValidationError extends AxisError {
  constructor(message: string) {
    super(message, "validation_error", 400);
  }
}
