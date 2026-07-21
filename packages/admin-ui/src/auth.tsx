import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const adminTokenKey = "axis.adminToken";

export interface AuthContextValue {
  adminToken: string;
  isAuthenticated: boolean;
  login(token: string): void;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function getStoredAdminToken(storage: Pick<Storage, "getItem"> = window.sessionStorage): string {
  return storage.getItem(adminTokenKey) ?? "";
}

export function setStoredAdminToken(storage: Pick<Storage, "setItem">, token: string): void {
  storage.setItem(adminTokenKey, token.trim());
}

export function clearStoredAdminToken(storage: Pick<Storage, "removeItem"> = window.sessionStorage): void {
  storage.removeItem(adminTokenKey);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [adminToken, setAdminToken] = useState(() => getStoredAdminToken());

  const value = useMemo<AuthContextValue>(
    () => ({
      adminToken,
      isAuthenticated: Boolean(adminToken),
      login(token: string) {
        const trimmed = token.trim();
        if (!trimmed) {
          return;
        }
        setStoredAdminToken(window.sessionStorage, trimmed);
        setAdminToken(trimmed);
        queryClient.clear();
      },
      logout() {
        clearStoredAdminToken();
        setAdminToken("");
        queryClient.clear();
      },
    }),
    [adminToken, queryClient],
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
