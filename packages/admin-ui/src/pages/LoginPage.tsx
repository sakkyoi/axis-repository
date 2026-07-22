import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../auth";
import { createAxisClient } from "../api/client";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { authenticateAdminLogin } from "../login";
import { getRuntimeConfig } from "../runtime-config";

interface LoginLocationState {
  from?: string;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const from = (location.state as LoginLocationState | null)?.from ?? "/repositories";

  if (auth.isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsVerifying(true);
    const result = await authenticateAdminLogin({
      token,
      login: auth.login,
      verifyToken: (adminToken) =>
        createAxisClient({
          adminToken,
          baseUrl: getRuntimeConfig().apiBaseUrl,
        }).verifyAdminToken(),
    });
    setIsVerifying(false);
    if (!result.authenticated) {
      setError(result.error);
      return;
    }
    setError("");
    navigate(from, { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
      <section className="grid w-full max-w-sm gap-5 rounded-lg border border-border bg-panel p-6 shadow-md">
        <div>
          <h1 className="text-xl font-semibold">Axis Repository</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to the admin console.</p>
        </div>
        {error && (
          <Alert className="border-destructive/35 bg-destructive/10 text-destructive">
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription className="text-destructive">{error}</AlertDescription>
          </Alert>
        )}
        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Admin token</span>
            <Input
              autoFocus
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Bearer token value"
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
