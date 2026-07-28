/**
 * Types for `@web3-storage/multipart-parser`.
 *
 * The package ships declarations but does not name them in its `exports` map,
 * so they are not found through it. Declared here rather than reached for
 * directly, because what matters is the one property this depends on: a part's
 * `data` is an async iterable, not a buffer. The package's own
 * `iterateMultipart` is `streamMultipart` with the chunks collected, which is
 * exactly what must not happen to a wheel of several hundred megabytes.
 */
declare module "@web3-storage/multipart-parser" {
  export interface StreamedMultipartPart {
    name?: string;
    filename?: string;
    contentType?: string;
    data: AsyncIterable<Uint8Array>;
  }

  export function streamMultipart(
    body: ReadableStream<Uint8Array>,
    boundary: string,
  ): AsyncGenerator<StreamedMultipartPart, void, unknown>;
}
