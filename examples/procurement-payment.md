# Procurement payment review

Countersign checks whether the documents for one purchase order satisfy a condition for payment. The same order and condition produce two results when the terminal record changes.

The [historical sourcing case](cross-border-sourcing.md) supplies the public facts about Ever Given, IMO `9811000`, voyage `011W` and Rotterdam. The purchase order, bill of lading, container numbers, discharge records and payment terms in this walkthrough are illustrative. They describe no confirmed shipment for Scientex, Alibaba.com or Cainiao.

## Order and payment condition

The buyer orders 1,000 kg of packaging film, SKU `FILM-01`, under `DEMO-PO-011W`. Bill of lading `DEMO-BL-011W` names container `TGHU1234567` on voyage `011W`. The buyer requires discharge of that container at Rotterdam by the end of 31 July 2021, local calendar date. A port arrival entry establishes when the ship arrived. A discharge entry for the nominated container is needed to satisfy the condition.

| Scenario | Terminal entry | Documentary result |
| --- | --- | --- |
| HOLD | `TGHU1234572` at Rotterdam on 30 July | The entry identifies another container. Request the record for `TGHU1234567`. |
| PROCEED | `TGHU1234567` at Rotterdam on 30 July | The order, bill of lading and discharge entry agree. The entered date meets the illustrative deadline. |

The memorandum includes a separate overall recommendation. It remains HOLD until authenticated originals establish the order and the shipment. Missing critical checks or conflicting evidence also prevent clearance. The memo's signature covers the entered values, comparisons, findings and receipts. Verify checks the memo signature and Telegraph signal hashes. The paid signals cover supplier and shipping checks.

## Reproduce both comparisons

Open the [HOLD example](https://countersign.ink/app.html?case=commodities&payment=hold) or [PROCEED example](https://countersign.ink/app.html?case=commodities&payment=proceed). To reproduce locally, start the app with `npm run serve` and use the same query parameters on the local app. Expand **Trade details and public records** to inspect the order records. Use **Get free quote** to preview the checks. **Run diligence** pays for external checks from the configured testnet escrow.

```bash
npm run cs -- plan commodities --payment-case hold
npm run cs -- run commodities --payment-case hold
npm run cs -- run commodities --payment-case proceed
```

In the signed memo, open **Payment conditions** to compare the expected and observed values. The **Evidence ledger** lists the independent providers, signal hashes, receipts and costs. **Verify memo** rechecks the signature and recorded signals.

## Recorded Ethereum Sepolia runs

| Documentary result | Overall recommendation | Telegraph checks | Evidence |
| --- | --- | --- | --- |
| HOLD | HOLD | 8 paid calls, 0.08 test USDC | [Web report](https://countersign.ink/app.html#/memo/commodities-2026-11-23-3435f1fa) · [Markdown](commodities-2026-11-23-3435f1fa.md) · [Signed JSON](commodities-2026-11-23-3435f1fa.json) |
| PROCEED | HOLD | 9 paid calls, 0.09 test USDC | [Web report](https://countersign.ink/app.html#/memo/commodities-2026-11-23-ed5ad604) · [Markdown](commodities-2026-11-23-ed5ad604.md) · [Signed JSON](commodities-2026-11-23-ed5ad604.json) |

Both runs include a registry check with a second provider. The checks did not establish an unambiguous registry match for the supplier. The PROCEED result applies to the illustrative documents. To release a real payment, the buyer would need the originals and a resolved supplier registry check.
