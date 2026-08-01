import logoMarkDark from "../../../../assets/logo-mark-dark.svg?raw";
import logoMarkLight from "../../../../assets/logo-mark-light.svg?raw";

function toBase64(value: string): string {
  return btoa(value);
}

export const adminUiAssetEntries: ReadonlyArray<readonly [
  string,
  { contentType: string; bodyBase64: string },
]> = [
  ["/logo-mark-dark.svg", { contentType: "image/svg+xml", bodyBase64: toBase64(logoMarkDark) }],
  ["/logo-mark-light.svg", { contentType: "image/svg+xml", bodyBase64: toBase64(logoMarkLight) }],
];
