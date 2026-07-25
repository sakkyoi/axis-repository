import {
  publishSessionArtifactSummary,
  sha256Hex,
  type PublishArtifact,
  type PublishSession,
} from "@axis-repository/admin-ui/plugin-ui";
import { readDebControlMetadata, type DebControlMetadata } from "../shared/deb-control";

export interface AptPublishFormValues {
  component?: string;
}

export interface AptPublishPackageMetadata {
  packageName: string;
  version: string;
  architecture: string;
  maintainer: string;
  description: string;
  section?: string;
  priority?: string;
  depends?: string;
  recommends?: string;
  suggests?: string;
  conflicts?: string;
  replaces?: string;
  provides?: string;
  homepage?: string;
}

export async function buildAptPublishArtifact(file: File, values: AptPublishFormValues = {}): Promise<PublishArtifact> {
  const control = await readDebControlMetadata(new Uint8Array(await file.arrayBuffer()));
  return {
    filename: file.name,
    size: file.size,
    sha256: await sha256Hex(file),
    contentType: file.type || "application/vnd.debian.binary-package",
    metadata: aptArtifactMetadataFromDebControl(control, values.component),
  };
}

export async function readAptPublishPackageMetadata(file: File): Promise<AptPublishPackageMetadata> {
  const control = await readDebControlMetadata(new Uint8Array(await file.arrayBuffer()));
  return {
    packageName: control.package ?? "",
    version: control.version ?? "",
    architecture: control.architecture ?? "",
    maintainer: control.maintainer ?? "",
    description: control.description ?? "",
    ...withoutUndefined({
      section: control.section,
      priority: control.priority,
      depends: control.depends,
      recommends: control.recommends,
      suggests: control.suggests,
      conflicts: control.conflicts,
      replaces: control.replaces,
      provides: control.provides,
      homepage: control.homepage,
    }),
  };
}

export function aptPublishSessionArtifactSummary(session: PublishSession): string {
  const artifact = session.artifacts[0];
  if (!artifact) return publishSessionArtifactSummary(session);
  const packageName = typeof artifact.metadata.package === "string" ? artifact.metadata.package : undefined;
  const version = typeof artifact.metadata.version === "string" ? artifact.metadata.version : undefined;
  const architecture = typeof artifact.metadata.architecture === "string" ? artifact.metadata.architecture : undefined;
  if (!packageName || !version || !architecture || session.artifacts.length !== 1) {
    return publishSessionArtifactSummary(session);
  }
  return `${packageName} ${version} ${architecture}, ${session.verifiedUploads.length} verified`;
}

function aptArtifactMetadataFromDebControl(control: DebControlMetadata, component?: string): Record<string, unknown> {
  return withoutUndefined({
    package: control.package,
    version: control.version,
    architecture: control.architecture,
    component,
    description: control.description,
    maintainer: control.maintainer,
    section: control.section,
    priority: control.priority,
    homepage: control.homepage,
    depends: control.depends,
    recommends: control.recommends,
    suggests: control.suggests,
    conflicts: control.conflicts,
    replaces: control.replaces,
    provides: control.provides,
  });
}

function withoutUndefined(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Record<string, string>;
}
