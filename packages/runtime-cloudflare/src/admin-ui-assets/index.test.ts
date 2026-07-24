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
});
