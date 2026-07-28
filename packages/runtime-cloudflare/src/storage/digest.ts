export type DigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export async function digestHex(algorithm: DigestAlgorithm, bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest(algorithm, bytes));
}

/** A `WritableStream` that digests what is written to it. */
interface DigestSink extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
}

type DigestSinkConstructor = new (algorithm: DigestAlgorithm) => DigestSink;

/**
 * Digests a stream without holding it.
 *
 * `crypto.subtle.digest` wants the whole input at once, which a pool object of
 * several gigabytes cannot be. Workers answer that with `crypto.DigestStream`,
 * which hashes natively as bytes arrive; Node, where the tests run, has no
 * such thing and its own streaming hash is used instead. Neither is a hash
 * written here.
 */
export async function digestStreamHex(
  algorithm: DigestAlgorithm,
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const DigestStream = (crypto as unknown as { DigestStream?: DigestSinkConstructor }).DigestStream;
  if (DigestStream) {
    const sink = new DigestStream(algorithm);
    await stream.pipeTo(sink as WritableStream<Uint8Array>);
    return hex(await sink.digest);
  }

  const hash = (await nodeCrypto()).createHash(algorithm.replace("-", "").toLowerCase());
  const reader = stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) {
      return hash.digest("hex");
    }
    hash.update(next.value);
  }
}

/**
 * Loads Node's hashing, for the tests, without the worker bundle following it.
 *
 * The specifier is held in a variable so the bundler cannot resolve it: a
 * literal import would make wrangler warn about a node builtin on every build
 * and offer to enable `nodejs_compat`, for a branch a worker never reaches.
 */
function nodeCrypto(): Promise<typeof import("node:crypto")> {
  const specifier = "node:crypto";
  return import(/* @vite-ignore */ specifier);
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hashes content that arrives in pieces, without holding what it has seen. */
export interface IncrementalDigest {
  update(chunk: Uint8Array): Promise<void>;
  hex(): Promise<string>;
}

/**
 * Starts a digest that is fed chunk by chunk.
 *
 * Same split as {@link digestStreamHex}: the worker hashes natively as bytes
 * arrive, and Node — where the tests run — uses its own streaming hash.
 */
export async function createIncrementalDigest(algorithm: DigestAlgorithm): Promise<IncrementalDigest> {
  const DigestStream = (crypto as unknown as { DigestStream?: DigestSinkConstructor }).DigestStream;
  if (DigestStream) {
    const sink = new DigestStream(algorithm);
    const writer = (sink as WritableStream<Uint8Array>).getWriter();
    return {
      update: (chunk) => writer.write(chunk),
      hex: async () => {
        await writer.close();
        return hex(await sink.digest);
      },
    };
  }

  const hash = (await nodeCrypto()).createHash(algorithm.replace("-", "").toLowerCase());
  return {
    update: async (chunk) => {
      hash.update(chunk);
    },
    hex: async () => hash.digest("hex"),
  };
}
