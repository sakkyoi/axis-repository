import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { adminLoginPathFor } from "../navigation";

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isInitializing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading...
      </main>
    );
  }

  if (!auth.isAuthenticated) {
    const login = adminLoginPathFor(location.pathname);
    return <Navigate to={login.pathname} replace state={login.state} />;
  }

  return <Outlet />;
}
