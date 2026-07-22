import type { InstallInstructions, Repository } from "./api/schemas";

export function initialRepositorySelection(_repositories: Repository[]): string | undefined {
  return undefined;
}

export function repositoryRowStateClass(repositoryName: string, selectedName: string | undefined): string {
  return repositoryName === selectedName
    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
    : "hover:bg-muted/60";
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
