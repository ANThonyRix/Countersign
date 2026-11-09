import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { agentKey, config } from "../config.ts";

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);
const escrow = parseAbi(["function effectiveBalance(address) view returns (uint256)"]);

export const publicClient = createPublicClient({ chain: sepolia, transport: http(config.rpcUrl) });

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
    publicClient
      .readContract({ address: config.diamond, abi: escrow, functionName: "effectiveBalance", args: [address] })
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
