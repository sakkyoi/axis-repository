import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../auth";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

interface LoginLocationState {
  from?: string;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const from = (location.state as LoginLocationState | null)?.from ?? "/repositories";

  if (auth.isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Admin token is required.");
      return;
    }
    auth.login(trimmed);
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
          <Button type="submit">
            <LogIn className="mr-2 h-4 w-4" />
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}
