import type { InstallInstructions, Repository } from "./api/schemas";

export function initialRepositorySelection(_repositories: Repository[]): string | undefined {
  return undefined;
}

export function repositoryRowStateClass(repositoryName: string, selectedName: string | undefined): string {
  return repositoryName === selectedName
    ? "border-l-4 border-l-primary bg-primary/10 hover:bg-primary/15"
    : "border-l-4 border-l-transparent hover:bg-muted/60";
}

export function aptInstallCommandText(instructions: InstallInstructions): string {
  const authConfig = instructions.authConfPath && instructions.authConfTemplate
    ? [
        `sudo tee ${instructions.authConfPath} <<'EOF'`,
        instructions.authConfTemplate.trimEnd(),
        "EOF",
      ]
    : [];
  return [...authConfig, ...instructions.commands].join("\n");
}
