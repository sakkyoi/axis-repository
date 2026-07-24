import { describe, expect, it } from "vitest";
import {
  ADMIN_UI_PATHS,
  ADMIN_UI_NAV_ITEMS,
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
    expect(ADMIN_UI_PATHS.settings).toBe("/ui/settings");
    expect(ADMIN_UI_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/ui/repositories",
      "/ui/tokens",
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
