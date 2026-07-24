import {
  publishSessionArtifactSummary,
  sha256Hex,
  type PublishArtifact,
  type PublishSession,
} from "@axis-repository/admin-ui/plugin-ui";

export interface AptPublishFormValues {
  packageName: string;
  version: string;
  architecture: string;
  component: string;
  description: string;
  maintainer: string;
  section: string;
  priority: string;
}

export function defaultAptPublishFormValues(filename = ""): AptPublishFormValues {
  const match = filename.match(/^(.+)_([^_]+)_([^_]+)\.deb$/);
  return {
    packageName: match?.[1] ?? "",
    version: match?.[2] ?? "",
    architecture: match?.[3] ?? "amd64",
    component: "main",
    description: "",
    maintainer: "",
    section: "utils",
    priority: "optional",
  };
}

export async function buildAptPublishArtifact(file: File, values: AptPublishFormValues): Promise<PublishArtifact> {
  return {
    filename: file.name,
    size: file.size,
    sha256: await sha256Hex(file),
    contentType: file.type || "application/vnd.debian.binary-package",
    metadata: {
      package: values.packageName,
      version: values.version,
      architecture: values.architecture,
      component: values.component,
      description: values.description,
      maintainer: values.maintainer,
      section: values.section,
      priority: values.priority,
    },
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
