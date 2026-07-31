import { describe, expect, it } from "vitest";
import { injectAdminUiRuntimeConfig } from ".";

describe("admin UI assets", () => {
  it("escapes runtime config before injecting it into inline script", () => {
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<script type="module" src="/assets/index.js"></script>',
      "</head>",
      "<body></body>",
      "</html>",
    ].join("");

    const injected = injectAdminUiRuntimeConfig(html, {
      apiBaseUrl: "https://api.example/</script><script>alert(1)</script>&\u2028\u2029",
    });

    expect(injected).toContain("window.__AXIS_ADMIN_CONFIG__");
    expect(injected).not.toContain("</script><script>alert(1)</script>");
    expect(injected).toContain("\\u003c/script\\u003e");
    expect(injected).toContain("\\u0026");
    expect(injected).toContain("\\u2028");
    expect(injected).toContain("\\u2029");
    expect(injected.indexOf("window.__AXIS_ADMIN_CONFIG__")).toBeLessThan(
      injected.indexOf('type="module"'),
    );
  });

  it("answers Zod's question about eval before the bundle can ask it", () => {
    // Zod decides whether to compile each schema as the schema is defined,
    // which happens while the bundle is being evaluated -- so nothing inside
    // the bundle can set the flag in time. Refused, the call costs a policy
    // violation reported on every load and nothing else.
    const html = "<html><head></head><body><script type=\"module\" src=\"/assets/app.js\"></script></body></html>";

    const injected = injectAdminUiRuntimeConfig(html, { apiBaseUrl: "" }, "n0nce");

    expect(injected).toContain("globalThis.__zod_globalConfig={jitless:true}");
    expect(injected.indexOf("__zod_globalConfig")).toBeLessThan(injected.indexOf("/assets/app.js"));
  });
});
