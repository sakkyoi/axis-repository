export interface AdminUiAsset {
  body: string;
  contentType: string;
}

export const adminUiAssets = new Map<string, AdminUiAsset>([
  [
    "/",
    {
      contentType: "text/html; charset=utf-8",
      body: [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="UTF-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        "<title>Axis Repository</title>",
        "</head>",
        "<body>",
        '<div id="root"></div>',
        '<script type="module" src="/assets/index.js"></script>',
        "</body>",
        "</html>",
      ].join(""),
    },
  ],
  [
    "/assets/index.js",
    {
      contentType: "application/javascript; charset=utf-8",
      body: 'document.getElementById("root").textContent = "Axis Repository";',
    },
  ],
]);
