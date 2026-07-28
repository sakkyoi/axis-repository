import { describe, expect, it } from "vitest";
import type {
  RepositoryObject,
  RepositoryObjectReadOptions,
  RepositoryObjectStore,
} from "@axis-repository/core";
import { MemoryRepositoryObjectStore } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";
import { readDebFilePaths } from "../shared/deb-files";
import { readDebControlMetadata } from "../shared/deb-control";
import { decompressDebArchiveMember, findDebArchiveMember } from "../shared/deb-archive";
import { readTarEntries } from "@axis-repository/core/archives";
import { openUploadedDebArchive } from "./deb-source";
import { debArchive, oversizedDebArchiveSource } from "./deb-fixtures.test-support";

const MIB = 1024 * 1024;

/** Records what each read asked the store for, so the ranges can be asserted on. */
function recordingStore(inner: RepositoryObjectStore) {
  const reads: Array<{ offset: number; length: number } | "whole object"> = [];
  const store: RepositoryObjectStore = {
    ...inner,
    getObject: (key: string, options?: RepositoryObjectReadOptions): Promise<RepositoryObject | null> => {
      reads.push(options?.range ?? "whole object");
      return inner.getObject(key, options);
    },
    headObject: (key: string) => inner.headObject(key),
  };
  return { store, reads };
}

/** An uncompressed data archive, so the package really is as big as its files. */
function packageOfSize(fileCount: number): Uint8Array {
  return debArchive({
    control: "Package: myapp\nVersion: 1.2.3\nArchitecture: amd64\n",
    files: Array.from({ length: fileCount }, (_, index) => `usr/share/myapp/file-${index}`),
    dataCompression: "none",
  });
}

async function bytesFetchedReadingControl(deb: Uint8Array) {
  const inner = new MemoryRepositoryObjectStore();
  await inner.putBytes("uploads/myapp.deb", deb, "application/vnd.debian.binary-package");
  const { store, reads } = recordingStore(inner);

  const control = await readDebControlMetadata(await openUploadedDebArchive(store, "uploads/myapp.deb"));

  expect(reads).not.toContain("whole object");
  const fetched = reads.reduce(
    (total, read) => total + (read === "whole object" ? deb.byteLength : read.length),
    0,
  );
  return { control, fetched, size: deb.byteLength };
}

describe("reading an uploaded .deb", () => {
  it("names an installed file before reading it, however big the file is", async () => {
    // Half a gigabyte in one installed file, against a worker's 128 MB heap.
    // Reaching the name must not mean pulling the file through memory first,
    // so by the time the entry is in hand almost nothing has been read.
    let chunksRead = 0;
    const source = oversizedDebArchiveSource({
      path: "usr/lib/model.bin",
      fileSize: 512 * MIB,
      onChunk: () => {
        chunksRead += 1;
      },
    });

    const member = await findDebArchiveMember(source, "data.tar");
    for await (const entry of readTarEntries(decompressDebArchiveMember(source, member))) {
      expect(entry.header.name).toBe("./usr/lib/model.bin");
      // One chunk of the payload may have been read ahead; 512 would mean the
      // whole file went through memory to get to a name sitting in front of it.
      expect(chunksRead).toBeLessThanOrEqual(2);
      return;
    }
    throw new Error("the data archive yielded no entries");
  });

  it("lists the installed paths of an archive it never holds", async () => {
    const source = oversizedDebArchiveSource({ path: "usr/lib/model.bin", fileSize: 8 * MIB });

    await expect(readDebFilePaths(source)).resolves.toEqual(["usr/lib/model.bin"]);
  });

  it("reads the control fields for the same cost however large the package is", async () => {
    // The control member is a few kilobytes at the front of a package that is
    // otherwise all payload. What publishing spends to read it must be capped
    // by where that member sits, not by how big the package is.
    const small = await bytesFetchedReadingControl(packageOfSize(400));
    const large = await bytesFetchedReadingControl(packageOfSize(4000));

    expect(large.control.package).toBe("myapp");
    expect(large.fetched).toBe(small.fetched);
    expect(large.fetched).toBeLessThan(small.size);
  });

  it("fails cleanly when the upload is gone rather than reading a partial archive", async () => {
    const store = new MemoryRepositoryObjectStore();

    await expect(openUploadedDebArchive(store, "uploads/missing.deb")).rejects.toThrow(
      /could not be read/,
    );
  });

  it("reads the same control fields through ranges as it does from bytes", async () => {
    // The ranged path and the in-memory path must not drift apart, since only
    // one of them is exercised by the rest of the suite.
    const inner = new MemoryRepositoryObjectStore();
    const deb = debArchive({
      control: "Package: myapp\nVersion: 1.2.3\nArchitecture: amd64\nDescription: Example\n",
      files: ["usr/bin/myapp", "usr/share/doc/myapp/copyright"],
      dataCompression: "zstd",
    });
    await inner.putBytes("uploads/myapp.deb", deb, "application/vnd.debian.binary-package");
    const source = await openUploadedDebArchive(inner, "uploads/myapp.deb");

    expect(await readDebControlMetadata(source)).toEqual(await readDebControlMetadata(deb));
    expect(await readDebFilePaths(source)).toEqual(await readDebFilePaths(deb));
  });
});
