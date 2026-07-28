import {
  debArchiveSourceFromBytes,
  decompressDebArchiveMember,
  findDebArchiveMember,
  type DebArchiveSource,
} from "./deb-archive";
import { normalizeTarPath, readTarEntries, tarEntryIsFile } from "@axis-repository/core/archives";

/**
 * Lists the files a package installs, as `Contents-<arch>` records them.
 *
 * Only regular files are listed: apt-file answers "which package owns this
 * file", and directories are owned by every package that installs into them.
 * Paths lose the "./" that dpkg writes in front of them, because a `Contents`
 * index names paths relative to the filesystem root.
 *
 * Nothing but the names is read, so the cost does not follow how large the
 * installed files are.
 */
export async function readDebFilePaths(
  source: DebArchiveSource | Uint8Array,
): Promise<string[]> {
  const archive = source instanceof Uint8Array ? debArchiveSourceFromBytes(source) : source;
  const member = await findDebArchiveMember(archive, "data.tar");
  const paths: string[] = [];

  for await (const entry of readTarEntries(decompressDebArchiveMember(archive, member))) {
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
