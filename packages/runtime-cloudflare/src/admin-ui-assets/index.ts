import { adminUiAssetEntries } from "./generated";

export interface AdminUiAsset {
  body: BodyInit;
  contentType: string;
}

export interface AdminUiRuntimeConfig {
  apiBaseUrl?: string;
  /**
   * Origin the browser uploads artifacts to, when that is not this origin.
   * Narrows connect-src to the one host presigned uploads actually need.
   */
  uploadOrigin?: string;
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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

const MODULE_SCRIPT_TAG = /<script\b(?![^>]*\bnonce=)([^>]*\btype="module"[^>]*)>/gi;

/**
 * Injects the runtime config and stamps the nonce onto every script the shell
 * loads.
 *
 * The build's own module script needs the nonce too: the policy is nonce-only,
 * so an unstamped tag would simply not run. That is the point — with no host
 * source in `script-src`, a same-origin URL is not sufficient on its own, which
 * is what stops a publisher-supplied artifact being loaded as a script.
 */
export function injectAdminUiRuntimeConfig(
  html: BodyInit,
  config: AdminUiRuntimeConfig,
  nonce?: string,
): string {
  const nonceAttribute = nonce ? ` nonce="${nonce}"` : "";
  const configScript = `<script${nonceAttribute}>window.__AXIS_ADMIN_CONFIG__=${jsonForInlineScript({
    apiBaseUrl: config.apiBaseUrl ?? "",
  })};</script>`;
  const htmlText = nonce
    ? bytesToText(html).replace(MODULE_SCRIPT_TAG, `<script nonce="${nonce}"$1>`)
    : bytesToText(html);
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
