import bs58 from "bs58";
import {
  clusterApiUrl, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  type BlockhashWithExpiryBlockHeight, type TransactionResponse, type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE, MULTISIG_SIZE, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction,
  createInitializeAccount3Instruction, createInitializeMultisigInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddressSync, unpackAccount, unpackMultisig,
} from "@solana/spl-token";
import { termsDigest, type Eligibility, type OrderTerms } from "./policy.ts";

export const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DECIMALS = 6;
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const U64_MAX = (1n << 64n) - 1n;
const releasePrefix = "countersign:release:v1:";
const finality = "finalized";

export interface Escrow {
  version: 1;
  terms: OrderTerms;
  vault: string;
  authority: string;
  funding: string;
}

export interface FundingRequest {
  escrow: Escrow;
  wire: string;
  lifetime: BlockhashWithExpiryBlockHeight;
}

export interface SettlementReceipt {
  signature: string;
  slot: number;
  memoDigest: string;
  reviewDigest: string;
}

export function devnetConnection(): Connection {
  return new Connection(clusterApiUrl("devnet"), finality);
}

export function amountAtomic(value: string): bigint {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) throw new Error("Provide a positive amount in USDC base units.");
  const amount = BigInt(value);
  if (amount > U64_MAX) throw new Error("The USDC amount is too large.");
  return amount;
}

export function memoInstruction(text: string, signers: PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM, keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
    data: Buffer.from(text, "utf8"),
  });
}

function addresses(escrow: Pick<Escrow, "terms" | "vault" | "authority">) {
  const buyer = new PublicKey(escrow.terms.buyer);
  const supplier = new PublicKey(escrow.terms.supplier);
  const signer = new PublicKey(escrow.terms.settlementSigner);
  const vault = new PublicKey(escrow.vault);
  const authority = new PublicKey(escrow.authority);
  const unique = new Set([buyer, supplier, signer, vault, authority].map((key) => key.toBase58()));
  if (unique.size !== 5 || ![buyer, supplier, signer].every((key) => PublicKey.isOnCurve(key))) {
    throw new Error("Buyer, supplier, settlement signer and escrow accounts must be distinct.");
  }
  return { buyer, supplier, signer, vault, authority };
}

export function fundingInstructions(
  escrow: Pick<Escrow, "terms" | "vault" | "authority">, multisigRent: number, tokenRent: number, mint = DEVNET_USDC,
): TransactionInstruction[] {
  const { buyer, signer, vault, authority } = addresses(escrow);
  return [
    SystemProgram.createAccount({ fromPubkey: buyer, newAccountPubkey: authority, lamports: multisigRent, space: MULTISIG_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMultisigInstruction(authority, [buyer, signer], 2),
    SystemProgram.createAccount({ fromPubkey: buyer, newAccountPubkey: vault, lamports: tokenRent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeAccount3Instruction(vault, mint, authority),
    depositTransfer(escrow, mint),
    fundingMemo(escrow),
  ];
}

function depositTransfer(escrow: Pick<Escrow, "terms" | "vault" | "authority">, mint: PublicKey) {
  const { buyer, vault } = addresses(escrow);
  return createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, buyer), mint, vault, buyer, amountAtomic(escrow.terms.amountAtomic), DECIMALS);
}

function fundingMemo(escrow: Pick<Escrow, "terms" | "vault" | "authority">) {
  const { buyer, vault, authority } = addresses(escrow);
  return memoInstruction("countersign:fund:v1:" + termsDigest(escrow.terms), [buyer, vault, authority]);
}

export function releaseInstructions(
  escrow: Escrow, approval: Extract<Eligibility, { status: "READY" }>, mint = DEVNET_USDC,
): TransactionInstruction[] {
  const { buyer, supplier, signer, vault, authority } = addresses(escrow);
  const recipient = getAssociatedTokenAddressSync(mint, supplier);
  const amount = amountAtomic(escrow.terms.amountAtomic);
  const signers = [buyer, signer];
  return [
    createAssociatedTokenAccountIdempotentInstruction(buyer, recipient, supplier, mint),
    createTransferCheckedInstruction(vault, mint, recipient, authority, amount, DECIMALS, signers),
    createCloseAccountInstruction(vault, buyer, authority, signers),
    memoInstruction(releasePrefix + termsDigest(escrow.terms) + ":" + approval.memoDigest + ":" + approval.reviewDigest, signers),
  ];
}

export async function prepareFunding(connection: Connection, terms: OrderTerms, buyer: Keypair): Promise<FundingRequest> {
  if (buyer.publicKey.toBase58() !== terms.buyer) throw new Error("The funding key must belong to the buyer.");
  const vault = Keypair.generate();
  const authority = Keypair.generate();
  const plan = { terms, vault: vault.publicKey.toBase58(), authority: authority.publicKey.toBase58() };
  const source = getAssociatedTokenAddressSync(DEVNET_USDC, buyer.publicKey);
  const [multisigRent, tokenRent, lifetime, buyerBalance, sourceInfo] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE),
    connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
    connection.getLatestBlockhash(finality),
    connection.getBalance(buyer.publicKey, finality),
    connection.getAccountInfo(source, finality),
  ]);
  if (!sourceInfo) throw new Error("Fund the buyer's Devnet wallet with test USDC before creating the escrow.");
  const token = unpackAccount(source, sourceInfo);
  if (!token.isInitialized || token.isFrozen || !token.owner.equals(buyer.publicKey) ||
      !token.mint.equals(DEVNET_USDC) || token.amount < amountAtomic(terms.amountAtomic)) {
    throw new Error("The buyer's Devnet USDC account cannot cover the escrow.");
  }
  const transaction = new Transaction({ feePayer: buyer.publicKey, ...lifetime })
    .add(...fundingInstructions(plan, multisigRent, tokenRent));
  const fee = await connection.getFeeForMessage(transaction.compileMessage(), finality);
  if (fee.value === null || buyerBalance < multisigRent + tokenRent + fee.value) {
    throw new Error("The buyer needs enough Devnet SOL for account rent and the funding fee.");
  }
  transaction.sign(buyer, vault, authority);
  return {
    escrow: { version: 1, ...plan, funding: bs58.encode(transaction.signature!) },
    wire: transaction.serialize().toString("base64"), lifetime,
  };
}

export async function submitFunding(connection: Connection, request: FundingRequest): Promise<void> {
  const previous = await connection.getSignatureStatuses([request.escrow.funding], { searchTransactionHistory: true });
  const status = previous.value[0];
  if (status?.err) throw new Error("The escrow funding transaction failed.");
  if (!status) {
    const wire = Buffer.from(request.wire, "base64");
    const tx = Transaction.from(wire);
    if (!tx.signature || bs58.encode(tx.signature) !== request.escrow.funding || !tx.verifySignatures()) {
      throw new Error("The stored funding transaction has an invalid signature.");
    }
    const signature = await connection.sendRawTransaction(wire);
    if (signature !== request.escrow.funding) throw new Error("Funding signature differs from the escrow file.");
  }
  if (status?.confirmationStatus !== finality) {
    const result = await connection.confirmTransaction({ signature: request.escrow.funding, ...request.lifetime }, finality);
    if (result.value.err) throw new Error("The escrow funding transaction failed.");
  }
  await verifyFunding(connection, request.escrow);
}

export function hasInstruction(tx: TransactionResponse | VersionedTransactionResponse, expected: TransactionInstruction): boolean {
  const message = tx.transaction.message;
  return message.compiledInstructions.some((instruction) =>
    message.staticAccountKeys[instruction.programIdIndex]?.equals(expected.programId) &&
    Buffer.from(instruction.data).equals(expected.data) &&
    instruction.accountKeyIndexes.length === expected.keys.length &&
    expected.keys.every((key, index) => {
      const accountIndex = instruction.accountKeyIndexes[index];
      return message.staticAccountKeys[accountIndex]?.equals(key.pubkey) && (!key.isSigner || message.isAccountSigner(accountIndex));
    }),
  );
}

export async function verifyFunding(connection: Connection, escrow: Escrow): Promise<void> {
  if (escrow.version !== 1) throw new Error("Unsupported escrow file version.");
  const { buyer, signer, vault, authority } = addresses(escrow);
  const tx = await connection.getTransaction(escrow.funding, { commitment: finality });
  const expected = [
    createInitializeMultisigInstruction(authority, [buyer, signer], 2),
    createInitializeAccount3Instruction(vault, DEVNET_USDC, authority),
    depositTransfer(escrow, DEVNET_USDC),
    fundingMemo(escrow),
  ];
  if (!tx?.meta || tx.meta.err || !expected.every((instruction) => hasInstruction(tx, instruction))) {
    throw new Error("No finalized funding transaction matches the amount and escrow terms.");
  }
}

export async function verifyVault(connection: Connection, escrow: Escrow): Promise<void> {
  const { buyer, signer, vault, authority } = addresses(escrow);
  const [vaultInfo, authorityInfo] = await connection.getMultipleAccountsInfo([vault, authority], finality);
  const token = unpackAccount(vault, vaultInfo);
  const controller = unpackMultisig(authority, authorityInfo);
  if (!controller.isInitialized || controller.m !== 2 || controller.n !== 2 ||
      !controller.signer1.equals(buyer) || !controller.signer2.equals(signer)) {
    throw new Error("The escrow does not require the specified two signer keys.");
  }
  if (!token.isInitialized || token.isFrozen || token.delegate || token.closeAuthority ||
      !token.mint.equals(DEVNET_USDC) || !token.owner.equals(authority) ||
      token.amount !== amountAtomic(escrow.terms.amountAtomic)) {
    throw new Error("The vault's owner, mint or balance differs from the funded terms.");
  }
}

export async function findRelease(connection: Connection, escrow: Escrow): Promise<SettlementReceipt | undefined> {
  const vault = new PublicKey(escrow.vault);
  const previous = await connection.getSignaturesForAddress(vault, { limit: 30 }, finality);
  const prefix = releasePrefix + termsDigest(escrow.terms) + ":";
  for (const entry of previous) {
    if (entry.err || !entry.memo?.includes(prefix)) continue;
    const tx = await connection.getTransaction(entry.signature, { commitment: finality });
    if (!tx?.meta || tx.meta.err) continue;
    const match = entry.memo.slice(entry.memo.indexOf(prefix) + prefix.length).match(/^(0x[0-9a-f]{64}):([0-9a-f]{64})/);
    if (!match) continue;
    const approval = { status: "READY", memoDigest: match[1] as `0x${string}`, reviewDigest: match[2] } as const;
    if (!releaseInstructions(escrow, approval).every((instruction) => hasInstruction(tx, instruction))) continue;
    return { signature: entry.signature, slot: tx.slot, memoDigest: approval.memoDigest, reviewDigest: approval.reviewDigest };
  }
}

export async function releaseFunds(
  connection: Connection, escrow: Escrow, approval: Extract<Eligibility, { status: "READY" }>,
  buyer: Keypair, signer: Keypair,
): Promise<SettlementReceipt> {
  const keys = addresses(escrow);
  if (!buyer.publicKey.equals(keys.buyer) || !signer.publicKey.equals(keys.signer)) {
    throw new Error("Release requires the approved buyer and settlement signing keys.");
  }
  await verifyFunding(connection, escrow);
  const existing = await findRelease(connection, escrow);
  if (existing) return existing;
  await verifyVault(connection, escrow);
  const lifetime = await connection.getLatestBlockhash(finality);
  const transaction = new Transaction({ feePayer: keys.buyer, ...lifetime }).add(...releaseInstructions(escrow, approval));
  transaction.sign(buyer, signer);
  try {
    const signature = await connection.sendRawTransaction(transaction.serialize());
    const result = await connection.confirmTransaction({ signature, ...lifetime }, finality);
    if (result.value.err) throw new Error("The release transaction failed.");
  } catch (error) {
    const receipt = await findRelease(connection, escrow);
    if (receipt) return receipt;
    throw error;
  }
  const receipt = await findRelease(connection, escrow);
  if (!receipt) throw new Error("Release submitted. Rerun status when the finalized transaction is available.");
  return receipt;
}
