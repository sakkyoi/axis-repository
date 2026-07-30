import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

export interface HttpOptions {
  baseUrl: string;
  accessToken?: string;
  /**
   * Called when a request comes back 401. Returns a fresh access token, or null
   * when the session cannot be recovered.
   */
  onUnauthorized?: () => Promise<string | null>;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function serverErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("error" in data)) return undefined;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !("message" in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

/**
 * Only the refresh and logout endpoints authenticate with the session cookie;
 * everything else uses the bearer header. Sending credentials by default would
 * attach the cookie to every request for no benefit.
 */
export const withSessionCookie = { withCredentials: true } as const;

/**
 * How long to wait on a request that reads or writes one record.
 *
 * Long enough that a slow network is not mistaken for a dead server, short
 * enough that a dead server is not mistaken for a slow network.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * How long to wait on a request whose work scales with what a repository
 * holds.
 *
 * Verifying an upload hashes the whole artifact; publishing writes every index
 * and pool object; deleting a repository deletes every object it has, one
 * round trip each. None of these is bounded by anything the server does -- a
 * Durable Object's wall clock runs for as long as the caller stays connected
 * -- so this timeout is the only limit they meet, and at fifteen seconds it
 * was abandoning work that was going to finish. Waiting is not free either:
 * this is a ceiling on a request that has stopped making progress, not an
 * estimate of how long any of these should take.
 */
export const BULK_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** Marks a request as the second kind. */
export const bulkRequest = { timeout: BULK_REQUEST_TIMEOUT_MS } as const;

const AUTH_PATH_PREFIX = "/admin/auth/";

interface RetriedRequestConfig extends InternalAxiosRequestConfig {
  axisRetriedAfterRefresh?: boolean;
}

/**
 * A 401 is worth retrying once, after refreshing the session. The auth
 * endpoints are excluded: retrying a failed refresh would recurse.
 */
export function shouldRetryAfterRefresh(input: {
  status: number | undefined;
  url: string | undefined;
  alreadyRetried: boolean;
}): boolean {
  if (input.status !== 401 || input.alreadyRetried) {
    return false;
  }
  return !(input.url ?? "").startsWith(AUTH_PATH_PREFIX);
}

export function createHttpClient(options: HttpOptions): AxiosInstance {
  const http = axios.create({
    baseURL: normalizeBaseUrl(options.baseUrl),
    timeout: REQUEST_TIMEOUT_MS,
    withCredentials: false,
  });
  const token = options.accessToken?.trim() ?? "";
  if (token) {
    http.defaults.headers.common.Authorization = `Bearer ${token}`;
  }
  http.interceptors.response.use(undefined, async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(toError(error));
    }
    const config = error.config as RetriedRequestConfig | undefined;
    const onUnauthorized = options.onUnauthorized;
    if (
      config
      && onUnauthorized
      && shouldRetryAfterRefresh({
        status: error.response?.status,
        url: config.url,
        alreadyRetried: Boolean(config.axisRetriedAfterRefresh),
      })
    ) {
      const refreshedToken = await onUnauthorized();
      if (refreshedToken) {
        config.axisRetriedAfterRefresh = true;
        config.headers.Authorization = `Bearer ${refreshedToken}`;
        return http.request(config);
      }
    }
    const message = serverErrorMessage(error.response?.data);
    return Promise.reject(message ? new Error(message) : toError(error));
  });
  return http;
}
