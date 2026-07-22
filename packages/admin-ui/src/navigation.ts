export const ADMIN_UI_PATHS = {
  root: "/ui/",
  login: "/ui/login",
  repositories: "/ui/repositories",
  tokens: "/ui/tokens",
  signingKeys: "/ui/signing-keys",
  settings: "/ui/settings",
} as const;

export const ADMIN_UI_NAV_ITEMS = [
  { id: "repositories", to: ADMIN_UI_PATHS.repositories, label: "Repositories" },
  { id: "tokens", to: ADMIN_UI_PATHS.tokens, label: "Tokens" },
  { id: "signingKeys", to: ADMIN_UI_PATHS.signingKeys, label: "Signing Keys" },
  { id: "settings", to: ADMIN_UI_PATHS.settings, label: "Settings" },
] as const;

export function adminLoginPathFor(from: string) {
  return {
    pathname: ADMIN_UI_PATHS.login,
    state: { from },
  };
}
