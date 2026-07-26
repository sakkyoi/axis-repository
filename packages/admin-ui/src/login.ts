export interface AuthenticateAdminLoginInput {
  username: string;
  password: string;
  authenticate: (input: { username: string; password: string }) => Promise<{
    accessToken: string;
    accessTokenExpiresAt: string;
  }>;
  login: (accessToken: string, accessTokenExpiresAt: string) => void;
}

export type AuthenticateAdminLoginResult =
  | { authenticated: true }
  | { authenticated: false; error: string };

export async function authenticateAdminLogin(
  input: AuthenticateAdminLoginInput,
): Promise<AuthenticateAdminLoginResult> {
  const username = input.username.trim();
  if (!username) {
    return { authenticated: false, error: "Username is required." };
  }
  if (!input.password) {
    return { authenticated: false, error: "Password is required." };
  }

  try {
    const result = await input.authenticate({ username, password: input.password });
    input.login(result.accessToken, result.accessTokenExpiresAt);
  } catch {
    return { authenticated: false, error: "Username or password is invalid." };
  }
  return { authenticated: true };
}
