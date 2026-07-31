import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth";
import { adminLoginPathFor } from "../navigation";
import { AppBootScreen } from "./app-boot";

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isInitializing) {
    return <AppBootScreen />;
  }

  if (!auth.isAuthenticated) {
    const login = adminLoginPathFor(location.pathname);
    return <Navigate to={login.pathname} replace state={login.state} />;
  }

  return <Outlet />;
}
