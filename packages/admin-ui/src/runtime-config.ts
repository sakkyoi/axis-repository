export interface AxisAdminRuntimeConfig {
  apiBaseUrl: string;
}

export interface AxisAdminWindow {
  __AXIS_ADMIN_CONFIG__?: Partial<AxisAdminRuntimeConfig>;
}

export function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

export function getRuntimeConfig(windowLike: AxisAdminWindow = globalThis as AxisAdminWindow): AxisAdminRuntimeConfig {
  return {
    apiBaseUrl: normalizeApiBaseUrl(windowLike.__AXIS_ADMIN_CONFIG__?.apiBaseUrl),
  };
}
