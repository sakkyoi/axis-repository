const adminTokenKey = "axis.adminToken";
const apiBaseUrlKey = "axis.apiBaseUrl";

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

export function getAdminToken(storage: Pick<Storage, "getItem"> = window.localStorage): string {
  return storage.getItem(adminTokenKey) ?? "";
}

export function setAdminToken(storage: Pick<Storage, "setItem">, token: string): void {
  storage.setItem(adminTokenKey, token.trim());
}

export function clearAdminToken(storage: Pick<Storage, "removeItem"> = window.localStorage): void {
  storage.removeItem(adminTokenKey);
}

export function getApiBaseUrl(storage: Pick<Storage, "getItem"> = window.localStorage): string {
  return storage.getItem(apiBaseUrlKey) ?? "";
}

export function setApiBaseUrl(storage: Pick<Storage, "setItem">, baseUrl: string): void {
  storage.setItem(apiBaseUrlKey, normalizeApiBaseUrl(baseUrl));
}
