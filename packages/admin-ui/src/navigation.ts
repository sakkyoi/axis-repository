export const ADMIN_UI_PATHS = {
  root: "/ui/",
  login: "/ui/login",
  repositories: "/ui/repositories",
  newRepository: "/ui/repositories/new",
  repositoryWorkspace: "/ui/repositories/:name",
  repositorySettings: "/ui/repositories/:name/settings",
  tokens: "/ui/tokens",
  users: "/ui/users",
  profile: "/ui/profile",
  settings: "/ui/settings",
} as const;

export const ADMIN_UI_NAV_ITEMS = [
  { id: "repositories", to: ADMIN_UI_PATHS.repositories, label: "Repositories" },
  { id: "tokens", to: ADMIN_UI_PATHS.tokens, label: "Tokens" },
  { id: "users", to: ADMIN_UI_PATHS.users, label: "Users" },
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

/**
 * Constrains a post-login redirect to a path inside the admin UI.
 *
 * The target arrives as router state, so a value that escaped the app — an
 * absolute URL, a protocol-relative `//host` path, or anything outside the
 * admin namespace — must not be navigated to.
 */
export function safeAdminRedirectPath(from: unknown): string {
  if (typeof from !== "string") {
    return ADMIN_UI_PATHS.repositories;
  }
  const target = from.trim();
  if (!target.startsWith(ADMIN_UI_PATHS.root) || target.startsWith("//")) {
    return ADMIN_UI_PATHS.repositories;
  }
  if (target.includes("\\") || target.includes("://")) {
    return ADMIN_UI_PATHS.repositories;
  }
  return target;
}
