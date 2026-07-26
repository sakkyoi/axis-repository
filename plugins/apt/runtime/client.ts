export interface AptClientRepositoryInfo {
  name: string;
  visibility: "private" | "public";
  codename: string;
  suites: string[];
  components: string[];
}

export interface AptSourceInfo {
  repository: string;
  ecosystem: "apt";
  baseUrl: string;
  /** The suite a client gets when it does not choose one. */
  codename: string;
  suites: string[];
  components: string[];
  keyringPath: string;
  /** The sources.list line for the default suite. */
  sourceLine: string;
  /** One line per suite, in the order the repository declares them. */
  sourceLines: string[];
}

export interface AptInstallInfo {
  repository: string;
  visibility: "private" | "public";
  keyUrl: string;
  keyringPath: string;
  sourceListPath: string;
  sourceLine: string;
  sourceLines: string[];
  script: string;
  commands: string[];
  authConfPath?: string;
  authConfTemplate?: string;
}

function baseRepositoryUrl(origin: string, repositoryName: string): string {
  return `${origin.replace(/\/+$/g, "")}/repositories/${repositoryName}`;
}

export function keyringPathForRepository(repositoryName: string): string {
  return `/usr/share/keyrings/axis-${repositoryName}.gpg`;
}

export function sourceListPathForRepository(repositoryName: string): string {
  return `/etc/apt/sources.list.d/axis-${repositoryName}.list`;
}

export function authConfPathForRepository(repositoryName: string): string {
  return `/etc/apt/auth.conf.d/axis-${repositoryName}.conf`;
}

export function buildAptSourceInfo(input: {
  origin: string;
  repository: AptClientRepositoryInfo;
}): AptSourceInfo {
  const baseUrl = baseRepositoryUrl(input.origin, input.repository.name);
  const keyringPath = keyringPathForRepository(input.repository.name);
  const components = [...input.repository.components];
  const suites = input.repository.suites.length > 0 ? [...input.repository.suites] : [input.repository.codename];
  const sourceLineFor = (suite: string) =>
    `deb [signed-by=${keyringPath}] ${baseUrl} ${suite} ${components.join(" ")}`;

  return {
    repository: input.repository.name,
    ecosystem: "apt",
    baseUrl,
    codename: input.repository.codename,
    suites,
    components,
    keyringPath,
    sourceLine: sourceLineFor(input.repository.codename),
    sourceLines: suites.map(sourceLineFor),
  };
}

function buildAptInstallScript(install: Omit<AptInstallInfo, "script">): string {
  const sections: string[][] = [];
  if (install.authConfPath && install.authConfTemplate) {
    sections.push([
      "# Configure credentials for private repository access.",
      `sudo tee ${install.authConfPath} <<'EOF'`,
      install.authConfTemplate.trimEnd(),
      "EOF",
    ]);
  }
  sections.push(
    [
      "# Install the repository signing key.",
      install.commands[0]!,
    ],
    [
      "# Configure APT to use this repository.",
      install.commands[1]!,
    ],
    [
      "# Refresh package indexes.",
      install.commands[2]!,
    ],
  );
  return sections.map((section) => section.join("\n")).join("\n\n");
}

export function buildAptInstallInfo(input: {
  origin: string;
  repository: AptClientRepositoryInfo;
}): AptInstallInfo {
  const source = buildAptSourceInfo(input);
  const keyUrl = `${source.baseUrl}/apt/key.gpg`;
  const sourceListPath = sourceListPathForRepository(input.repository.name);
  // Every suite goes into the one sources.list file, so a repository that
  // publishes several is configured by a single copy-and-paste.
  const sourceListBody = source.sourceLines.join("\n");
  const install: Omit<AptInstallInfo, "script"> = {
    repository: input.repository.name,
    visibility: input.repository.visibility,
    keyUrl,
    keyringPath: source.keyringPath,
    sourceListPath,
    sourceLine: source.sourceLine,
    sourceLines: [...source.sourceLines],
    commands: [
      `curl -fsSL ${keyUrl} | sudo gpg --dearmor -o ${source.keyringPath}`,
      source.sourceLines.length === 1
        ? `echo '${source.sourceLine}' | sudo tee ${sourceListPath}`
        : `sudo tee ${sourceListPath} <<'EOF'\n${sourceListBody}\nEOF`,
      "sudo apt update",
    ],
  };
  if (input.repository.visibility === "private") {
    const privateInstall = {
      ...install,
      authConfPath: authConfPathForRepository(input.repository.name),
      authConfTemplate: `machine ${new URL(input.origin).host}\nlogin axis\npassword <READ_TOKEN>\n`,
    };
    return {
      ...privateInstall,
      script: buildAptInstallScript(privateInstall),
    };
  }
  return {
    ...install,
    script: buildAptInstallScript(install),
  };
}
