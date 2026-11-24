# Supplier settlement on Solana Devnet

Countersign links a procurement decision to a test USDC escrow on Solana Devnet. Telegraph receipts and payments for intelligence stay on Ethereum Sepolia. The two accounts serve different parties and appear separately in the report.

The buyer authorizes a fixed amount and supplier wallet when funding the order. The SPL Token vault requires both the buyer's key and a second settlement key. Countersign checks the signed procurement report and a signed review of the evidence before using the settlement key. A release transfers the exact amount to the supplier's token account, closes the vault in the same transaction, and records the report digest and evidence review hash in a Solana Memo. Repeating the command looks up the existing finalized release.

## Recorded Devnet run · November 24, 2026

[Watch the Solana Devnet walkthrough](https://countersign.ink/procurement.html#solana) or [download the MP4](../web/media/solana-devnet-live.mp4). The video reviews the signed reports, rechecks the Telegraph signals and verifies the earlier release in Solana Explorer.

[Open the report in Countersign](https://countersign.ink/app.html#/memo/commodities-2026-11-24-devnet-release) · [Escrow deposit](https://explorer.solana.com/tx/5T5qVYeNUCzG2ok3NgxM7bNh287Jpihj54hecPARpRHp7oCLA87UNCMo5FjN9NQR5y4wShxivmMAgCTfF2DxRWv8?cluster=devnet) · [Finalized release](https://explorer.solana.com/tx/22u5PeXVBWJm13mNoS9ksXYDnR72PT7KDFfx2aubVQLWDt5wuWgdbUAGvHcfyvg53nE3B4Z8NvUJo5XMf2bzHfzy?cluster=devnet) · [Signed release report](commodities-2026-11-24-devnet-release.json) · [Settlement proof](solana-devnet/settlement-proof.json)

1. **Fund.** The test buyer deposited 1 test USDC for `DEMO-PO-011W`.
2. **Hold.** The wrong-container report and the illustrative shipment PROCEED report both returned HOLD while the 1 test USDC stayed in escrow. The proof records these observations before release.
3. **Release.** The demo buyer, carrier and terminal signed controlled test documents. A separate demo reviewer attested to their hashes and the supplier identity sources. The signed release report identifies these as test records and links to [archived paid Telegraph evidence](commodities-2026-11-23-ed5ad604.json). The CLI reverified the nine archived signals before sending the transaction.
4. **Verify.** The finalized transaction paid exactly 1 test USDC to the demo recipient and closed the vault. Repeating approval returned the same signature. The vault history contains two successful transactions, the deposit and one release.

The identity extract records the issuer's disclosed company number and the Bursa Malaysia listing. The buyer, carrier, terminal, reviewer and payee roles in the release exercise use demo keys. The controlled order and signed test records exercise the release logic.

## Review the demo and run the tests

Open the [public demo](https://countersign.ink/procurement.html#solana), follow the Devnet release report and select **Verify memo** to recheck its signature and archived Telegraph signals. Open **View finalized release** in the supplier settlement section to compare the on-chain transaction with the report. You can also run the local test suite without any wallet keys.

```bash
git clone https://github.com/ANThonyRix/Countersign.git
cd Countersign
npm ci
npm test
```

## Prepare a fresh Devnet run

1. Use Node.js 22 or newer and install with `npm ci`. Set up a local Countersign agent with its own Telegraph wallet using the [README](../README.md).
2. Prepare separate Solana JSON keypair files for the buyer and settlement signer, a supplier wallet address, and a separate secp256k1 reviewer's key. Keep private keys outside the repository or under the ignored `data/` directory. Fund the test buyer with about 0.01 [Devnet SOL](https://faucet.solana.com/) and at least 1 [Circle test USDC](https://faucet.circle.com/). Select Solana Devnet in the Circle faucet.
3. From the Commodities pack, run a test purchase order with a distinct order ID. For the complete exercise, issue a HOLD memo and a second, eligible memo from the same local agent. Keep the purchase order object identical across the two reports, including its ID, registration and reference. Change the shipment evidence and obtain verifiable originals for the second report.
4. Save an ignored `data/terms.json` with the five public addresses and amount shown below. Use the local agent that signed both reports for `memoSigner`. USDC has six decimal places, so `1000000` base units represents 1 test USDC.

You can use the following command in Bash or Git Bash to generate fresh test key files and print their public addresses. Existing files are protected from overwrites.

```bash
node --input-type=module <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

mkdirSync("data", { recursive: true });
const write = (file, contents) =>
  writeFileSync("data/" + file, contents, { flag: "wx", mode: 0o600 });
for (const [label, file] of [
  ["buyer", "buyer.json"], ["supplier", "supplier.json"], ["settlementSigner", "settlement-signer.json"],
]) {
  const key = Keypair.generate();
  write(file, JSON.stringify(Array.from(key.secretKey)));
  console.log(label, key.publicKey.toBase58());
}
const reviewer = generatePrivateKey();
write("reviewer.key", reviewer + "\n");
console.log("reviewer", privateKeyToAccount(reviewer).address);
NODE
```

```json
{
  "buyer": "<Solana buyer wallet>",
  "supplier": "<Solana supplier wallet>",
  "settlementSigner": "<Solana settlement signer>",
  "memoSigner": "<Countersign report signer address>",
  "reviewer": "<independent verifier's Ethereum-format address>",
  "amountAtomic": "1000000"
}
```

## HOLD

Use your local HOLD memo to fund the escrow. The buyer can see the funding transaction and the unchanged escrow balance when the first report fails shipment review or lacks required evidence. The published illustrative reports are available for read-only comparison through the demo.

```bash
npm run settlement -- fund <hold-memo-id> data/terms.json data/buyer.json
npm run settlement -- status <hold-memo-id>
```

The funding command saves the signed transaction before sending it. If it is interrupted, rerun the same command to reconcile funding. An expired unconfirmed funding transaction requires operator review before starting a new attempt.

## Authorized release

Prepare a new procurement report for the same purchase order, using supplied records. The order, container and delivery deadline must pass. An independent reviewer checks the buyer's original order, the carrier's bill of lading, the terminal's discharge record and the supplier's registry entry. The reviewer records the SHA-256 hashes of those documents as `purchaseOrder`, `billOfLading`, `discharge` and `registry` in `data/evidence.json`.

For a controlled demonstration, use a separate order from parties who can supply verifiable test originals. Fund that order separately. The public illustrative reports remain HOLD.

The reviewer signs a statement tied to that escrow, the fixed payment terms and the exact report digest. The CLI checks the signature and expiry. A signed review can resolve a missing document or registry finding. A disputed or adverse finding requires a fresh report. Countersign rechecks the paid Telegraph signals and their payer when the buyer approves release.

```bash
npm run settlement -- review <memo-id> data/evidence.json data/reviewer.key
npm run settlement -- status <memo-id>
npm run settlement -- release <memo-id> data/buyer.json data/settlement-signer.json --approve
npm run settlement -- status <memo-id>
```

After finalization, open the associated Countersign memo and follow **View finalized release** to the Devnet Explorer. Compare the supplier, amount, and report and review hashes to the authorized terms. Keep historical and synthetic documents clearly labeled in any test.

This demonstration uses separate local signing keys and the Solana SPL Token program. The reviewer attests to the original records after checking them. A commercially deployed service needs an independently operated signing service, a buyer wallet flow, and a recovery or cancellation agreement for funds held in escrow.
