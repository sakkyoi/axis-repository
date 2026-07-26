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
    timeout: 15000,
    withCredentials: false,
  });
  const token = options.accessToken?.trim() ?? "";
  if (token) {
    http.defaults.headers.common.Authorization = `Bearer ${token}`;
  }
  http.interceptors.response.use(undefined, async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
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
    if (message) {
      return Promise.reject(new Error(message));
    }
    return Promise.reject(error);
  });
  return http;
}
