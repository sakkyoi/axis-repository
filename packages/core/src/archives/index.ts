/**
 * Archive readers shared by the repository plugins.
 *
 * Package formats keep their metadata inside an archive — a `.deb` is an `ar`
 * of tars, a wheel is a zip, an sdist is a tar.gz — and every ecosystem needs
 * to read a few kilobytes out of a file that may be gigabytes. The walkers
 * here stream rather than buffer so that stays true, and they live in core
 * because a plugin may not depend on another plugin.
 */

export {
  ArchiveParseError,
  readTarEntries,
  tarEntryIsFile,
  normalizeTarPath,
  streamFromBytes,
  type ByteChunk,
  type ByteStream,
  type TarEntry,
  type TarEntryHeader,
} from "./tar";

export {
  readZipEntries,
  readZipEntry,
  zipSourceFromBytes,
  type ZipEntry,
  type ZipSource,
} from "./zip";
