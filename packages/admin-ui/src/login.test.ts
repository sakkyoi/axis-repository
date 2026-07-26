import { describe, expect, it, vi } from "vitest";
import { authenticateAdminLogin } from "./login";

describe("authenticateAdminLogin", () => {
  it("rejects empty usernames without authenticating", async () => {
    const authenticate = vi.fn();
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      username: "   ",
      password: "password",
      authenticate,
      login,
    });

    expect(result).toEqual({ authenticated: false, error: "Username is required." });
    expect(authenticate).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("rejects empty passwords without authenticating", async () => {
    const authenticate = vi.fn();
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      username: "admin",
      password: "",
      authenticate,
      login,
    });

    expect(result).toEqual({ authenticated: false, error: "Password is required." });
    expect(authenticate).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("does not store access tokens after failed authentication", async () => {
    const authenticate = vi.fn().mockRejectedValue(new Error("Unauthorized"));
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      username: "admin",
      password: "wrong-password",
      authenticate,
      login,
    });

    expect(result).toEqual({ authenticated: false, error: "Username or password is invalid." });
    expect(login).not.toHaveBeenCalled();
  });

  it("stores access tokens after authentication succeeds", async () => {
    const authenticate = vi.fn().mockResolvedValue({ accessToken: "access-token" });
    const login = vi.fn();

    const result = await authenticateAdminLogin({
      username: "  admin  ",
      password: "correct-password",
      authenticate,
      login,
    });

    expect(result).toEqual({ authenticated: true });
    expect(authenticate).toHaveBeenCalledWith({ username: "admin", password: "correct-password" });
    expect(login).toHaveBeenCalledWith("access-token");
  });
});
