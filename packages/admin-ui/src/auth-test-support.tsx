import type { ReactNode } from "react";
import { AuthContext, type AuthContextValue } from "./auth";

const defaultAuth: AuthContextValue = {
  accessToken: "",
  isAuthenticated: false,
  isInitializing: false,
  login: () => undefined,
  logout: () => undefined,
  refreshAccessToken: async () => null,
};

/**
 * Supplies an auth context without mounting AuthProvider, so component tests
 * can set the exact session state they are exercising.
 */
export function AuthTestProvider({
  value,
  children,
}: {
  value: Partial<AuthContextValue>;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={{ ...defaultAuth, ...value }}>{children}</AuthContext.Provider>;
}
