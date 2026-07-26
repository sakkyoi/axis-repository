import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createAxisClient } from "./api/client";
import type { AdminAuthResponse } from "./api/schemas";
import { getRuntimeConfig } from "./runtime-config";

export interface AuthContextValue {
  accessToken: string;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login(accessToken: string): void;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
let pendingBootstrapRefresh: Promise<AdminAuthResponse | null> | null = null;

export function normalizeAccessToken(value: string): string {
  return value.trim();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [accessToken, setAccessToken] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    pendingBootstrapRefresh ??= createAxisClient({
      baseUrl: getRuntimeConfig().apiBaseUrl,
    }).refreshAdminSession()
      .catch(() => null)
      .finally(() => {
        pendingBootstrapRefresh = null;
      });

    pendingBootstrapRefresh
      .then((result) => {
        if (cancelled) {
          return;
        }
        const refreshedAccessToken = result ? normalizeAccessToken(result.accessToken) : "";
        setAccessToken(refreshedAccessToken);
        if (refreshedAccessToken) {
          queryClient.clear();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsInitializing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      isAuthenticated: Boolean(accessToken),
      isInitializing,
      login(nextAccessToken: string) {
        const trimmed = normalizeAccessToken(nextAccessToken);
        if (!trimmed) {
          return;
        }
        setAccessToken(trimmed);
        queryClient.clear();
      },
      logout() {
        setAccessToken("");
        queryClient.clear();
      },
    }),
    [accessToken, isInitializing, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
