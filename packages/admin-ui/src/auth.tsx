import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createAxisClient } from "./api/client";
import type { AdminAuthResponse } from "./api/schemas";
import { getRuntimeConfig } from "./runtime-config";
import { accessTokenRefreshDelayMs, createSingleFlight } from "./session-refresh";

export interface AuthContextValue {
  accessToken: string;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login(accessToken: string, accessTokenExpiresAt: string): void;
  logout(): void;
  /** Exchanges the refresh cookie for a new access token, or null on failure. */
  refreshAccessToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Module scope so every provider mount and every API client share one refresh.
const refreshSessionOnce = createSingleFlight<AdminAuthResponse | null>();

function requestSessionRefresh(): Promise<AdminAuthResponse | null> {
  return refreshSessionOnce(() =>
    createAxisClient({ baseUrl: getRuntimeConfig().apiBaseUrl })
      .refreshAdminSession()
      .catch(() => null),
  );
}

export function normalizeAccessToken(value: string): string {
  return value.trim();
}

export function authBootstrapStateFromRefresh(result: AdminAuthResponse | null): {
  accessToken: string;
  isAuthenticated: boolean;
  shouldClearQueries: boolean;
} {
  const accessToken = result ? normalizeAccessToken(result.accessToken) : "";
  return {
    accessToken,
    isAuthenticated: Boolean(accessToken),
    shouldClearQueries: Boolean(accessToken),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [accessToken, setAccessToken] = useState("");
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void requestSessionRefresh()
      .then((result) => {
        if (cancelled) {
          return;
        }
        const bootstrapState = authBootstrapStateFromRefresh(result);
        setAccessToken(bootstrapState.accessToken);
        setAccessTokenExpiresAt(result?.accessTokenExpiresAt ?? "");
        if (bootstrapState.shouldClearQueries) {
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

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const result = await requestSessionRefresh();
    const nextToken = result ? normalizeAccessToken(result.accessToken) : "";
    if (!nextToken) {
      setAccessToken("");
      setAccessTokenExpiresAt("");
      return null;
    }
    setAccessToken(nextToken);
    setAccessTokenExpiresAt(result?.accessTokenExpiresAt ?? "");
    return nextToken;
  }, []);

  // Refresh slightly ahead of expiry so an idle tab does not have to discover
  // the expired token by failing a request first.
  useEffect(() => {
    if (!accessToken || !accessTokenExpiresAt) {
      return;
    }
    const delay = accessTokenRefreshDelayMs(accessTokenExpiresAt, Date.now());
    if (delay === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      void refreshAccessToken();
    }, delay);
    return () => clearTimeout(timer);
  }, [accessToken, accessTokenExpiresAt, refreshAccessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      isAuthenticated: Boolean(accessToken),
      isInitializing,
      refreshAccessToken,
      login(nextAccessToken: string, nextExpiresAt: string) {
        const trimmed = normalizeAccessToken(nextAccessToken);
        if (!trimmed) {
          return;
        }
        setAccessToken(trimmed);
        setAccessTokenExpiresAt(nextExpiresAt);
        queryClient.clear();
      },
      logout() {
        setAccessToken("");
        setAccessTokenExpiresAt("");
        queryClient.clear();
      },
    }),
    [accessToken, isInitializing, queryClient, refreshAccessToken],
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
