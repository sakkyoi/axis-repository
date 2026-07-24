import { NotFoundError, type Repository } from "@axis-repository/core";
import type {
  PluginClientHelperActionManifest,
  PluginClientHelperResponseKind,
} from "@axis-repository/core/plugin-manifests";

export type RepositoryClientHelperResponseKind = PluginClientHelperResponseKind;
export type RepositoryClientHelperAction = PluginClientHelperActionManifest;

export interface RepositoryClientHelperContext {
  origin: string;
}

export interface RepositoryClientHelperInput extends RepositoryClientHelperContext {
  repository: Repository;
  action: string;
}

export type RepositoryClientHelperActionHandlerInput = Omit<RepositoryClientHelperInput, "action">;

export interface RepositoryClientHelperActionDescriptor extends RepositoryClientHelperAction {
  handle(input: RepositoryClientHelperActionHandlerInput): Promise<Response>;
}

export interface RepositoryClientHelpers {
  namespace: string;
  actions: RepositoryClientHelperActionDescriptor[];
}

export function publicClientHelperAction(
  action: RepositoryClientHelperActionDescriptor,
): RepositoryClientHelperAction {
  return {
    name: action.name,
    label: action.label,
    responseKind: action.responseKind,
    defaultOpen: action.defaultOpen,
    public: action.public,
    ...(action.displayPath === undefined ? {} : { displayPath: action.displayPath }),
  };
}

export async function dispatchRepositoryClientHelper(
  clientHelpers: RepositoryClientHelpers,
  input: RepositoryClientHelperInput,
): Promise<Response> {
  const action = clientHelpers.actions.find((candidate) => candidate.name === input.action);
  if (!action) {
    throw new NotFoundError(`Repository client helper is not configured: ${input.action}`);
  }
  return action.handle({
    repository: input.repository,
    origin: input.origin,
  });
}
