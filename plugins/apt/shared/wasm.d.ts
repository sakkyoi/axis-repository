/**
 * A `.wasm` import resolves to a module the platform compiled ahead of time.
 *
 * Cloudflare Workers refuse to compile WebAssembly at run time, so the binary
 * has to arrive this way; wrangler uploads it as its own module and the test
 * runner compiles it while loading the file.
 */
declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
