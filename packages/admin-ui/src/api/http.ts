import axios, { type AxiosInstance } from "axios";

export interface HttpOptions {
  baseUrl: string;
  adminToken: string;
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

export function createHttpClient(options: HttpOptions): AxiosInstance {
  const http = axios.create({
    baseURL: normalizeBaseUrl(options.baseUrl),
    timeout: 15000,
  });
  const token = options.adminToken.trim();
  if (token) {
    http.defaults.headers.common.Authorization = `Bearer ${token}`;
  }
  http.interceptors.response.use(undefined, (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const message = serverErrorMessage(error.response?.data);
      if (message) {
        return Promise.reject(new Error(message));
      }
    }
    return Promise.reject(error);
  });
  return http;
}
