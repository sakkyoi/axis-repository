import type { PublishedObject, RepositoryObjectStore } from "@axis-repository/core";
import { listAllObjects, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { PACKAGES_PREFIX, SIMPLE_PREFIX } from "./layout";
import {
  HTML_CONTENT_TYPE,
  SIMPLE_INDEX_FILENAME,
  renderProjectFilesHtml,
  renderProjectListHtml,
  type SimpleProjectFile,
} from "./simple-index";

/**
 * Keeps the Simple index in step with the packages tree.
 *
 * A publish only knows the files in its own session, so what survives between
 * publishes is read back out of the index itself: each anchor carries the
 * filename, the hash and the python requirement, which is everything needed to
 * re-emit it. That keeps the published pages as the repository's own record,
 * rather than bookkeeping that can drift away from the files.
 */

const anchorPattern = /<a\s+href="([^"]*)"((?:\s+[a-z-]+="[^"]*")*)\s*>([^<]*)<\/a>/g;
const attributePattern = /([a-z-]+)="([^"]*)"/g;

export function projectIndexPath(project: string): string {
  return `${SIMPLE_PREFIX}/${project}/${SIMPLE_INDEX_FILENAME}`;
}

export function rootIndexPath(): string {
  return `${SIMPLE_PREFIX}/${SIMPLE_INDEX_FILENAME}`;
}

/** Reads back the files a project's published page lists. */
export async function readPublishedProjectFiles(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  project: string;
}): Promise<SimpleProjectFile[]> {
  const key = `repositories/${input.repositoryName}/${projectIndexPath(input.project)}`;
  const stored = await input.objectStore.getObject(key);
  if (!stored) {
    return [];
  }
  return parseProjectFilesHtml(new TextDecoder().decode(await objectBytes(stored)));
}

export function parseProjectFilesHtml(html: string): SimpleProjectFile[] {
  const files: SimpleProjectFile[] = [];

  for (const match of html.matchAll(anchorPattern)) {
    const [, href = "", attributes = "", label = ""] = match;
    const sha256 = /#sha256=([0-9a-f]+)$/.exec(href)?.[1];
    const filename = unescapeHtml(label);
    if (!sha256 || !filename) {
      continue;
    }
    const requiresPython = [...attributes.matchAll(attributePattern)]
      .find(([, name]) => name === "data-requires-python")?.[2];
    files.push({
      filename,
      sha256,
      ...(requiresPython ? { requiresPython: unescapeHtml(requiresPython) } : {}),
    });
  }

  return files;
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface PypiIndexWrite {
  project: string;
  files: SimpleProjectFile[];
}

/**
 * Writes the project pages given and the root index over them.
 *
 * A page whose rendering is unchanged is left alone: most publishes touch one
 * project, and rewriting every other page would cost a write apiece to store
 * bytes already there.
 */
export async function writeSimpleIndexes(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  projects: PypiIndexWrite[];
}): Promise<PublishedObject[]> {
  const written: PublishedObject[] = [];

  for (const project of input.projects) {
    const key = `repositories/${input.repositoryName}/${projectIndexPath(project.project)}`;
    const html = renderProjectFilesHtml({ project: project.project, files: project.files });
    if (await writeIfChanged(input.objectStore, key, html)) {
      written.push({ key, contentType: HTML_CONTENT_TYPE });
    }
  }

  const rootKey = `repositories/${input.repositoryName}/${rootIndexPath()}`;
  const rootHtml = renderProjectListHtml(await listProjects(input.objectStore, input.repositoryName));
  if (await writeIfChanged(input.objectStore, rootKey, rootHtml)) {
    written.push({ key: rootKey, contentType: HTML_CONTENT_TYPE });
  }

  return written;
}

async function writeIfChanged(
  objectStore: RepositoryObjectStore,
  key: string,
  html: string,
): Promise<boolean> {
  const stored = await objectStore.getObject(key);
  if (stored && new TextDecoder().decode(await objectBytes(stored)) === html) {
    return false;
  }
  await objectStore.putText(key, html, HTML_CONTENT_TYPE);
  return true;
}

/**
 * Lists the projects the repository holds files for.
 *
 * Taken from the packages tree rather than from the index, so the root index
 * describes what is actually stored.
 */
export async function listProjects(
  objectStore: RepositoryObjectStore,
  repositoryName: string,
): Promise<string[]> {
  const prefix = `repositories/${repositoryName}/${PACKAGES_PREFIX}/`;
  const objects = await listAllObjects(objectStore, prefix);
  const projects = new Set<string>();

  for (const object of objects) {
    const project = object.key.slice(prefix.length).split("/")[0];
    if (project) {
      projects.add(project);
    }
  }

  return [...projects];
}
