import { describe, expect, it } from "vitest";
import {
  applyThemeToRoot,
  readStoredThemePreference,
  resolveThemePreference,
  storeThemePreference,
  type ResolvedTheme,
} from "./theme";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Pick<Storage, "getItem" | "setItem"> {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

describe("admin UI theme helpers", () => {
  it("reads valid stored theme preferences", () => {
    const storage = new MemoryStorage();
    storage.setItem("axis-admin-theme", "dark");

    expect(readStoredThemePreference(storage)).toBe("dark");
  });

  it("falls back to system for invalid or unavailable storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("axis-admin-theme", "sepia");

    expect(readStoredThemePreference(storage)).toBe("system");
    expect(readStoredThemePreference(new ThrowingStorage())).toBe("system");
    expect(readStoredThemePreference(undefined)).toBe("system");
  });

  it("stores theme preferences when storage is available", () => {
    const storage = new MemoryStorage();

    storeThemePreference(storage, "dark");

    expect(storage.getItem("axis-admin-theme")).toBe("dark");
  });

  it("ignores storage write failures", () => {
    expect(() => storeThemePreference(new ThrowingStorage(), "dark")).not.toThrow();
  });

  it("resolves system preferences from the OS preference", () => {
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", undefined)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("applies resolved themes to a root-like element", () => {
    const root = { dataset: {}, style: { colorScheme: "" as ResolvedTheme | "" } };

    applyThemeToRoot(root, "dark");

    expect(root.dataset).toEqual({ theme: "dark" });
    expect(root.style.colorScheme).toBe("dark");
  });
});
