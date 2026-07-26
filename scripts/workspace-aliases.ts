import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface WorkspaceAlias {
  find: string;
  replacement: string;
}

interface TsconfigBase {
  compilerOptions?: { paths?: Record<string, string[]> };
}

/**
 * Derives bundler aliases from the `paths` in tsconfig.base.json.
 *
 * That file is the single declaration of where each workspace entrypoint lives.
 * Vite and Vitest previously repeated the same map, so adding a plugin meant
 * editing three files and any drift only surfaced at run time.
 *
 * Longer specifiers are emitted first because alias matching is prefix-based:
 * `@axis-repository/core` would otherwise shadow
 * `@axis-repository/core/plugin-manifests`.
 */
export function workspaceAliases(repoRootUrl: URL): WorkspaceAlias[] {
  const tsconfig = JSON.parse(
    readFileSync(new URL("tsconfig.base.json", repoRootUrl), "utf8"),
  ) as TsconfigBase;
  const paths = tsconfig.compilerOptions?.paths ?? {};

  return Object.entries(paths)
    .sort(([left], [right]) => right.length - left.length)
    .map(([specifier, targets]) => {
      const target = targets[0];
      if (!target) {
        throw new Error(`tsconfig.base.json path has no target: ${specifier}`);
      }
      return { find: specifier, replacement: fileURLToPath(new URL(target, repoRootUrl)) };
    });
}
