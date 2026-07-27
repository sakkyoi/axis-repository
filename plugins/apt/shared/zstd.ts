import { ZSTD_WASM_EXPORTS, ZSTD_WASM_IMPORTS } from "./zstd-symbols.generated";
import zstdWasmModule from "./zstd.wasm";

/**
 * Zstandard compression, for the `.zst` index variants apt prefers.
 *
 * A Cloudflare Worker offers only gzip and deflate through
 * `CompressionStream`, and every xz or zstd package on npm is either a native
 * binding or a WebAssembly build whose loader needs `fetch`, WASI or threads —
 * none of which a Worker has. So libzstd is vendored as WebAssembly and driven
 * directly. The compression is still libzstd; only the handful of host
 * functions its runtime expects are ours.
 *
 * The binary arrives as an already-compiled `WebAssembly.Module`, because a
 * Worker refuses to compile WebAssembly at run time. Instantiating one is
 * allowed, and happens on first use so a Worker that never publishes does not
 * pay for it on every cold start.
 */

/** Around xz -9 on index files, and the level past which zstd stops gaining. */
const ZSTD_COMPRESSION_LEVEL = 19;
const WASM_PAGE_SIZE = 65536;

interface ZstdInstance {
  memory: WebAssembly.Memory;
  compress(destination: number, capacity: number, source: number, length: number, level: number): number;
  compressBound(length: number): number;
  isError(code: number): number;
  malloc(size: number): number;
  free(pointer: number): void;
}

let instance: Promise<ZstdInstance> | undefined;

export async function zstdCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const zstd = await (instance ??= instantiate());
  const capacity = zstd.compressBound(bytes.byteLength);
  const source = zstd.malloc(bytes.byteLength);
  const destination = zstd.malloc(capacity);

  try {
    if ((source === 0 && bytes.byteLength > 0) || destination === 0) {
      throw new Error("zstd could not allocate a compression buffer");
    }
    // The heap can move when the allocator grows it, so every view is taken
    // after the last allocation rather than held across one.
    new Uint8Array(zstd.memory.buffer).set(bytes, source);

    const written = zstd.compress(destination, capacity, source, bytes.byteLength, ZSTD_COMPRESSION_LEVEL);
    if (zstd.isError(written) !== 0) {
      throw new Error(`zstd compression failed with code ${written}`);
    }
    return new Uint8Array(zstd.memory.buffer, destination, written).slice();
  } finally {
    zstd.free(source);
    zstd.free(destination);
  }
}

async function instantiate(): Promise<ZstdInstance> {
  // The heap the binary asks the host to grow is one of its own exports, so it
  // does not exist until instantiation finishes; the host functions reach it
  // through this holder rather than a binding they would close over too early.
  const heap: { memory?: WebAssembly.Memory } = {};

  const wasm = await WebAssembly.instantiate(zstdWasmModule, {
    a: {
      // Everything else the binary imports only matters on paths a one-shot
      // compression never takes.
      [ZSTD_WASM_IMPORTS.resizeHeap]: (requested: number) => {
        const memory = heap.memory;
        if (!memory) {
          return 0;
        }
        const pages = Math.ceil((requested - memory.buffer.byteLength) / WASM_PAGE_SIZE);
        try {
          memory.grow(Math.max(pages, 0));
          return 1;
        } catch {
          return 0;
        }
      },
      [ZSTD_WASM_IMPORTS.abort]: () => {
        throw new Error("zstd aborted");
      },
      [ZSTD_WASM_IMPORTS.procExit]: (code: number) => {
        throw new Error(`zstd exited with code ${code}`);
      },
      [ZSTD_WASM_IMPORTS.keepaliveClear]: () => undefined,
      [ZSTD_WASM_IMPORTS.setItimer]: () => 0,
    },
  });

  const exports = wasm.exports as unknown as Record<string, WebAssembly.ExportValue>;
  const memory = exports[ZSTD_WASM_EXPORTS.memory] as WebAssembly.Memory;
  heap.memory = memory;
  (exports[ZSTD_WASM_EXPORTS.callConstructors] as () => void)();

  return {
    memory,
    compress: exports[ZSTD_WASM_EXPORTS.compress] as ZstdInstance["compress"],
    compressBound: exports[ZSTD_WASM_EXPORTS.compressBound] as ZstdInstance["compressBound"],
    isError: exports[ZSTD_WASM_EXPORTS.isError] as ZstdInstance["isError"],
    malloc: exports[ZSTD_WASM_EXPORTS.malloc] as ZstdInstance["malloc"],
    free: exports[ZSTD_WASM_EXPORTS.free] as ZstdInstance["free"],
  };
}
