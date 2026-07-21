export interface AptClientRepositoryInfo {
  name: string;
  visibility: "private" | "public";
  codename: string;
  components: string[];
}

export interface AptSourceInfo {
  repository: string;
  ecosystem: "apt";
  baseUrl: string;
  codename: string;
  components: string[];
  keyringPath: string;
  sourceLine: string;
}

export interface AptInstallInfo {
  repository: string;
  visibility: "private" | "public";
  keyUrl: string;
  keyringPath: string;
  sourceListPath: string;
  sourceLine: string;
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
  return {
    repository: input.repository.name,
    ecosystem: "apt",
    baseUrl,
    codename: input.repository.codename,
    components: [...input.repository.components],
    keyringPath,
    sourceLine: `deb [signed-by=${keyringPath}] ${baseUrl} ${input.repository.codename} ${input.repository.components.join(" ")}`,
  };
}

export function buildAptInstallInfo(input: {
  origin: string;
  repository: AptClientRepositoryInfo;
}): AptInstallInfo {
  const source = buildAptSourceInfo(input);
  const keyUrl = `${source.baseUrl}/apt/key.gpg`;
  const sourceListPath = sourceListPathForRepository(input.repository.name);
  const install: AptInstallInfo = {
    repository: input.repository.name,
    visibility: input.repository.visibility,
    keyUrl,
    keyringPath: source.keyringPath,
    sourceListPath,
    sourceLine: source.sourceLine,
    commands: [
      `curl -fsSL ${keyUrl} | sudo gpg --dearmor -o ${source.keyringPath}`,
      `echo '${source.sourceLine}' | sudo tee ${sourceListPath}`,
      "sudo apt update",
    ],
  };
  if (input.repository.visibility === "private") {
    return {
      ...install,
      authConfPath: authConfPathForRepository(input.repository.name),
      authConfTemplate: `machine ${new URL(input.origin).host}\nlogin axis\npassword <READ_TOKEN>\n`,
    };
  }
  return install;
}
