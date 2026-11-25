# Startup Investment Intelligence

Open the [public Startup demo](https://countersign.ink/startup.html#solana) or [download the video](../web/media/startup-solana-devnet.mp4). Select **Startup** in the app to load the reference claims or illustrative ownership conflict. The example is a historical diligence exercise based on public records.

## Recorded results

| Review | Ownership claim | Finding | Decision | Paid Telegraph checks |
| --- | --- | --- | --- | --- |
| [Reference](startup-2026-11-25-8bd460e0.json) | MoonPay Inc | Confirmed in the filed accounts | NEEDS REVIEW | 4, 0.04 test USDC |
| [Ownership mismatch](startup-2026-11-25-f35ff0fd.json) | Independent | Conflicts with the filed accounts | NEEDS REVIEW | 4, 0.04 test USDC |

[Reference anchor](https://explorer.solana.com/tx/3cC9P9v4Ja3EscS9ShDms1G5oo42fXroYjnaAPjMFeahnMy5gJtsot8NiLEMvNHKpsc8icQWpu6sD5DYe3QRyAEn?cluster=devnet) · [Mismatch anchor](https://explorer.solana.com/tx/5ujk9My7PZKLFV56m6YtLToQZcHpJnSSFGDjupSE1Y8PFoSddUGk7oDTyrz1jPBXJkS25QoVWaEFzbn5rhjhgRro?cluster=devnet)

The [Solana Devnet payment demo](startup-2026-11-25-f6c66547.json) used exact x402 to buy three Telegraph checks for 0.03 test USDC. **Verify memo** checks the three finalized token transfers and the separate report anchor. [Example payment](https://explorer.solana.com/tx/2TBpdvU5j1vNKcF5qKNZcMkG1MZwEdC9Fyeqrkz9vHQW3kXtwyCBHADmnYsXW1TmB9o4t6PGFCWJK2QYdapxyKHP?cluster=devnet) · [Report anchor](https://explorer.solana.com/tx/ZBorYeVjtwWvcjWykLWTuz6Rnn2db99Nv4Qup4Q1x1gJdmZEN1T4vFzrGj5fQj6ExHn5Uehx8HFNb1A4daeyQGq?cluster=devnet)

The manual baseline pairs the [Companies House entry](https://find-and-update.company-information.service.gov.uk/company/13836904) with [note 10 of the filed accounts](https://find-and-update.company-information.service.gov.uk/company/13836904/filing-history/MzQ5MzUzOTE4MWFkaXF6a2N4/document). The status is Active and the accounts record a January 2025 acquisition of all shares. [MoonPay's integration announcement](https://www.moonpay.com/newsroom/helio) supports the historical integration. Its [acquisition announcement](https://www.moonpay.com/newsroom/helio-acquisition) reports the processing volume. Independent reconciliation of that volume remains open in both reports.

Both paid registry searches were inconclusive after a second provider, and the adverse-media searches produced no usable answer. Signed receipts establish which checks ran. The public records establish the ownership mismatch. Each report includes source links, follow-up questions and provider timing in its evidence ledger.

New UK reviews query [Companies House's public data service](https://www.gov.uk/guidance/companies-house-data-products#uniform-resource-identifiers-uri) by registration number. The signed report records the matched legal name, status and lookup time separately from the Telegraph result. An inconclusive Telegraph registry answer remains in the report and evidence ledger. A matched active record satisfies the registry part of the decision and its coverage count. Mismatches and adverse findings still require review. A missing or unavailable official record is marked unverified.

## Reproduce and verify

```sh
npm run cs -- plan startup --example
npm run cs -- plan startup --case-study
npm run cs -- verify startup-2026-11-25-8bd460e0
npm run cs -- verify startup-2026-11-25-f35ff0fd
npm run cs -- verify startup-2026-11-25-f6c66547
```

To create a fresh signed report, run `npm run cs -- run startup --case-study` after reviewing the quote. To pay for Startup checks on Solana Devnet, set `STARTUP_SOLANA_KEYPAIR_FILE` to a local JSON keypair funded with Circle Devnet test USDC. Restart the server to select this wallet in the Startup form. The report records the Devnet payer and links the Telegraph receipts to Solana Explorer. With the default configuration, paid checks use the Telegraph test escrow on Ethereum Sepolia. The two reports above used that configuration.

For a different company, supply public claims in the Startup form or use the fields listed by `npm run cs -- packs`. The module looks for registry evidence, adverse media and possible source links. The bundled primary-record comparisons apply to the reviewed Helio case. Claims without corroborating primary records remain unverified.

To record a new anchor, run `npm run cs -- anchor <startup-memo-id> <devnet-keypair.json>` with a funded Solana Devnet keypair. The transaction contains the canonical report digest, and **Verify memo** compares the digest and signer with the finalized transaction. The signed report and source material remain in the app.
