import type { Repository } from "../../api/schemas";

export function initialRepositorySelection(_repositories: Repository[]): string | undefined {
  return undefined;
}

export function repositoryRowStateClass(repositoryName: string, selectedName: string | undefined): string {
  return repositoryName === selectedName
    ? "border-l-4 border-l-primary bg-primary/10 hover:bg-primary/15"
    : "border-l-4 border-l-transparent hover:bg-muted/60";
}

export function repositoryDetailBodyClass(): string {
  return "grid h-full min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden p-4";
}

export function repositoryListEmptyClass(): string {
  return "grid h-full min-h-0 p-3";
}

export function repositoryListEmptyPanelClass(): string {
  return "grid h-full min-h-0 place-items-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground";
}

export function repositorySummaryItems(repository: Repository): Array<[string, string]> {
  return [
    ["Ecosystem", repository.ecosystem],
    ["Visibility", repository.visibility],
    ["Created", repository.createdAt],
    ["Updated", repository.updatedAt],
  ];
}
