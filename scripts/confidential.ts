import { readFileSync } from "node:fs";
import { AddressLookupTableProgram, Connection, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { loadMemo, saveMemo, verifyMemoSignature } from "../src/core/memo.ts";
import { calculate, definition, parseAmounts, programId, rpcUrl } from "../src/confidential/compute.ts";
import { buyMarket, verifyMarket } from "../src/confidential/market.ts";
import { createExecutionReport, updateMarket, verifyExecutionReport } from "../src/confidential/report.ts";
import { anchor, arcium } from "../src/confidential/sdk.ts";

const { AnchorProvider, Wallet } = anchor;
const { getArciumProgram, getArciumProgramId, getLookupTableAddress, getMXEAccAddress } = arcium;

function provider() {
  const file = process.env.CONFIDENTIAL_SOLANA_KEYPAIR_FILE;
  if (!file) throw new Error("Set CONFIDENTIAL_SOLANA_KEYPAIR_FILE to a funded Devnet JSON keypair.");
  const bytes = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  return new AnchorProvider(new Connection(rpcUrl, "finalized"), new Wallet(signer), { commitment: "finalized" });
}

async function initialize() {
  const client = provider();
  const arcium = getArciumProgram(client);
  const mxeAddress = getMXEAccAddress(programId);
  const mxe = await arcium.account.mxeAccount.fetch(mxeAddress);
  const compDef = await arcium.account.computationDefinitionAccount.fetchNullable(definition);
  if (!compDef) {
    const signature = await client.sendAndConfirm(new Transaction().add(new TransactionInstruction({
      programId,
      data: createHash("sha256").update("global:init_check_liquidity_comp_def").digest().subarray(0, 8),
      keys: [
        { pubkey: client.publicKey, isSigner: true, isWritable: true },
        { pubkey: mxeAddress, isSigner: false, isWritable: true },
        { pubkey: definition, isSigner: false, isWritable: true },
        { pubkey: getLookupTableAddress(programId, mxe.lutOffsetSlot), isSigner: false, isWritable: true },
        { pubkey: AddressLookupTableProgram.programId, isSigner: false, isWritable: false },
        { pubkey: getArciumProgramId(), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    })), []);
    console.log("Computation definition initialized:", signature);
  } else {
    console.log("Computation definition is already initialized:", definition.toBase58());
  }
}

async function main() {
  const [command, id, example] = process.argv.slice(2);
  if (command === "init") {
    await initialize();
  } else if (command === "market") {
    const memo = await buyMarket();
    saveMemo(memo);
    console.log(`Saved ${memo.id}. Paid ${memo.cost.total_usd.toFixed(2)} test USDC.`);
    const verification = await verifyMarket(memo);
    if (!verification.ok) throw new Error(verification.error);
    updateMarket(memo);
    console.log(`SOL/USD ${verification.price! / 100}. The market snapshot can now be used for a private check.`);
  } else if (command === "example") {
    if (!id || (example !== "covered" && example !== "review")) throw new Error("Use example <market report ID> covered|review.");
    const memo = loadMemo(id);
    if (!memo) throw new Error("Market report is missing.");
    const market = await verifyMarket(memo);
    if (!market.ok || market.price === undefined) throw new Error(market.error);
    const redemption = (100_000 + (example === "covered" ? 5 : 9) * market.price) / 100;
    const amounts = parseAmounts(["10", "1000", redemption.toFixed(2)]);
    const started = Date.now();
    const result = await calculate(provider(), amounts, { price: market.price, digest: memo.digest }, signature => console.log("Queue:", signature));
    const expected = example === "covered" ? "COVERED" : "REVIEW";
    if (result.verdict !== expected) throw new Error(`Expected ${expected}, received ${result.verdict}.`);
    const report = await createExecutionReport(memo.id, result);
    console.log(JSON.stringify({ ...result, report: report.id, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
  } else if (command === "verify") {
    const memo = id && loadMemo(id);
    if (!memo) throw new Error("Provide an existing confidential report ID.");
    const signature = await verifyMemoSignature(memo);
    const execution = await verifyExecutionReport(memo);
    console.log(JSON.stringify({ signature, execution }, null, 2));
    if (!signature.digestMatches || !signature.signerMatches || execution.status !== "finalized") process.exitCode = 1;
  } else {
    throw new Error("Use confidential init, market, example or verify.");
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
