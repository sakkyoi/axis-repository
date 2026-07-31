export interface LeftoverBootstrapCredential {
  name: string;
  sensitive: boolean;
  removal: string;
}

/**
 * Whether this is worth saying on every page, or only where it is looked for.
 *
 * A leftover username is untidiness: it names an account that already exists,
 * nothing reads it, and nothing is exposed by it. Following the reader around
 * the application over that teaches them to ignore the banner, which is the
 * banner they need to read on the day a password is the thing left behind.
 */
export function leftoverNeedsBanner(credentials: readonly LeftoverBootstrapCredential[]): boolean {
  return credentials.some((credential) => credential.sensitive);
}

/** Reads as a sentence for one name, and for several. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The banner's own sentence, naming only what earned it.
 *
 * The username may well be left over too, but it is not why the reader is
 * being interrupted, and listing it here spends their attention on the part
 * that does not matter.
 */
export function leftoverBannerText(credentials: readonly LeftoverBootstrapCredential[]): string {
  const names = credentials.filter((credential) => credential.sensitive).map((credential) => credential.name);
  const verb = names.length === 1 ? "is" : "are";
  return `${joinNames(names)} ${verb} still set on this deployment.`;
}
