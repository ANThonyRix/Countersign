import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { agentKey, config } from "../config.ts";

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const escrow = parseAbi(["function effectiveBalance(address) view returns (uint256)", "function depositUSDC(uint256 amount)"]);

export const publicClient = createPublicClient({ chain: sepolia, transport: http(config.rpcUrl, { timeout: config.requestTimeoutMs, retryCount: 0 }) });

async function escrowAvailable(address: `0x${string}`): Promise<bigint> {
  const response = await fetch(`${config.node}/v1/ledger/account/${address.toLowerCase()}`, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
  if (!response.ok) throw new Error(`Ledger HTTP ${response.status}`);
  const result = await response.json() as { available?: string };
  if (typeof result.available !== "string" || !/^\d+$/.test(result.available)) throw new Error("Invalid escrow balance");
  return BigInt(result.available);
}

/** Catch an unfunded wallet or escrow balance before buying any checks. */
export async function requireFundedWallet(address: `0x${string}`): Promise<void> {
  if (config.paymentRail === "escrow") {
    const credit = await escrowAvailable(address).catch(() => {
      throw new Error("Cannot read Telegraph escrow credit. Check TELEGRAPH_NODE and try again.");
    });
    if (credit === 0n) {
      throw Object.assign(new Error("Telegraph escrow has no test USDC. Fund it with npm run cs -- escrow:deposit --amount 0.25."), { status: 412 });
    }
    return;
  }
  let balance: bigint;
  try {
    balance = await publicClient.readContract({ address: config.usdc, abi: erc20, functionName: "balanceOf", args: [address] });
  } catch {
    throw new Error("Cannot read the test USDC balance from Sepolia. Check SEPOLIA_RPC and try again.");
  }
  if (balance === 0n) {
    throw Object.assign(new Error(`Wallet ${address} has no test USDC. Fund it with Sepolia ETH for mint gas, then run npm run cs -- mint.`), { status: 412 });
  }
}

export function agentAccount() {
  return privateKeyToAccount(agentKey());
}

export interface WalletStatus {
  address: string;
  eth: string;
  usdc: string;
  escrowCredit: string;
  explorer: string;
}

export async function walletStatus(address = agentAccount().address): Promise<WalletStatus> {
  const [wei, usdc, credit] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: config.usdc, abi: erc20, functionName: "balanceOf", args: [address] }),
    (config.paymentRail === "escrow" ? escrowAvailable(address) : publicClient
      .readContract({ address: config.exactPayTo, abi: escrow, functionName: "effectiveBalance", args: [address] }))
      .catch(() => 0n),
  ]);
  return {
    address,
    eth: formatEther(wei),
    usdc: formatUnits(usdc, 6),
    escrowCredit: formatUnits(credit, 6),
    explorer: `https://sepolia.etherscan.io/address/${address}`,
  };
}

/** Fund the current Telegraph escrow with Sepolia test USDC. Never runs as part of an ask. */
export async function depositTestUsdc(amountUsd: number) {
  const amount = Math.round(amountUsd * 1_000_000);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) throw new Error("Enter a deposit between 0.000001 and 100 test USDC.");
  const units = BigInt(amount);
  const account = agentAccount();
  if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("Fund this wallet with Sepolia ETH before depositing test USDC.");
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({ address: config.usdc, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: config.usdc, abi: erc20, functionName: "allowance", args: [account.address, config.diamond] }),
  ]);
  if (balance < units) throw new Error("Insufficient Sepolia test USDC. Run npm run cs -- mint to fund the wallet.");
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(config.rpcUrl) });
  if (allowance < units) {
    const approval = await wallet.writeContract({ address: config.usdc, abi: erc20, functionName: "approve", args: [config.diamond, units] });
    if ((await publicClient.waitForTransactionReceipt({ hash: approval, timeout: 120_000 })).status !== "success") throw new Error(`Sepolia USDC approval failed: ${approval}`);
  }
  const deposit = await wallet.writeContract({ address: config.diamond, abi: escrow, functionName: "depositUSDC", args: [units] });
  if ((await publicClient.waitForTransactionReceipt({ hash: deposit, timeout: 120_000 })).status !== "success") throw new Error(`Sepolia escrow deposit failed: ${deposit}`);
  return deposit;
}

/** Mints Telegraph test USDC to the agent wallet. Needs a little Sepolia ETH for gas. */
export async function mintTestUsdc(amountUsd = 10): Promise<`0x${string}`> {
  if (amountUsd <= 0 || amountUsd > 100) throw new Error("mint between 0 and 100 test USDC at a time");
  const account = agentAccount();
  const wei = await publicClient.getBalance({ address: account.address });
  if (wei === 0n) throw new Error(`wallet ${account.address} has no Sepolia ETH for gas. Fund it from a Sepolia faucet first.`);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(config.rpcUrl) });
  const hash = await wallet.writeContract({
    address: config.usdc,
    abi: erc20,
    functionName: "mint",
    args: [account.address, BigInt(Math.round(amountUsd * 1_000_000))],
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  return hash;
}
