import { describe, expect, it } from "vitest";
import { clearStoredAdminToken, getStoredAdminToken, setStoredAdminToken } from "./auth";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("admin auth storage", () => {
  it("stores trimmed admin tokens in session storage", () => {
    const storage = new MemoryStorage();

    setStoredAdminToken(storage, "  secret-token  ");

    expect(getStoredAdminToken(storage)).toBe("secret-token");
  });

  it("clears stored admin tokens", () => {
    const storage = new MemoryStorage();
    setStoredAdminToken(storage, "secret-token");

    clearStoredAdminToken(storage);

    expect(getStoredAdminToken(storage)).toBe("");
  });
});
