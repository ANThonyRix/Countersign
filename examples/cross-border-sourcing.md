# Cross-border sourcing walkthrough

A buyer evaluating an overseas packaging supplier needs to know whether the parties and shipping plan match the paperwork before releasing payment. This example models a marketplace sourcing decision that could arise on Alibaba.com or in another international procurement workflow.

The purchase, packaging-film cargo and buyer deadline below are illustrative. The companies, vessel, voyage and terminal arrival are drawn from public records. The sources do not establish that Scientex supplied cargo on this voyage or that Alibaba.com or Cainiao handled the shipment.

## 1. Identify the parties and the delivery condition

| Item | Case input | Public record |
|---|---|---|
| Supplier identity | Scientex Berhad, Malaysia, registration `196801000264` | [Scientex FY2021 Q3 filing, cover page](https://scientex.com.my/wp-content/uploads/2021/06/SBQ3FY2021.pdf) |
| Vessel and voyage | Ever Given, IMO `9811000`, voyage 011W, departed Tanjung Pelepas on 13 March 2021 for Rotterdam via Suez | [Panama Maritime Authority investigation, vessel particulars and voyage sections, pp. 10 and 15–16](https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf) |
| Shipping parties | Evergreen Marine Corporation, shipping line. Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership, vessel manager | [ECT terminal announcement](https://www.ect.nl/en/news/news-feed/ever-given-arrived-at-ect-delta-terminal) and [Panama Maritime Authority investigation, p. 9](https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf#page=9) |
| Buyer condition | Vessel at Rotterdam by **15 April 2021**, an illustrative payment condition | [ECT reported the vessel alongside at Rotterdam on 29 July 2021](https://www.ect.nl/en/news/news-feed/ever-given-arrived-at-ect-delta-terminal) |
| Cargo booked on that voyage | Packaging film for the illustrative order | A bill of lading or carrier booking linking this order to the vessel is still needed. |

## 2. Run Countersign

Open the [prefilled sourcing case](https://countersign.ink/app.html?case=commodities) and select **Get free quote**. The browser shows three free comparisons and seven initial miner checks. Review the inputs under **Trade details and public records**. Select **Run diligence** to buy the checks and open the signed memo. On a local installation, choose **Commodities → Load cross-border case**.

CLI equivalent, after preparing the [Ethereum Sepolia test wallet and escrow](../README.md#run-it-in-10-minutes):

```bash
npm run cs -- plan commodities --case-study
npm run cs -- run commodities --case-study
```

Miner screening covers supplier registry status, sanctions for the supplier, vessel, shipping line and manager, vessel telemetry, and port congestion. The agent can seek a second miner and buy follow-up checks within its budget. These live miner answers reflect the time of the review. The historical arrival comes from the terminal record entered in the case. Countersign compares the supplied dates and signs their citations, while the buyer can inspect the originals directly.

## 3. Read the buyer decision

**HOLD / REVIEW.** Ever Given reached the terminal **105 days after** the illustrative deadline. The registration number matches the cited company filing. That match does not establish current registry standing or a cargo booking. Ask for a bill of lading or carrier booking that names the seller, goods, vessel and voyage, plus a revised delivery plan the buyer can approve before releasing payment.

The 23 November 2026 testnet run produced usable answers for 7 of 11 checks. The registry lookup, news follow-up, port congestion and cargo linkage remained unresolved. The agent bought seven initial checks, one independent registry cross-check and one news follow-up, for **0.09 test USDC** from Ethereum Sepolia escrow. The full memo lists the result, price and receipt for each request.

## 4. Verify the evidence

Open the memo, select **Verify memo**, and inspect the paid evidence ledger. The memo signature covers the input values, the citations, the decision and the receipt list. Signal verification rechecks each payload hash and payer. Each escrow receipt identifies a delivery in a Telegraph epoch, which is inspectable once its ledger block is published.

The signature and all nine signals verified on 23 November. The node had issued all nine receipts for epoch 43 and was still waiting to publish that epoch's ledger block when checked.

- [Open the signed report in the demo](https://countersign.ink/app.html#/memo/commodities-2026-11-23-ec9a478b) or [read the Markdown report](commodities-2026-11-23-ec9a478b.md)
- [Signed JSON with all nine signal hashes and escrow receipts](commodities-2026-11-23-ec9a478b.json)

```bash
npm run cs -- verify commodities-2026-11-23-ec9a478b
```
