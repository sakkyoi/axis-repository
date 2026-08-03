import { defineMiddleware } from "astro:middleware";

// Starlight always injects its own `<link rel="shortcut icon"
// href="/favicon.svg">` (see @astrojs/starlight/utils/head.ts) as a hardcoded
// fallback -- even with no `favicon` option set, and even alongside a custom
// `head` array, since its merge logic never treats a favicon link as
// replacing another one. Worse, that tag's importance score is fixed lower
// than a plain `rel="icon"` link, so it always sorts *after* the two this
// site sets in astro.config.mjs -- and per spec, browsers use whichever
// matching icon link comes last in the document. That silently makes
// Starlight's own tag (pointing at a file that doesn't exist in this
// project) win over the real light/dark favicon on every docs page. There's
// no config option to suppress it, so this strips it from every rendered
// page -- middleware runs for both `astro dev` and `astro build`'s static
// prerendering, so it's the one place that covers both instead of needing a
// separate dev-only and build-only fix.
const DEFAULT_FAVICON_TAG = /<link rel="shortcut icon" href="\/favicon\.svg"[^>]*\/?>/;

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  if (!response.headers.get("content-type")?.includes("text/html")) return response;

  // Always rebuild the Response from here on, even when nothing matched --
  // response.text() has already drained the original body stream, so
  // returning `response` itself at this point would send an empty body.
  const html = await response.text();
  const stripped = html.replace(DEFAULT_FAVICON_TAG, "");
  return new Response(stripped, { status: response.status, headers: response.headers });
});
