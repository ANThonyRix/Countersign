import { build } from "esbuild";

// The Node SDK exposes FS and AES helpers alongside its browser-safe MPC client.
// This bundle only performs X25519, hashing, Rescue encryption and RPC calls.
await build({
  entryPoints: ["src/confidential/browser.ts"],
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  inject: ["scripts/confidential-browser-buffer.mjs"],
  outfile: "web/confidential-client.js",
  plugins: [{
    name: "arcium-browser",
    setup(builder) {
      builder.onResolve({ filter: /^\.\/sdk\.ts$/ }, args => {
        if (args.importer.endsWith("compute.ts")) return { path: "sdk", namespace: "arcium-browser" };
      });
      builder.onLoad({ filter: /^sdk$/, namespace: "arcium-browser" }, () => ({
        resolveDir: process.cwd(),
        contents: "import * as anchor from '@anchor-lang/core'; import * as arcium from '@arcium-hq/client'; export { anchor, arcium };",
      }));
      builder.onResolve({ filter: /^(crypto|fs)$/ }, args => {
        if (args.importer.includes("@arcium-hq")) return { path: args.path, namespace: "arcium-browser" };
      });
      builder.onResolve({ filter: /^@anchor-lang\/core$/ }, args => {
        if (args.importer.includes("@arcium-hq")) return { path: "anchor", namespace: "arcium-browser" };
      });
      builder.onLoad({ filter: /^anchor$/, namespace: "arcium-browser" }, () => ({
        resolveDir: process.cwd(),
        contents: "import * as anchor from '@anchor-lang/core'; export * from '@anchor-lang/core'; export default anchor;",
      }));
      builder.onLoad({ filter: /^crypto$/, namespace: "arcium-browser" }, () => ({
        resolveDir: process.cwd(),
        contents: `
          import { Buffer } from 'buffer';
          import { sha256 } from '@noble/hashes/sha256';
          import { sha3_256 } from '@noble/hashes/sha3';
          export function randomBytes(length) {
            return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(length)));
          }
          export function createHash(algorithm) {
            const implementation = { sha256, 'sha3-256': sha3_256 }[algorithm];
            if (!implementation) throw new Error('Unsupported browser hash algorithm');
            const hash = implementation.create();
            return {
              update(bytes) { hash.update(bytes); return this; },
              digest() { return Buffer.from(hash.digest()); },
            };
          }
          export function createCipheriv() { throw new Error('AES requires the Node client'); }
          export function createDecipheriv() { throw new Error('AES requires the Node client'); }
        `,
      }));
      builder.onLoad({ filter: /^fs$/, namespace: "arcium-browser" }, () => ({
        contents: "export default {readFileSync(){throw new Error('Use the Node client to read circuit files');}};",
      }));
    },
  }],
});
