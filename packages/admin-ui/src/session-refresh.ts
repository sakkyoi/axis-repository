/**
 * Collapses concurrent calls onto one in-flight promise.
 *
 * Refreshing rotates the refresh cookie, so a second concurrent refresh would
 * present a token the first one already replaced and be rejected, logging the
 * user out. Several requests can fail with 401 at the same moment, so sharing
 * one refresh between them is a correctness requirement rather than an
 * optimization.
 */
export function createSingleFlight<T>(): (run: () => Promise<T>) => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return (run) => {
    if (inFlight) {
      return inFlight;
    }
    let started: Promise<T>;
    try {
      started = run();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    inFlight = started.finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/** Milliseconds before expiry at which a session should be refreshed early. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

/**
 * Delay before proactively refreshing a session that expires at `expiresAt`.
 * Returns undefined when the timestamp is unusable, so callers fall back to
 * refreshing reactively on a 401.
 */
export function accessTokenRefreshDelayMs(
  expiresAt: string,
  now: number,
  skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS,
): number | undefined {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return undefined;
  }
  return Math.max(0, expiresAtMs - now - skewMs);
}
