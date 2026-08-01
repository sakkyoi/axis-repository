import type { BootstrapCredentialField } from "@axis-repository/core";

/**
 * A bootstrap credential a deployment is still carrying, and what to do about
 * it.
 *
 * How to be rid of one depends on where a deployment declares it, and the two
 * are not interchangeable: a secret is deleted from the deployment itself and
 * leaves no trace in the repository, while a plain variable is written down in
 * `wrangler.jsonc` and comes back on the next deploy unless it is removed
 * there. Telling an operator to delete a secret that is actually a variable
 * sends them somewhere it is not.
 */
export interface LeftoverBootstrapCredential {
  name: string;
  /**
   * Whether leaving it behind is a security problem rather than untidiness.
   *
   * The username is only redundant: it names an account that already exists,
   * and changing it now renames nothing. The password is the account's original
   * password, readable to anyone who can see the deployment's configuration and
   * unaffected by changing the password in the admin UI.
   */
  sensitive: boolean;
  /** Where to go to remove it. */
  removal: string;
  /** The same thing to run rather than to read. */
  command: string;
}

const SECRET_REMOVAL = "Deleted from the Worker's Settings > Variables and Secrets, or from the"
  + " command line.";

/**
 * The username is asked for as a plain variable, which is written into
 * wrangler.jsonc rather than set on the Worker -- so removing it in the
 * dashboard lasts until the next deploy puts it back.
 *
 * Deployments made before it became a variable hold it as a secret instead,
 * and `env` reads the same either way: nothing here can tell which one this
 * deployment did, so both are offered rather than guessed at.
 */
const VARIABLE_REMOVAL = "Declared as a plain variable, so it is removed from `vars` in"
  + " wrangler.jsonc and deployed again -- removing it only in the dashboard lets the next"
  + " deploy put it back. A deployment set up before it became a variable holds it as a"
  + " secret instead, which is deleted rather than edited.";

const secretCommand = (name: string): string => `wrangler secret delete ${name}`;

const CREDENTIAL_VARIABLES: Record<BootstrapCredentialField, LeftoverBootstrapCredential> = {
  password: {
    name: "AXIS_ADMIN_PASSWORD",
    sensitive: true,
    removal: SECRET_REMOVAL,
    command: secretCommand("AXIS_ADMIN_PASSWORD"),
  },
  // A hash rather than the password itself, so not readable at a glance -- but
  // it is still the account's credential, offline and unsalted against whoever
  // holds it, and nothing reads it any more either.
  passwordHash: {
    name: "AXIS_ADMIN_PASSWORD_HASH",
    sensitive: true,
    removal: SECRET_REMOVAL,
    command: secretCommand("AXIS_ADMIN_PASSWORD_HASH"),
  },
  username: {
    name: "AXIS_ADMIN_USERNAME",
    sensitive: false,
    removal: VARIABLE_REMOVAL,
    command: "# Remove AXIS_ADMIN_USERNAME from \"vars\" in wrangler.jsonc, then\n"
      + "wrangler deploy\n\n"
      + "# Or, if this deployment set it as a secret:\n"
      + `${secretCommand("AXIS_ADMIN_USERNAME")}`,
  },
};

/** Names what the auth service reported, in the order it is worth acting on. */
export function leftoverBootstrapCredentials(
  fields: readonly BootstrapCredentialField[],
): LeftoverBootstrapCredential[] {
  return fields
    .map((field) => CREDENTIAL_VARIABLES[field])
    .sort((left, right) => Number(right.sensitive) - Number(left.sensitive));
}

/**
 * One line for the Worker's log, or nothing when there is nothing to say.
 *
 * Logged as well as shown, because the admin UI is not where an operator
 * finds out that a deployment needs attention -- it is where they go once they
 * already suspect it.
 */
export function leftoverBootstrapWarning(
  credentials: readonly LeftoverBootstrapCredential[],
): string | undefined {
  if (credentials.length === 0) {
    return undefined;
  }
  const names = credentials.map((credential) => credential.name).join(", ");
  const unread = credentials.length === 1 ? "it is" : "they are";
  const line = `Bootstrap credentials left on this deployment: ${names}.`
    + ` The admin account they seeded already exists, so ${unread} no longer read.`;
  const sensitive = credentials.filter((credential) => credential.sensitive);
  if (sensitive.length === 0) {
    return line;
  }
  const held = sensitive.length === 1 ? "credential is" : "credentials are";
  return `${line} Until removed, the account's original ${held} still readable`
    + " from this deployment's configuration.";
}

export function formatBootstrapWarningLog(message: string): string {
  const [first = "", ...rest] = wrapLogMessage(message, 88);
  return [
    `[warn] ⚠ ${first}`,
    ...rest.map((line) => `       ${line}`),
  ].join("\n");
}

function wrapLogMessage(message: string, width: number): string[] {
  const words = message.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
      continue;
    }
    current = `${current} ${word}`;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}
