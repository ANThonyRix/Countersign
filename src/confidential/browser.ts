import { AnchorProvider } from "@anchor-lang/core";
import { Connection, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { calculate, parseAmounts, rpcUrl, type MarketReference } from "./compute.ts";

interface Wallet {
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
}

interface Market extends MarketReference {
  id: string;
  cost: number;
  validUntil: number;
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const form = byId<HTMLFormElement>("liquidity-form");
const inputs = ["position", "reserve", "redemption"].map(id => byId<HTMLInputElement>(id));
const calculateButton = byId<HTMLButtonElement>("calculate");
const status = byId("run-status");
const output = byId("verdict");
const marketStatus = byId("market-status");
const verifyStatus = byId("verify-status");
const verifyButton = byId<HTMLButtonElement>("verify-execution");
const queueLink = byId<HTMLAnchorElement>("queue-transaction");
const callbackLink = byId<HTMLAnchorElement>("callback-transaction");
const marketLink = byId<HTMLAnchorElement>("market-report");
const reportLink = byId<HTMLAnchorElement>("execution-report");
let market: Market | undefined;
let busy = false;

function link(element: HTMLAnchorElement, href: string) {
  element.href = href;
  element.hidden = false;
}

async function request(url: string, body?: Record<string, string>) {
  const response = await fetch(url, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

async function refreshMarket() {
  calculateButton.disabled = true;
  marketStatus.textContent = "Verifying two paid SOL/USD signals…";
  try {
    const data = await request("/api/confidential/market");
    if (data.id) link(marketLink, `/app.html#/memo/${encodeURIComponent(data.id)}`);
    if (!data.ok) throw new Error(data.error);
    market = data as Market;
    marketStatus.textContent = `$${(market.price / 100).toFixed(2)} per SOL · Kraken and Coinbase · $${market.cost.toFixed(2)} test USDC`;
  } catch (error) {
    market = undefined;
    marketStatus.textContent = error instanceof Error ? error.message : "Market evidence unavailable.";
  } finally {
    calculateButton.disabled = busy || !market;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-example]")) {
  button.addEventListener("click", () => {
    const price = market ? market.price / 100 : 70;
    const multiplier = button.dataset.example === "covered" ? 0.5 : 0.9;
    [inputs[0].value, inputs[1].value, inputs[2].value] = ["10", "1000", (1000 + 10 * price * multiplier).toFixed(2)];
  });
}

const explorer = (signature: string) => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !market) return;
  if (market.validUntil <= Date.now()) {
    await refreshMarket();
    return;
  }
  const snapshot = market;
  busy = true;
  calculateButton.disabled = true;
  for (const element of [queueLink, callbackLink, reportLink, output, verifyButton, verifyStatus]) element.hidden = true;
  try {
    const amounts = parseAmounts(inputs.map(input => input.value));
    const browser = window as Window & { phantom?: { solana?: Wallet }; solana?: Wallet };
    const wallet = browser.phantom?.solana ?? browser.solana;
    if (!wallet) throw new Error("Connect a browser Solana wallet with Devnet SOL to run the check.");
    status.textContent = "Connect your Devnet wallet and approve the encrypted submission.";
    const { publicKey } = await wallet.connect();
    const provider = new AnchorProvider(new Connection(rpcUrl, "finalized"), {
      publicKey: new PublicKey(publicKey.toBase58()),
      signTransaction: transaction => wallet.signTransaction(transaction),
      signAllTransactions: transactions => Promise.all(transactions.map(transaction => wallet.signTransaction(transaction))),
    });
    const result = await calculate(provider, amounts, snapshot, (queue) => {
      link(queueLink, explorer(queue));
      status.textContent = "Encrypted request finalized. Waiting for the Arcium callback…";
    });
    link(callbackLink, explorer(result.callback));
    output.dataset.verdict = result.verdict;
    output.textContent = result.verdict;
    output.hidden = false;
    status.textContent = result.verdict === "COVERED" ? "Stress-adjusted reserves cover the redemption." : "Stress-adjusted reserves fall short. Escalate for review.";
    const report = await request("/api/confidential/reports", {
      marketId: snapshot.id, queue: result.queue, callback: result.callback,
    });
    link(reportLink, `/app.html#/memo/${encodeURIComponent(report.id)}`);
    verifyButton.dataset.reportId = report.id;
    verifyButton.hidden = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The check could not be completed.";
    status.textContent = output.hidden ? message : `Verdict decrypted. Public report could not be signed. ${message}`;
  } finally {
    busy = false;
    calculateButton.disabled = !market;
  }
});

verifyButton.addEventListener("click", async () => {
  verifyButton.disabled = true;
  verifyStatus.hidden = false;
  verifyStatus.textContent = "Verifying the report, receipts and finalized callback…";
  try {
    const report = await request(`/api/memos/${encodeURIComponent(verifyButton.dataset.reportId!)}/verify`);
    verifyStatus.textContent = report.ok ? "Verified · report signature · two Telegraph payments · finalized Arcium execution" : "Verification failed.";
  } catch {
    verifyStatus.textContent = "Verification is temporarily unavailable.";
  } finally {
    verifyButton.disabled = false;
  }
});

byId("refresh-market").addEventListener("click", refreshMarket);
void refreshMarket();
