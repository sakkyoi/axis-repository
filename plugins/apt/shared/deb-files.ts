import { decompressDebArchiveMember, findDebArchiveMember } from "./deb-archive";
import { normalizeTarPath, readTarEntries, tarEntryIsFile } from "./tar";

/**
 * Lists the files a package installs, as `Contents-<arch>` records them.
 *
 * Only regular files are listed: apt-file answers "which package owns this
 * file", and directories are owned by every package that installs into them.
 * Paths lose the "./" that dpkg writes in front of them, because a `Contents`
 * index names paths relative to the filesystem root.
 */
export async function readDebFilePaths(bytes: Uint8Array): Promise<string[]> {
  const archive = findDebArchiveMember(bytes, "data.tar");
  const paths: string[] = [];

  for await (const entry of readTarEntries(decompressDebArchiveMember(archive))) {
    if (!tarEntryIsFile(entry.header)) {
      continue;
    }
    const path = normalizeTarPath(entry.header.name);
    if (path !== "") {
      paths.push(path);
    }
  }

  return paths;
}
