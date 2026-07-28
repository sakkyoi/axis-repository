/**
 * Raised when a distribution is not the shape its name claims.
 *
 * The shared layer is used from the browser as well as the worker, so it
 * cannot reach for the runtime's `ValidationError`; the runtime translates
 * this into one so a bad upload is answered as a bad request.
 */
export class PypiFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PypiFormatError";
  }
}
