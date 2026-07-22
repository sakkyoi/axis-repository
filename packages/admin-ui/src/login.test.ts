import { describe, expect, it, vi } from "vitest";
import { authenticateAdminLogin } from "./login";

describe("authenticateAdminLogin", () => {
  it("rejects empty admin tokens without verifying or storing them", async () => {
    const verifyToken = vi.fn();
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      token: "   ",
      verifyToken,
      login,
    });

    expect(result).toEqual({ authenticated: false, error: "Admin token is required." });
    expect(verifyToken).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("does not store invalid admin tokens", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("Unauthorized"));
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      token: "wrong-token",
      verifyToken,
      login,
    });

    expect(result).toEqual({ authenticated: false, error: "Admin token is invalid." });
    expect(verifyToken).toHaveBeenCalledWith("wrong-token");
    expect(login).not.toHaveBeenCalled();
  });

  it("stores trimmed admin tokens after verification succeeds", async () => {
    const verifyToken = vi.fn().mockResolvedValue(undefined);
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      token: "  admin-token  ",
      verifyToken,
      login,
    });

    expect(result).toEqual({ authenticated: true });
    expect(verifyToken).toHaveBeenCalledWith("admin-token");
    expect(login).toHaveBeenCalledWith("admin-token");
  });
});
