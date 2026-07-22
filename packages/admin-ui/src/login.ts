export interface AuthenticateAdminLoginInput {
  token: string;
  verifyToken: (token: string) => Promise<void>;
  login: (token: string) => void;
}

export type AuthenticateAdminLoginResult =
  | { authenticated: true }
  | { authenticated: false; error: string };

export async function authenticateAdminLogin(
  input: AuthenticateAdminLoginInput,
): Promise<AuthenticateAdminLoginResult> {
  const trimmed = input.token.trim();
  if (!trimmed) {
    return { authenticated: false, error: "Admin token is required." };
  }

  try {
    await input.verifyToken(trimmed);
  } catch {
    return { authenticated: false, error: "Admin token is invalid." };
  }

  input.login(trimmed);
  return { authenticated: true };
}
