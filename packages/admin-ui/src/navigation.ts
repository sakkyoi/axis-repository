export const ADMIN_UI_PATHS = {
  root: "/ui/",
  login: "/ui/login",
  repositories: "/ui/repositories",
  newRepository: "/ui/repositories/new",
  repositoryWorkspace: "/ui/repositories/:name",
  repositorySettings: "/ui/repositories/:name/settings",
  tokens: "/ui/tokens",
  settings: "/ui/settings",
} as const;

export const ADMIN_UI_NAV_ITEMS = [
  { id: "repositories", to: ADMIN_UI_PATHS.repositories, label: "Repositories" },
  { id: "tokens", to: ADMIN_UI_PATHS.tokens, label: "Tokens" },
  { id: "settings", to: ADMIN_UI_PATHS.settings, label: "Settings" },
] as const;

export function adminLoginPathFor(from: string) {
  return {
    pathname: ADMIN_UI_PATHS.login,
    state: { from },
  };
}

export function repositoryWorkspacePath(name: string): string {
  return `${ADMIN_UI_PATHS.repositories}/${encodeURIComponent(name)}`;
}

export function repositorySettingsPath(name: string): string {
  return `${repositoryWorkspacePath(name)}/settings`;
}
