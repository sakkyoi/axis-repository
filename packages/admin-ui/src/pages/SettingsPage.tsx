import { FormEvent, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  clearAdminToken,
  getAdminToken,
  getApiBaseUrl,
  setAdminToken,
  setApiBaseUrl,
} from "../settings";

export function SettingsPage() {
  const [adminToken, setAdminTokenValue] = useState(getAdminToken());
  const [apiBaseUrl, setApiBaseUrlValue] = useState(getApiBaseUrl());
  const [savedAt, setSavedAt] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    setAdminToken(window.localStorage, adminToken);
    setApiBaseUrl(window.localStorage, apiBaseUrl);
    setSavedAt(new Date().toLocaleTimeString());
  }

  function clearToken() {
    clearAdminToken();
    setAdminTokenValue("");
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <section className="grid max-w-3xl gap-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the browser-side admin token and API target for this console.
        </p>
      </div>
      <form className="grid gap-4 rounded-lg border border-border bg-panel p-5" onSubmit={save}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Admin token</span>
          <Input
            type="password"
            value={adminToken}
            onChange={(event) => setAdminTokenValue(event.target.value)}
            placeholder="Bearer token value"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium">API base URL</span>
          <Input
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrlValue(event.target.value)}
            placeholder="Same origin"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit">Save settings</Button>
          <Button type="button" variant="outline" onClick={clearToken}>
            Clear token
          </Button>
          {savedAt && <span className="text-sm text-muted-foreground">Saved at {savedAt}</span>}
        </div>
      </form>
    </section>
  );
}
