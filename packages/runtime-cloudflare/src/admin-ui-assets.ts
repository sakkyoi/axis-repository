import { adminUiAssetEntries } from "./admin-ui-assets.generated";

export interface AdminUiAsset {
  body: BodyInit;
  contentType: string;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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
