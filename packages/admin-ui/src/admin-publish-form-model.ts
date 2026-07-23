import type { PublishArtifact } from "./api/schemas";

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

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
