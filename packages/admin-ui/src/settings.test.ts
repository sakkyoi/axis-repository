import { describe, expect, it } from "vitest";
import {
  getAdminToken,
  getApiBaseUrl,
  setAdminToken,
  setApiBaseUrl,
  clearAdminToken,
  normalizeApiBaseUrl,
} from "./settings";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("settings storage", () => {
  it("stores and clears admin tokens", () => {
    const storage = new MemoryStorage();

    setAdminToken(storage, "  secret  ");
    expect(getAdminToken(storage)).toBe("secret");

    clearAdminToken(storage);
    expect(getAdminToken(storage)).toBe("");
  });

  it("stores normalized API base URLs and defaults to same origin", () => {
    const storage = new MemoryStorage();

    expect(getApiBaseUrl(storage)).toBe("");
    setApiBaseUrl(storage, "https://axis.example/");

    expect(getApiBaseUrl(storage)).toBe("https://axis.example");
  });

  it("normalizes same-origin API base URL to an empty string", () => {
    expect(normalizeApiBaseUrl("  ")).toBe("");
    expect(normalizeApiBaseUrl("/")).toBe("");
    expect(normalizeApiBaseUrl("https://axis.example/")).toBe("https://axis.example");
  });
});
