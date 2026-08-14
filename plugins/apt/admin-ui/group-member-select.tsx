import {
  RepositoryMultiSelect,
  type RepositoryCreateFieldRendererProps,
} from "@axis-repository/admin-ui/plugin-ui";

export function AptGroupMemberSelectField({
  repositoryName,
  value,
  onChange,
}: RepositoryCreateFieldRendererProps) {
  return (
    <AptGroupMemberSelect
      repositoryName={repositoryName}
      value={parseAptGroupMemberValue(value)}
      onChange={(members) => onChange(serializeAptGroupMembers(members))}
    />
  );
}

export function AptGroupMemberSelect({
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
      description="APT hosted or proxy repositories, in resolution order."
      value={value}
      onChange={onChange}
      search={{
        ecosystem: "apt",
        kinds: ["hosted", "proxy"],
        excludeNames: [repositoryName],
      }}
      showEcosystem={false}
      emptyMessage="Create an APT hosted or proxy repository before configuring this group."
    />
  );
}

export function parseAptGroupMemberValue(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return uniqueNonEmpty(value);
  }
  return uniqueNonEmpty(value.split(/[\n,]/u));
}

export function serializeAptGroupMembers(members: string[]): string {
  return uniqueNonEmpty(members).join("\n");
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
