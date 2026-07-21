import { adminUiAssetEntries } from "./admin-ui-assets.generated";

export interface AdminUiAsset {
  body: BodyInit;
  contentType: string;
}

export interface AdminUiRuntimeConfig {
  apiBaseUrl?: string;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToText(value: BodyInit): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  throw new Error("Admin UI HTML asset must be text-compatible");
}

export function injectAdminUiRuntimeConfig(html: BodyInit, config: AdminUiRuntimeConfig): string {
  const configScript = `<script>window.__AXIS_ADMIN_CONFIG__=${JSON.stringify({
    apiBaseUrl: config.apiBaseUrl ?? "",
  })};</script>`;
  const htmlText = bytesToText(html);
  const moduleScriptIndex = htmlText.search(/<script\b[^>]*\btype="module"[^>]*>/i);
  if (moduleScriptIndex >= 0) {
    return `${htmlText.slice(0, moduleScriptIndex)}${configScript}${htmlText.slice(moduleScriptIndex)}`;
  }
  return htmlText.includes("</head>")
    ? htmlText.replace("</head>", `${configScript}</head>`)
    : `${configScript}${htmlText}`;
}

export const adminUiAssets = new Map<string, AdminUiAsset>(
  adminUiAssetEntries.map(([path, asset]) => [
    path,
    {
      contentType: asset.contentType,
      body: base64ToBytes(asset.bodyBase64),
    },
  ]),
);
