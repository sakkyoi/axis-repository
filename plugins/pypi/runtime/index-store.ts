import type { PublishedObject, RepositoryObjectStore } from "@axis-repository/core";
import { listAllObjects, objectBytes } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { PACKAGES_PREFIX, SIMPLE_PREFIX } from "./layout";
import {
  HTML_CONTENT_TYPE,
  SIMPLE_INDEX_FILENAME,
  SIMPLE_JSON_CONTENT_TYPE,
  SIMPLE_JSON_FILENAME,
  renderProjectFilesHtml,
  renderProjectFilesJson,
  renderProjectListHtml,
  renderProjectListJson,
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
    const attributeValues = new Map(
      [...attributes.matchAll(attributePattern)].map(([, name = "", value = ""]) => [name, value]),
    );
    const requiresPython = attributeValues.get("data-requires-python");
    const coreMetadata = /^sha256=([0-9a-f]+)$/.exec(attributeValues.get("data-core-metadata") ?? "")?.[1];
    const yanked = attributeValues.get("data-yanked");
    files.push({
      filename,
      sha256,
      ...(requiresPython ? { requiresPython: unescapeHtml(requiresPython) } : {}),
      ...(coreMetadata ? { coreMetadataSha256: coreMetadata } : {}),
      // An empty data-yanked is a yank without a stated reason, which is not
      // the same as an absent one.
      ...(yanked === undefined ? {} : { yanked: unescapeHtml(yanked) }),
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

  // Both serializations are published, and a client is given whichever it
  // negotiated; they are generated from the same files so they cannot disagree.
  for (const project of input.projects) {
    const base = `repositories/${input.repositoryName}/${SIMPLE_PREFIX}/${project.project}`;
    written.push(...await writeIfChanged(input.objectStore, [
      {
        key: `${base}/${SIMPLE_INDEX_FILENAME}`,
        text: renderProjectFilesHtml(project),
        contentType: HTML_CONTENT_TYPE,
      },
      {
        key: `${base}/${SIMPLE_JSON_FILENAME}`,
        text: renderProjectFilesJson(project),
        contentType: SIMPLE_JSON_CONTENT_TYPE,
      },
    ]));
  }

  const projects = await listProjects(input.objectStore, input.repositoryName);
  const root = `repositories/${input.repositoryName}/${SIMPLE_PREFIX}`;
  written.push(...await writeIfChanged(input.objectStore, [
    {
      key: `${root}/${SIMPLE_INDEX_FILENAME}`,
      text: renderProjectListHtml(projects),
      contentType: HTML_CONTENT_TYPE,
    },
    {
      key: `${root}/${SIMPLE_JSON_FILENAME}`,
      text: renderProjectListJson(projects),
      contentType: SIMPLE_JSON_CONTENT_TYPE,
    },
  ]));

  return written;
}

async function writeIfChanged(
  objectStore: RepositoryObjectStore,
  documents: Array<{ key: string; text: string; contentType: string }>,
): Promise<PublishedObject[]> {
  const written: PublishedObject[] = [];

  for (const document of documents) {
    const stored = await objectStore.getObject(document.key);
    if (stored && new TextDecoder().decode(await objectBytes(stored)) === document.text) {
      continue;
    }
    await objectStore.putText(document.key, document.text, document.contentType);
    written.push({ key: document.key, contentType: document.contentType });
  }

  return written;
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
