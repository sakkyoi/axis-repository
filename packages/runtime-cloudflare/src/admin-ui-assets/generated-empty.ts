const shell = [
  "<!doctype html>",
  "<html>",
  "<head>",
  '<link rel="icon" type="image/svg+xml" href="/logo-mark-light.svg" media="(prefers-color-scheme: light)" />',
  '<link rel="icon" type="image/svg+xml" href="/logo-mark-dark.svg" media="(prefers-color-scheme: dark)" />',
  '<script type="module" src="/assets/index-test.js"></script>',
  "</head>",
  '<body><div id="root"></div></body>',
  "</html>",
].join("");

const script = "function createRoot(){}";
const favicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';
const logoMark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 210"></svg>';

function toBase64(value: string): string {
  return btoa(value);
}

// Test and source-only fallback. The production Worker build aliases
// `#admin-ui-assets-generated` to `generated/admin-ui-assets.ts`, which is
// produced from the admin UI dist directory immediately before bundling.
export const adminUiAssetEntries: ReadonlyArray<readonly [
  string,
  { contentType: string; bodyBase64: string },
]> = [
  ["/", { contentType: "text/html; charset=utf-8", bodyBase64: toBase64(shell) }],
  ["/index.html", { contentType: "text/html; charset=utf-8", bodyBase64: toBase64(shell) }],
  ["/assets/index-test.js", {
    contentType: "application/javascript; charset=utf-8",
    bodyBase64: toBase64(script),
  }],
  ["/logo-mark-dark.svg", { contentType: "image/svg+xml", bodyBase64: toBase64(logoMark) }],
  ["/logo-mark-light.svg", { contentType: "image/svg+xml", bodyBase64: toBase64(logoMark) }],
  ["/favicon.svg", { contentType: "image/svg+xml", bodyBase64: toBase64(favicon) }],
];
