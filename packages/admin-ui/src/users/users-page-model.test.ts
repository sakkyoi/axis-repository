import { describe, expect, it } from "vitest";
import { adminUsersPanelClass, usersPageShellClass } from "./users-page-model";

describe("users page model", () => {
  it("keeps users page sections packed at the top", () => {
    const className = usersPageShellClass();

    expect(className).toContain("content-start");
  });

  it("keeps the admin user header and table visually packed", () => {
    const className = adminUsersPanelClass();

    expect(className).toContain("content-start");
    expect(className).toContain("gap-2");
    expect(className).not.toContain("gap-3");
  });
});
