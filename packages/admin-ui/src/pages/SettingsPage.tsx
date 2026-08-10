import { useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { EnvironmentSettings } from "../settings/environment-settings";
import { RepositoryPluginSettings } from "../settings/repository-plugin-settings";
import { RuntimePolicySettings } from "../settings/runtime-policy-settings";
import { PageShell } from "./shared";

type SettingsTab = "runtime-policy" | "repository-plugins" | "environment";

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = settingsTabFromQuery(searchParams.get("tab"));

  return (
    <PageShell
      title="Settings"
      description="Runtime policy, repository plugin governance, and deployment environment details."
    >
      <Tabs
        value={currentTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "runtime-policy") {
            next.delete("tab");
          } else {
            next.set("tab", value);
          }
          setSearchParams(next, { replace: true });
        }}
        className="min-h-0"
      >
        <TabsList>
          <TabsTrigger value="runtime-policy">Runtime policy</TabsTrigger>
          <TabsTrigger value="repository-plugins">Repository plugins</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
        </TabsList>
        <TabsContent value="runtime-policy">
          <RuntimePolicySettings />
        </TabsContent>
        <TabsContent value="repository-plugins">
          <RepositoryPluginSettings />
        </TabsContent>
        <TabsContent value="environment">
          <EnvironmentSettings />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function settingsTabFromQuery(value: string | null): SettingsTab {
  if (value === "repository-plugins" || value === "environment") {
    return value;
  }
  return "runtime-policy";
}
