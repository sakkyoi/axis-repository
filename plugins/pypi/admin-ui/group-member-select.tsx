import {
  RepositoryMultiSelect,
  RepositoryMultiSelectView,
  type Repository,
  type RepositoryCreateFieldRendererProps,
} from "@axis-repository/admin-ui/plugin-ui";

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
  return (
    <RepositoryMultiSelect
      label="Members"
      description="PyPI hosted or proxy repositories, in resolution order."
      value={value}
      onChange={onChange}
      search={{
        ecosystem: "pypi",
        kinds: ["hosted", "proxy"],
        excludeNames: [repositoryName],
      }}
      showEcosystem={false}
      emptyMessage="Create a PyPI hosted or proxy repository before configuring this group."
    />
  );
}

export function PypiGroupMemberSelectView(
  { repositoryName: _repositoryName, ...props }: Omit<Parameters<typeof RepositoryMultiSelectView>[0], "label" | "description" | "emptyMessage" | "showEcosystem"> & {
    repositoryName?: string;
  },
) {
  return (
    <RepositoryMultiSelectView
      {...props}
      label="Members"
      description="PyPI hosted or proxy repositories, in resolution order."
      showEcosystem={false}
      emptyMessage="Create a PyPI hosted or proxy repository before configuring this group."
    />
  );
}

export type { Repository };

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
