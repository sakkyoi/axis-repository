import type { PluginRepositoryConfigFieldManifest } from "@axis-repository/core/plugin-manifests";
import { ErrorState } from "../../pages/shared";
import type { RepositoryCreateFieldRendererMap } from "../plugins/repository-ui-plugin-types";

export function RepositoryDependencyFields({
  fields,
  repositoryName,
  values,
  fieldRenderers,
  onChange,
}: {
  fields: PluginRepositoryConfigFieldManifest[];
  repositoryName: string;
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
            />
          );
        }

        return (
          <ErrorState
            key={field.name}
            title="Unsupported dependency field"
            error={new Error(`${field.kind} is not supported by this admin UI plugin.`)}
          />
        );
      })}
    </div>
  );
}
