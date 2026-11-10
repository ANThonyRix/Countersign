import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return value;
}

const requestTimeoutMs = num("REQUEST_TIMEOUT_MS", 60_000);
if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2_147_483_647) {
  throw new Error("REQUEST_TIMEOUT_MS must be a positive integer up to 2147483647");
}

export const config = {
  node: (process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, ""),
  rpcUrl: process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com",
  requestTimeoutMs,
  network: "eip155:11155111" as const,
  chainId: 11155111,
  // Telegraph test USDC on Sepolia (6 decimals, public mint, EIP-3009).
  usdc: "0xcc194e1a843B658526D0D5C431f670028582Ae17" as const,
  // Telegraph diamond: payTo for x402 and the escrow that holds credits for failed paid asks.
  diamond: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b" as const,
  maxUsdPerRun: num("MAX_USD_PER_RUN", 0.25),
  maxUsdPerDay: num("MAX_USD_PER_DAY", 2),
  maxAtomicPerPayment: String(Math.floor(num("MAX_ATOMIC_PER_PAYMENT", 100_000))),
  port: num("PORT", 4402),
  dataDir: process.env.COUNTERSIGN_DATA_DIR ? path.resolve(process.env.COUNTERSIGN_DATA_DIR) : path.join(ROOT, "data"),
  // The engine allows 60 new questions per minute per caller. Stay well below it.
  concurrency: 4,
};

export function engineUrl(p: string): string {
  return `${config.node}/engine${p}`;
}

export function agentKey(): `0x${string}` {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("AGENT_PRIVATE_KEY is missing or malformed. Run `npm run wallet:new` to create a throwaway testnet key.");
  }
  return key as `0x${string}`;
}

export function hasAgentKey(): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(process.env.AGENT_PRIVATE_KEY ?? "");
}
