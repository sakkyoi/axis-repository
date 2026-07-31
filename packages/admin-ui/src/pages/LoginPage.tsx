import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../auth";
import { createAxisClient } from "../api/client";
import { AppBootScreen } from "../components/app-boot";
import { AxisBrand } from "../components/brand/axis-brand";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { authenticateAdminLogin } from "../login";
import { safeAdminRedirectPath } from "../navigation";
import { getRuntimeConfig } from "../runtime-config";

interface LoginLocationState {
  from?: string;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const from = safeAdminRedirectPath((location.state as LoginLocationState | null)?.from);

  if (auth.isInitializing) {
    return <AppBootScreen />;
  }

  if (auth.isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsVerifying(true);
    const result = await authenticateAdminLogin({
      username,
      password,
      login: auth.login,
      authenticate: (credentials) =>
        createAxisClient({
          baseUrl: getRuntimeConfig().apiBaseUrl,
        }).loginAdmin(credentials),
    });
    setIsVerifying(false);
    if (!result.authenticated) {
      setError(result.error);
      return;
    }
    setError("");
    void navigate(from, { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
      <section className="grid w-full max-w-sm gap-5 rounded-lg border border-border bg-panel p-6 shadow-md">
        <AxisBrand
          subtitle="Sign in to the admin console."
          markClassName="h-12 w-12"
          titleClassName="text-xl"
          subtitleClassName="mt-1 text-sm"
        />
        {error && (
          <Alert className="border-destructive/35 bg-destructive/10 text-destructive-ink">
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription className="text-destructive-ink">{error}</AlertDescription>
          </Alert>
        )}
        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Username</span>
            <Input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Password</span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
            />
          </label>
          <Button type="submit" disabled={isVerifying}>
            <LogIn className="mr-2 h-4 w-4" />
            {isVerifying ? "Checking..." : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
