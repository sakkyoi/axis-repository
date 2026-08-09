import type { PluginRepositoryConfigFieldManifest } from "@axis-repository/core/plugin-manifests";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ErrorState } from "../../pages/shared";
import type { RepositoryCreateFieldRendererMap } from "../plugins/repository-ui-plugin-types";

export function RepositoryConfigFields({
  fields,
  repositoryName = "",
  values,
  fieldRenderers,
  onChange,
}: {
  fields: PluginRepositoryConfigFieldManifest[];
  repositoryName?: string;
  values: Record<string, string>;
  fieldRenderers: RepositoryCreateFieldRendererMap | undefined;
  onChange: (values: Record<string, string>) => void;
}) {
  function update(field: string, value: string) {
    onChange({ ...values, [field]: value });
  }

  return (
    <div className="grid gap-4">
      {fields.map((field) => {
        const FieldRenderer = fieldRenderers?.[field.kind];
        if (FieldRenderer) {
          return (
            <FieldRenderer
              key={field.name}
              field={field}
              repositoryName={repositoryName}
              value={values[field.name] ?? ""}
              onChange={(value) => update(field.name, value)}
              values={values}
              onValuesChange={onChange}
            />
          );
        }

        if (field.kind !== "text" && field.kind !== "select" && field.kind !== "string-list") {
          return (
            <ErrorState
              key={field.name}
              title="Unsupported config field"
              error={new Error(`${field.kind} is not supported by this admin UI plugin.`)}
            />
          );
        }

        return (
          <label key={field.name} className="grid gap-2">
            <span className="text-sm font-medium">{field.label}</span>
            {field.description && <span className="text-xs text-muted-foreground">{field.description}</span>}
            {field.kind === "select" ? (
              <Select
                value={values[field.name] ?? stringDefaultValue(field.defaultValue) ?? ""}
                onValueChange={(value) => update(field.name, value)}
                required={field.required}
              >
                <SelectTrigger>
                  <SelectValue placeholder={field.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={values[field.name] ?? ""}
                onChange={(event) => update(field.name, event.target.value)}
                placeholder={field.placeholder}
                required={field.required}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function stringDefaultValue(value: PluginRepositoryConfigFieldManifest["defaultValue"]): string | undefined {
  return typeof value === "string" ? value : undefined;
}
