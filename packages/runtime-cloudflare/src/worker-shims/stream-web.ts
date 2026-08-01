/**
 * Vite can encounter dependencies that import Node's `stream/web` module while
 * bundling code that will run in a Cloudflare Worker. Workers already provide
 * the Web Streams constructors as globals, and pulling in a Node stream module
 * would make the bundle describe the wrong runtime.
 *
 * The root Vite config aliases `stream/web` to this module so those imports
 * resolve to the Worker-native constructors instead of a Node compatibility
 * layer.
 */
type WorkerStreamGlobal = typeof globalThis & {
  ReadableStream: unknown;
  WritableStream: unknown;
  TransformStream: unknown;
};

const workerGlobal = globalThis as WorkerStreamGlobal;

export const ReadableStream: unknown = workerGlobal.ReadableStream;
export const WritableStream: unknown = workerGlobal.WritableStream;
export const TransformStream: unknown = workerGlobal.TransformStream;
