import { Package } from "lucide-react";
import { useRepositoryArtifacts } from "../../api/hooks";
import type { RepositoryArtifact } from "../../api/schemas";
import { ErrorState } from "../../pages/shared";
import type { RepositoryDetailSectionProps } from "../plugins/repository-ui-plugin-types";

export function RepositoryArtifactsSection({ repository }: RepositoryDetailSectionProps) {
  const artifacts = useRepositoryArtifacts(repository.name);
  const rows = artifacts.data?.artifacts ?? [];

  return (
    <div className="min-h-0 overflow-hidden rounded-md border border-border bg-background/40">
      {artifacts.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading artifacts...</div>}
      {artifacts.isError && <div className="p-3"><ErrorState title="Repository artifacts unavailable" error={artifacts.error} /></div>}
      {!artifacts.isLoading && !artifacts.isError && rows.length === 0 && (
        <div className="grid min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
          No artifacts have been published yet.
        </div>
      )}
      {!artifacts.isLoading && !artifacts.isError && rows.length > 0 && (
        <RepositoryArtifactsTable artifacts={rows} />
      )}
    </div>
  );
}

function RepositoryArtifactsTable({ artifacts }: { artifacts: RepositoryArtifact[] }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full min-w-[42rem] table-fixed text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-[34%] px-3 py-2 font-medium">Artifact</th>
            <th className="w-[14%] px-3 py-2 font-medium">Version</th>
            <th className="w-[16%] px-3 py-2 font-medium">Ecosystem</th>
            <th className="w-[20%] px-3 py-2 font-medium">Published</th>
            <th className="w-[16%] px-3 py-2 font-medium">Objects</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <tr key={artifact.id} className="border-t border-border">
              <td className="min-w-0 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{artifact.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{artifact.summary}</div>
                  </div>
                </div>
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{artifact.version ?? "-"}</td>
              <td className="truncate px-3 py-2 text-muted-foreground">{artifact.ecosystem}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">{artifact.publishedAt}</td>
              <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                {artifact.objectKeys.length === 1 ? "1 object" : `${artifact.objectKeys.length} objects`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
