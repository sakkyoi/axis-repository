import axios, { type AxiosInstance } from "axios";

export interface HttpOptions {
  baseUrl: string;
  adminToken: string;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
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
  return http;
}
