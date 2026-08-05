import type { Repository } from "@axis-repository/core";
import type { RepositoryClientHelperActionDescriptor, RepositoryClientHelpers } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { pypiPluginManifest } from "../manifest";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function simpleUrl(origin: string, repository: Repository): string {
  return `${origin.replace(/\/+$/g, "")}/repositories/${repository.name}/simple/`;
}

function pypiClientHelperAction(name: string) {
  const action = pypiPluginManifest.clientHelpers.actions.find((candidate) => candidate.name === name);
  if (!action) {
    throw new Error(`PyPI client helper manifest is not configured: ${name}`);
  }
  return { ...action };
}

function uploadUrl(origin: string, repository: Repository): string {
  return `${origin.replace(/\/+$/g, "")}/repositories/${repository.name}/legacy/`;
}

export function createPypiClientHelpers(input: { includeUpload?: boolean } = {}): RepositoryClientHelpers {
  const includeUpload = input.includeUpload ?? true;
  const actions: RepositoryClientHelperActionDescriptor[] = [
    {
      ...pypiClientHelperAction("simple-url"),
      handle: async ({ repository, origin }) => {
        const url = simpleUrl(origin, repository);
        return jsonResponse({
          repository: repository.name,
          ecosystem: "pypi",
          simpleUrl: url,
          pipIndexUrl: url,
        });
      },
    },
  ];
  if (includeUpload) {
    actions.push({
      ...pypiClientHelperAction("twine-config"),
      handle: async ({ repository, origin }) => {
        const url = uploadUrl(origin, repository);
        return jsonResponse({
          repository: repository.name,
          ecosystem: "pypi",
          uploadUrl: url,
          // twine reads ~/.pypirc; Axis publish tokens use this fixed
          // username and put the token in as the password.
          pypirc: [
            "[distutils]",
            `index-servers = ${repository.name}`,
            "",
            `[${repository.name}]`,
            `repository = ${url}`,
            "username = axis",
            "password = <PUBLISH_TOKEN>",
            "",
          ].join("\n"),
        });
      },
    });
  }
  return {
    namespace: pypiPluginManifest.clientHelpers.namespace,
    actions,
  };
}
