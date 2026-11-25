# Confidential Institutional Intelligence

Countersign helps a fund analyst check whether an illustrative redemption is covered after a 20% drop in SOL. The workflow combines independently sourced SOL/USD evidence with encrypted inputs and a signed Arcium callback on Solana Devnet.

## Recorded results

The two cases used 10 synthetic SOL, a 1,000 USDC reserve and the conservative price of $67.26. Using USDC at $1, liquidity was $1,672.60 at spot and $1,538.08 after stress. Only the redemption amount changed.

| Case | Redemption | Decrypted decision | Public proof |
| --- | ---: | --- | --- |
| Covered | 1,336.30 USDC | `COVERED` | [Signed report](confidential-0d3082ff70bb98b8d897d765b3323f4b.json) · [Finalized callback](https://explorer.solana.com/tx/4TFGrcUR2jgjSxmh6Jteg8kjkgd8aaJXNeM1vivHu1KVhMCs5MmRSi42kjEXL3FPt3VdmMPRpm3XhoEzVg67eb1w?cluster=devnet) |
| Escalate | 1,605.34 USDC | `REVIEW` | [Signed report](confidential-d94527345a929bc987e6a96bf419bb80.json) · [Finalized callback](https://explorer.solana.com/tx/4LP2bSbLh1ik1Q2DozkqnU4dF8ueZYLbCjPqizYYb68ejsoXsBNSFxo4cPGtm8V5BqKoXuzW8xzPbJiJLdu8KMEE?cluster=devnet) |

The second redemption looks covered at spot and falls short by 67.26 USDC after stress. The two market checks cost 0.02 test USDC together and the same market evidence was reused in both cases. Queue and callback transaction fees total 10,000 lamports per case. [Signed market evidence](confidential-market-2026-11-25-69dc7da8.json) · [Kraken payment](https://explorer.solana.com/tx/5UCTvhm4VMG1w5FvYFyUWpocFM8zqk2yi9zTvtcx2GixMH7LPDgn3Nra2mLAL1UHSQpuGpZLNJ6J31hkaAcY8uzc?cluster=devnet) · [Coinbase payment](https://explorer.solana.com/tx/4gbx5hRY6ka2B3B8R2uWVQ2qgdJPS58h52XdRrpSnzgxBVbwwTaMnpex61L3msvtZGyMLHonkK4MTfS21cG93RD2?cluster=devnet)

[Live workspace and video](https://countersign.ink/confidential.html#demo) · [Devnet program](https://explorer.solana.com/address/EbFG12L4EqbuCqKkhf3hbThgXz43wXAAXr3psBQGPoAz?cluster=devnet)

## Decision and evidence

The analyst enters the SOL position, the USDC reserve and the redemption amount. The browser encrypts all three with an ephemeral X25519 key exchange and the Arcium Rescue cipher before constructing the wallet transaction. The program uses the signed market snapshot price and computes whether `USDC reserve + SOL position × SOL/USD × 0.8` covers the redemption. The verdict is encrypted for the initiating client. The wallet pays Devnet transaction fees. Settlement remains under the treasury team's controls.

The public market snapshot uses two paid Telegraph signals for the `CRYPTO_PRICE_USD` intent with `symbol=SOL`. It checks the raw committed quotes from Kraken and Coinbase, the two signal hashes and separate finalized x402 USDC transfers. Quotes must agree within 1% and be no more than 15 minutes old at submission. The policy uses the lower price, rounded down to cents. The snapshot can support multiple checks until it expires.

The signed execution report links the market memo digest and exact price to both the queue and callback transactions. Verify checks this binding, the Countersign signature and Telegraph receipts. The Arcium program checks the cluster signature before emitting the encrypted verdict. The public report exposes the program, transactions, public price and dates. The wallet address and timing are visible on Devnet. The verdict and position remain private to the initiating client under the Arcium cluster's confidentiality assumptions. The test uses supplied synthetic positions. Custody balances and fund documents require separate attestations.

## Run locally

```bash
npm ci
npm run build:confidential
npm run serve
```

Open `http://127.0.0.1:4402/confidential.html`. Use a Devnet browser wallet and the sample positions. The covered case has room below the stressed threshold. In the review case, spot liquidity covers the amount and stressed liquidity falls short.

An operator can refresh the short-lived public market snapshot. Run the following once for both checks with a configured Countersign agent signing key and `STARTUP_SOLANA_KEYPAIR_FILE` pointing to a funded Devnet test-USDC payer. Each request is capped at 0.01 test USDC. Use the same Countersign data directory as the server and pause other paid runs during the refresh.

```bash
npm run confidential -- market
```

For a CLI reproduction, set `CONFIDENTIAL_SOLANA_KEYPAIR_FILE` to a funded Devnet JSON keypair. Replace `MARKET_MEMO_ID` with the signed market memo ID emitted by the previous command.

```bash
npm run confidential -- example MARKET_MEMO_ID covered
npm run confidential -- example MARKET_MEMO_ID review
npm run confidential -- verify EXECUTION_MEMO_ID
```

The browser page loads locally built scripts and sends Countersign only public market and transaction references. Keep the page open until decryption completes. Use only the supplied synthetic positions on this public Devnet prototype.

## Rebuild the program

The source is under [`solana/confidential`](../solana/confidential). Use Arcium CLI 0.13.2, Anchor 1.0.2, Agave 3.1.10 and Rust 1.89.0 to build the circuit and the program. Program addresses and the Devnet cluster offset are configured in the Anchor project and [`compute.ts`](../src/confidential/compute.ts). [Arcium deployment documentation](https://docs.arcium.com/developers/deployment).

Arcium retrieves the compiled circuit from the versioned public URL embedded by the program. The computation definition commits to its SHA-256 digest. After provisioning a compatible MXE, run `npm run confidential -- init` with its Devnet authority to register the definition.

The browser bundle is generated by `npm run build:confidential` from this repository and the pinned dependency sources in `package-lock.json`. It includes the [Arcium SDK](https://www.npmjs.com/package/@arcium-hq/client/v/0.13.2), licensed GPL-3.0-only. Countersign source files are available under the repository's MIT license. The combined browser bundle is distributed under GPL-3.0-only.
