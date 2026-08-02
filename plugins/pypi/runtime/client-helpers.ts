import type { Repository } from "@axis-repository/core";
import type { RepositoryClientHelpers } from "@axis-repository/runtime-cloudflare/plugin-runtime";
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

export function createPypiClientHelpers(): RepositoryClientHelpers {
  return {
    namespace: pypiPluginManifest.clientHelpers.namespace,
    actions: [
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
      {
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
      },
    ],
  };
}
