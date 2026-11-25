import bs58 from "bs58";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PublicKey, Transaction, type Connection, type Keypair } from "@solana/web3.js";
import { config, ROOT } from "../config.ts";
import { verifyMemoSignature, type Memo } from "../core/memo.ts";
import { devnetConnection, hasInstruction, memoInstruction } from "./solana.ts";
import { readJson } from "./storage.ts";

interface AnchorProof {
  signature: string;
  signer: string;
}

interface AnchorRequest extends AnchorProof {
  wire: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

const finality = "finalized";
const directory = () => path.join(config.dataDir, "startup-anchors");
const payload = (memo: Memo) => "countersign:startup:v1:" + memo.digest;

function proofFiles(memo: Memo) {
  if (memo.pack !== "startup" || !/^0x[\da-f]{64}$/.test(memo.digest)) return;
  return {
    local: path.join(directory(), memo.digest + ".json"),
    example: path.join(ROOT, "examples", "startup-devnet", memo.digest + ".json"),
  };
}

function anchorDetails(proof: AnchorProof) {
  return {
    signature: proof.signature,
    signer: proof.signer,
    explorer: "https://explorer.solana.com/tx/" + proof.signature + "?cluster=devnet",
  };
}

export function matchesStartupAnchor(tx: Awaited<ReturnType<Connection["getTransaction"]>>, memo: Memo, signer: PublicKey): boolean {
  return !!tx?.meta && !tx.meta.err && hasInstruction(tx, memoInstruction(payload(memo), [signer]));
}

export async function startupAnchorStatus(memo: Memo, connection?: Connection) {
  const files = proofFiles(memo);
  const file = files && [files.local, files.example].find((entry) => existsSync(entry));
  if (!file) return { status: "unanchored" as const };
  try {
    const proof = readJson<AnchorProof>(file);
    if (bs58.decode(proof.signature).length !== 64) return { status: "mismatch" as const };
    const signer = new PublicKey(proof.signer);
    const rpc = connection ?? devnetConnection();
    const tx = await rpc.getTransaction(proof.signature, { commitment: finality });
    const details = anchorDetails(proof);
    if (!tx) return { status: "pending" as const, ...details };
    if (!matchesStartupAnchor(tx, memo, signer)) return { status: "mismatch" as const, ...details };
    return { status: "finalized" as const, slot: tx.slot, ...details };
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function anchorStartupMemo(memo: Memo, key: Keypair, connection = devnetConnection()) {
  const files = proofFiles(memo);
  if (!files) throw new Error("Choose a signed Startup memo.");
  const signature = await verifyMemoSignature(memo);
  if (!signature.digestMatches || !signature.signerMatches) throw new Error("The Startup memo signature is invalid.");

  const current = await startupAnchorStatus(memo, connection);
  if (current.status === "finalized") return current;
  if (current.status === "mismatch" || current.status === "unavailable") {
    throw new Error("Resolve the existing anchor before retrying.");
  }
  if (current.status === "pending" && !existsSync(files.local)) throw new Error("The published anchor is pending.");

  if (!existsSync(files.local)) {
    const lifetime = await connection.getLatestBlockhash(finality);
    const tx = new Transaction({ feePayer: key.publicKey, ...lifetime });
    tx.add(memoInstruction(payload(memo), [key.publicKey]));
    tx.sign(key);
    const request: AnchorRequest = {
      ...lifetime,
      wire: tx.serialize().toString("base64"),
      signature: bs58.encode(tx.signature!),
      signer: key.publicKey.toBase58(),
    };
    mkdirSync(directory(), { recursive: true });
    try {
      writeFileSync(files.local, JSON.stringify(request) + "\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  const request = readJson<AnchorRequest>(files.local);
  const wire = Buffer.from(request.wire, "base64");
  const tx = Transaction.from(wire);
  const expected = memoInstruction(payload(memo), [key.publicKey]);
  const instruction = tx.instructions[0];
  if (request.signer !== key.publicKey.toBase58() || !tx.feePayer?.equals(key.publicKey) ||
      tx.recentBlockhash !== request.blockhash || !tx.signature || bs58.encode(tx.signature) !== request.signature ||
      !tx.verifySignatures() || tx.instructions.length !== 1 || !instruction.programId.equals(expected.programId) ||
      !instruction.data.equals(expected.data) || instruction.keys.length !== 1 ||
      !instruction.keys[0].pubkey.equals(key.publicKey) || !instruction.keys[0].isSigner) {
    throw new Error("The saved transaction does not match this Startup memo and signer.");
  }
  const { value: [status] } = await connection.getSignatureStatuses([request.signature], { searchTransactionHistory: true });
  if (status?.err) throw new Error("The Devnet anchor transaction failed.");
  if (!status && await connection.getBlockHeight(finality) > request.lastValidBlockHeight) {
    throw new Error("The saved anchor expired. Check its signature in Solana Explorer before replacing it.");
  }
  if (!status && await connection.sendRawTransaction(wire) !== request.signature) {
    throw new Error("The Devnet RPC returned an unexpected signature.");
  }
  if (status?.confirmationStatus !== finality) {
    const result = await connection.confirmTransaction({
      signature: request.signature, blockhash: request.blockhash, lastValidBlockHeight: request.lastValidBlockHeight,
    }, finality);
    if (result.value.err) throw new Error("The Devnet anchor transaction failed.");
  }
  const finalized = await startupAnchorStatus(memo, connection);
  if (finalized.status !== "finalized") throw new Error("Anchor submitted. Retry this command to check finalization.");
  return finalized;
}
