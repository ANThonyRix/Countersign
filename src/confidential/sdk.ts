import { createRequire } from "node:module";

// The Node packages provide CommonJS exports. Load them explicitly on Node 22.
const require = createRequire(import.meta.url);
export const anchor = require("@anchor-lang/core") as typeof import("@anchor-lang/core");
export const arcium = require("@arcium-hq/client") as typeof import("@arcium-hq/client");
