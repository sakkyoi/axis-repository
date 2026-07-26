import { describe, expect, it } from "vitest";
import { profileSummaryItems } from "./profile-page-model";
import type { AdminPrincipal } from "../api/schemas";

const principal: AdminPrincipal = {
  type: "admin",
  subject: "admin_user_1",
  username: "admin",
  role: "owner",
  scopes: ["admin:*"],
  sessionId: "admin_session_1",
};

describe("profile page model", () => {
  it("shows current admin identity fields without exposing tokens", () => {
    expect(profileSummaryItems(principal)).toEqual([
      ["Username", "admin"],
      ["Role", "owner"],
      ["User ID", "admin_user_1"],
    ]);
  });
});
