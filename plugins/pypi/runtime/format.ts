import { ValidationError } from "@axis-repository/core";
import { PypiFormatError } from "../shared/errors";

/**
 * Reports a malformed distribution as a bad request.
 *
 * The shared readers run in the browser too, so they raise their own error;
 * over HTTP that has to become a 400 rather than an unhandled failure.
 */
export function asValidationError(error: unknown): unknown {
  return error instanceof PypiFormatError ? new ValidationError(error.message) : error;
}

export function rethrowAsValidationError(error: unknown): never {
  throw asValidationError(error);
}

export async function inValidationErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    rethrowAsValidationError(error);
  }
}

export function inValidationErrorsSync<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    rethrowAsValidationError(error);
  }
}
