// Generates a throwaway Sepolia key and writes it to .env without ever printing it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = new URL("../.env", import.meta.url);
const EXAMPLE_PATH = new URL("../.env.example", import.meta.url);

const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : readFileSync(EXAMPLE_PATH, "utf8");
const existing = current.match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);

if (existing && !process.argv.includes("--force")) {
  const address = privateKeyToAccount(existing[1] as `0x${string}`).address;
  console.log(`A key already exists in .env. Agent address: ${address}`);
  console.log("Pass --force to replace it (the old key is lost).");
  process.exit(0);
}

const key = generatePrivateKey();
const next = /^AGENT_PRIVATE_KEY=.*$/m.test(current)
  ? current.replace(/^AGENT_PRIVATE_KEY=.*$/m, `AGENT_PRIVATE_KEY=${key}`)
  : `${current.trimEnd()}\nAGENT_PRIVATE_KEY=${key}\n`;

writeFileSync(ENV_PATH, next, { mode: 0o600 });
console.log(`New throwaway wallet written to .env`);
console.log(`Agent address: ${privateKeyToAccount(key).address}`);
console.log("Fund it with a little Sepolia ETH, then run: npm run cs -- mint");
