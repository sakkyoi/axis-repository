import type { ComponentType } from "react";
import type { Repository, RepositoryPlugin } from "./api/schemas";
import { AptRepositoryDetail } from "./plugins/apt/detail";
import { PypiRepositoryDetail, pypiInstallCommandText, pypiSimpleIndexUrl } from "./plugins/pypi/detail";
import { GenericRepositoryDetail, repositoryClientHelperDisplayText } from "./repository-detail-shared";

export interface RepositoryDetailPlugin {
  ecosystem: string;
  displayName: string;
  Detail: ComponentType<{ repository: Repository; pluginMetadata: RepositoryPlugin | undefined }>;
}

export const aptRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: "apt",
  displayName: "APT",
  Detail: AptRepositoryDetail,
};

export const pypiRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: "pypi",
  displayName: "PyPI",
  Detail: PypiRepositoryDetail,
};

export const repositoryDetailPlugins = [aptRepositoryDetailPlugin, pypiRepositoryDetailPlugin] as const;

export function getRepositoryDetailPlugin(ecosystem: string): RepositoryDetailPlugin | undefined {
  return repositoryDetailPlugins.find((plugin) => plugin.ecosystem === ecosystem);
}

export {
  GenericRepositoryDetail,
  pypiInstallCommandText,
  pypiSimpleIndexUrl,
  repositoryClientHelperDisplayText,
};
