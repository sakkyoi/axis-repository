import { useId, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { useRepositorySearch } from "../api/hooks";
import type { ListRepositoriesOptions } from "../api/client";
import type { Repository } from "../api/schemas";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../pages/shared";
import { Skeleton } from "../components/ui/skeleton";

const DEFAULT_REPOSITORY_SEARCH_LIMIT = 20;

export interface RepositoryMultiSelectProps {
  label: string;
  description?: string;
  value: string[];
  onChange: (repositories: string[]) => void;
  onRepositorySelectionChange?: (repository: Repository, selected: boolean) => void;
  search?: Omit<ListRepositoriesOptions, "query">;
  placeholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  showEcosystem?: boolean;
}

export function RepositoryMultiSelect({
  label,
  description,
  value,
  onChange,
  onRepositorySelectionChange,
  search: searchOptions = {},
  placeholder = "Select repositories",
  emptyMessage = "No repositories are available.",
  noResultsMessage = "No repositories match the search.",
  showEcosystem = true,
}: RepositoryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRepositorySearch({
    ...searchOptions,
    limit: searchOptions.limit ?? DEFAULT_REPOSITORY_SEARCH_LIMIT,
    query,
  }, open);
  return (
    <RepositoryMultiSelectView
      label={label}
      {...(description ? { description } : {})}
      repositories={search.data ?? []}
      value={value}
      onChange={onChange}
      {...(onRepositorySelectionChange ? { onRepositorySelectionChange } : {})}
      loading={search.isLoading}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      placeholder={placeholder}
      emptyMessage={emptyMessage}
      noResultsMessage={noResultsMessage}
      showEcosystem={showEcosystem}
    />
  );
}

export function RepositoryMultiSelectView({
  label,
  description,
  repositories,
  value,
  onChange,
  onRepositorySelectionChange,
  loading = false,
  open,
  onOpenChange,
  query,
  onQueryChange,
  placeholder = "Select repositories",
  emptyMessage = "No repositories are available.",
  noResultsMessage = "No repositories match the search.",
  showEcosystem = true,
}: Omit<RepositoryMultiSelectProps, "search"> & {
  repositories: Repository[];
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const labelId = useId();
  const listboxId = useId();
  const selected = useMemo(() => new Set(value), [value]);
  const options = useMemo(() => [...repositories]
    .sort((left, right) => left.name.localeCompare(right.name)), [repositories]);

  function toggle(name: string, repository?: Repository) {
    const nextSelected = !selected.has(name);
    onChange(nextSelected
      ? [...value, name]
      : value.filter((member) => member !== name));
    if (repository) {
      onRepositorySelectionChange?.(repository, nextSelected);
    }
  }

  return (
    <div className="grid gap-2">
      <span id={labelId} className="text-sm font-medium">{label}</span>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
      <div
        className="relative z-20"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            onOpenChange(false);
          }
        }}
      >
        <div className="flex min-h-10 w-full min-w-0 items-start gap-2 rounded-md border border-input bg-panel px-2 py-1.5 text-sm text-foreground outline-none focus-within:ring-2 focus-within:ring-ring">
          <Search className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {value.map((repositoryName) => (
              <span
                key={repositoryName}
                className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
              >
                <span className="truncate">{repositoryName}</span>
                <button
                  type="button"
                  className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${repositoryName}`}
                  onClick={() => toggle(repositoryName)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="flex min-w-36 flex-1 items-center">
              <input
                className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                value={query}
                placeholder={placeholder}
                aria-label={placeholder}
                aria-labelledby={labelId}
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                role="combobox"
                onFocus={() => onOpenChange(true)}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                  onOpenChange(true);
                }}
              />
            </div>
          </div>
        </div>
        {open && (
          <div className="absolute z-50 mt-2 w-full min-w-64 overflow-hidden rounded-md border border-border bg-panel text-panel-foreground shadow-md">
            <div id={listboxId} role="listbox" aria-labelledby={labelId} className="max-h-56 overflow-y-auto p-1">
              {options.map((repository) => (
                <div
                  key={repository.name}
                  role="option"
                  aria-label={`Select ${repository.name}`}
                  aria-selected={selected.has(repository.name)}
                  tabIndex={-1}
                  className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm bg-panel px-2 py-1.5 text-sm outline-none hover:bg-muted"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => toggle(repository.name, repository)}
                >
                  <Check
                    aria-hidden="true"
                    className={selected.has(repository.name) ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 opacity-0"}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{repository.name}</span>
                  <Badge className="shrink-0">{repository.kind}</Badge>
                  {showEcosystem && <span className="shrink-0 text-xs text-muted-foreground">{repository.ecosystem}</span>}
                </div>
              ))}
              {!loading && options.length === 0 && !query.trim() && (
                <EmptyState message={emptyMessage} />
              )}
              {!loading && options.length === 0 && query.trim() && (
                <EmptyState message={noResultsMessage} />
              )}
              {loading && (
                <div className="grid gap-1 p-1" role="status" aria-busy="true" aria-label="Loading">
                  {Array.from({ length: 2 }, (_, row) => (
                    <div key={row} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
                      <Skeleton className="h-4 w-4 shrink-0" />
                      <Skeleton className="h-4 min-w-0 flex-1" />
                      <Skeleton className="h-5 w-12 shrink-0 rounded-md" />
                      {showEcosystem && <Skeleton className="h-4 w-12 shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
