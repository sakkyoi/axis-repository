import { useId, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import {
  Badge,
  EmptyState,
  SkeletonRows,
  Skeleton,
  useRepositorySearch,
  type Repository,
  type RepositoryCreateFieldRendererProps,
} from "@axis-repository/admin-ui/plugin-ui";

const REPOSITORY_SEARCH_LIMIT = 20;

export function PypiGroupMemberSelectField({
  repositoryName,
  value,
  onChange,
}: RepositoryCreateFieldRendererProps) {
  return (
    <PypiGroupMemberSelect
      repositoryName={repositoryName}
      value={parsePypiGroupMemberValue(value)}
      onChange={(members) => onChange(serializePypiGroupMembers(members))}
    />
  );
}

export function PypiGroupMemberSelect({
  repositoryName,
  value,
  onChange,
}: {
  repositoryName: string;
  value: string[];
  onChange: (members: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRepositorySearch({
    ecosystem: "pypi",
    kinds: ["hosted", "proxy"],
    excludeNames: [repositoryName],
    limit: REPOSITORY_SEARCH_LIMIT,
    query,
  }, open);
  return (
    <PypiGroupMemberSelectView
      repositoryName={repositoryName}
      repositories={search.data ?? []}
      value={value}
      onChange={onChange}
      loading={search.isLoading}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
    />
  );
}

export function PypiGroupMemberSelectView({
  repositoryName,
  repositories,
  value,
  onChange,
  loading = false,
  open,
  onOpenChange,
  query,
  onQueryChange,
}: {
  repositoryName: string;
  repositories: Repository[];
  value: string[];
  onChange: (members: string[]) => void;
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const labelId = useId();
  const listboxId = useId();
  const selected = useMemo(() => new Set(value), [value]);
  const options = useMemo(() => repositories
    .filter((repository) => repository.name !== repositoryName)
    .sort((left, right) => left.name.localeCompare(right.name)), [repositories, repositoryName]);

  function toggle(name: string) {
    onChange(selected.has(name)
      ? value.filter((member) => member !== name)
      : [...value, name]);
  }

  return (
    <div className="grid gap-2">
      <span id={labelId} className="text-sm font-medium">Members</span>
      <span className="text-xs text-muted-foreground">PyPI hosted or proxy repositories, in resolution order.</span>
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            onOpenChange(false);
          }
        }}
      >
        <div className="flex min-h-10 w-full min-w-0 items-start gap-2 rounded-md border border-input bg-panel px-2 py-1.5 text-sm text-foreground outline-none focus-within:ring-2 focus-within:ring-ring">
          <Search className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {value.map((member) => (
              <span
                key={member}
                className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
              >
                <span className="truncate">{member}</span>
                <button
                  type="button"
                  className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${member}`}
                  onClick={() => toggle(member)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="flex min-w-36 flex-1 items-center">
              <input
                className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                value={query}
                placeholder="Select repositories"
                aria-label="Select repositories"
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
          <div className="absolute z-50 mt-2 w-full min-w-64 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            <div id={listboxId} role="listbox" aria-labelledby={labelId} className="max-h-56 overflow-y-auto p-1">
              {options.map((repository) => (
                <div
                  key={repository.name}
                  role="option"
                  aria-label={`Select ${repository.name}`}
                  aria-selected={selected.has(repository.name)}
                  tabIndex={-1}
                  className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    toggle(repository.name);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={selected.has(repository.name) ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 opacity-0"}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{repository.name}</span>
                  <Badge className="shrink-0">{repository.kind}</Badge>
                </div>
              ))}
              {!loading && options.length === 0 && !query.trim() && (
                <EmptyState message="Create a PyPI hosted or proxy repository before configuring this group." />
              )}
              {!loading && options.length === 0 && query.trim() && (
                <EmptyState message="No repositories match the search." />
              )}
              {loading && (
                <div className="grid gap-1 p-1" role="status" aria-busy="true" aria-label="Loading">
                  {Array.from({ length: 2 }, (_, row) => (
                    <div key={row} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
                      <Skeleton className="h-4 w-4 shrink-0" />
                      <Skeleton className="h-4 min-w-0 flex-1" />
                      <Skeleton className="h-5 w-12 shrink-0 rounded-md" />
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

export function parsePypiGroupMemberValue(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return uniqueNonEmpty(value);
  }
  return uniqueNonEmpty(value.split(/[\n,]/u));
}

export function serializePypiGroupMembers(members: string[]): string {
  return uniqueNonEmpty(members).join("\n");
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
