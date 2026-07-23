import type { PluginRepositoryConfigFieldManifest } from "@axis-repository/core/plugin-manifests";
import { Input } from "./components/ui/input";

export function RepositoryConfigFields({
  fields,
  values,
  onChange,
}: {
  fields: PluginRepositoryConfigFieldManifest[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  function update(field: string, value: string) {
    onChange({ ...values, [field]: value });
  }

  return (
    <div className="grid gap-4">
      {fields.map((field) => (
        <label key={field.name} className="grid gap-2">
          <span className="text-sm font-medium">{field.label}</span>
          {field.description && <span className="text-xs text-muted-foreground">{field.description}</span>}
          <Input
            value={values[field.name] ?? ""}
            onChange={(event) => update(field.name, event.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </label>
      ))}
    </div>
  );
}
