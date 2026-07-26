import { describe, expect, it } from "vitest";
import {
  ADMIN_UI_PATHS,
  ADMIN_UI_NAV_ITEMS,
  safeAdminRedirectPath,
  adminLoginPathFor,
  repositorySettingsPath,
  repositoryWorkspacePath,
} from "./navigation";

describe("admin UI navigation namespace", () => {
  it("keeps console routes under the /ui namespace", () => {
    expect(ADMIN_UI_PATHS.root).toBe("/ui/");
    expect(ADMIN_UI_PATHS.login).toBe("/ui/login");
    expect(ADMIN_UI_PATHS.repositories).toBe("/ui/repositories");
    expect(ADMIN_UI_PATHS.newRepository).toBe("/ui/repositories/new");
    expect(ADMIN_UI_PATHS.repositoryWorkspace).toBe("/ui/repositories/:name");
    expect(ADMIN_UI_PATHS.repositorySettings).toBe("/ui/repositories/:name/settings");
    expect(ADMIN_UI_PATHS.tokens).toBe("/ui/tokens");
    expect(ADMIN_UI_PATHS.users).toBe("/ui/users");
    expect(ADMIN_UI_PATHS.profile).toBe("/ui/profile");
    expect(ADMIN_UI_PATHS.settings).toBe("/ui/settings");
    expect(ADMIN_UI_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/ui/repositories",
      "/ui/tokens",
      "/ui/users",
      "/ui/settings",
    ]);
  });

  it("uses the namespaced login route without losing the original destination", () => {
    expect(adminLoginPathFor("/ui/settings")).toEqual({
      pathname: "/ui/login",
      state: { from: "/ui/settings" },
    });
  });

  it("builds repository workspace and settings paths with encoded names", () => {
    expect(repositoryWorkspacePath("debian prod")).toBe("/ui/repositories/debian%20prod");
    expect(repositorySettingsPath("debian/prod")).toBe("/ui/repositories/debian%2Fprod/settings");
  });
});

describe("safeAdminRedirectPath", () => {
  it("keeps admin UI paths", () => {
    expect(safeAdminRedirectPath("/ui/tokens")).toBe("/ui/tokens");
    expect(safeAdminRedirectPath("/ui/repositories/debian%20internal")).toBe(
      "/ui/repositories/debian%20internal",
    );
  });

  it("falls back to the repositories page for anything that leaves the app", () => {
    for (const target of [
      "https://evil.example/phish",
      "//evil.example/phish",
      "/admin/auth/login",
      "/ui",
      "javascript:alert(1)",
      "/ui/\\evil.example",
      "",
      "   ",
      undefined,
      null,
      42,
      { pathname: "/ui/tokens" },
    ]) {
      expect(safeAdminRedirectPath(target), `expected ${JSON.stringify(target)} to be rejected`)
        .toBe(ADMIN_UI_PATHS.repositories);
    }
  });
});

