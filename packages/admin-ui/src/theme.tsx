import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const THEME_STORAGE_KEY = "axis-admin-theme";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredThemePreference(storage: Pick<Storage, "getItem"> | undefined): ThemePreference {
  if (!storage) return "system";
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeThemePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  preference: ThemePreference,
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Theme preference is non-critical; in-memory state remains usable.
  }
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean | undefined,
): ResolvedTheme {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}

function systemPrefersDark(): boolean | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

function resolveSystemTheme(): ResolvedTheme {
  return resolveThemePreference("system", systemPrefersDark());
}

export function applyThemeToRoot(
  root: { dataset: DOMStringMap; style: Pick<CSSStyleDeclaration, "colorScheme"> },
  theme: ResolvedTheme,
): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  applyThemeToRoot(document.documentElement, theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const storage = typeof window === "undefined" ? undefined : window.localStorage;
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredThemePreference(storage));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => resolveSystemTheme());
  const resolvedTheme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
    const handleChange = () => setSystemTheme(mediaQuery.matches ? "dark" : "light");
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference(nextPreference) {
        setPreferenceState(nextPreference);
        storeThemePreference(storage, nextPreference);
      },
    }),
    [preference, resolvedTheme, storage],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
