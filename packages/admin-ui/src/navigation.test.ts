import { describe, expect, it } from "vitest";
import { ADMIN_UI_PATHS, ADMIN_UI_NAV_ITEMS, adminLoginPathFor } from "./navigation";

describe("admin UI navigation namespace", () => {
  it("keeps console routes under the /ui namespace", () => {
    expect(ADMIN_UI_PATHS.root).toBe("/ui/");
    expect(ADMIN_UI_PATHS.login).toBe("/ui/login");
    expect(ADMIN_UI_PATHS.repositories).toBe("/ui/repositories");
    expect(ADMIN_UI_PATHS.tokens).toBe("/ui/tokens");
    expect(ADMIN_UI_PATHS.signingKeys).toBe("/ui/signing-keys");
    expect(ADMIN_UI_PATHS.settings).toBe("/ui/settings");
    expect(ADMIN_UI_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/ui/repositories",
      "/ui/tokens",
      "/ui/signing-keys",
      "/ui/settings",
    ]);
  });

  it("uses the namespaced login route without losing the original destination", () => {
    expect(adminLoginPathFor("/ui/settings")).toEqual({
      pathname: "/ui/login",
      state: { from: "/ui/settings" },
    });
  });
});
