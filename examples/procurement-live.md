# Live procurement payment review

[Watch the live recording](https://countersign.ink/procurement.html#live) · [Compare both reports](https://countersign.ink/procurement.html#report)

The buyer orders 1,000 kg of packaging film under `DEMO-PO-011W`. Bill of lading `DEMO-BL-011W` names container `TGHU1234567` on Ever Given voyage `011W`. The buyer requires that container to be discharged in Rotterdam by 31 July 2021.

| Shipment checks | Overall payment | Evidence |
| --- | --- | --- |
| **HOLD.** The terminal record gives `TGHU1234572`, a different container. | **HOLD.** The recorded discharge does not satisfy the booked container condition. | [Report](https://countersign.ink/app.html#/memo/commodities-2026-11-23-3435f1fa) · [Signed JSON](commodities-2026-11-23-3435f1fa.json) · [Markdown](commodities-2026-11-23-3435f1fa.md) |
| **PROCEED.** The terminal entry matches `TGHU1234567` and reports discharge on 30 July. | **HOLD.** The buyer still needs authenticated originals and a resolved supplier registry check. | [Report from the recording](https://countersign.ink/app.html#/memo/commodities-2026-11-24-8712c156) · [Signed JSON](commodities-2026-11-24-8712c156.json) · [Markdown](commodities-2026-11-24-8712c156.md) |

The voyage is based on public records. The order, bill of lading, container entries and terms are illustrative. The HOLD run bought eight Telegraph checks for 0.08 test USDC. The recorded PROCEED run bought nine for 0.09 test USDC. Both runs used Ethereum Sepolia escrow. Verify memo confirmed both signatures and all 17 signals.

## Reproduce the scenarios

1. Open the [HOLD preset](https://countersign.ink/app.html?case=commodities&payment=hold) or the [PROCEED preset](https://countersign.ink/app.html?case=commodities&payment=proceed).
2. Expand **Trade details and public records** to inspect the order packet.
3. Select **Get free quote** to preview the checks. **Run diligence** authorizes the agent to buy checks from testnet escrow.
4. Open **Payment conditions** and **Evidence ledger** in the report. Use **Verify memo** to check the signature and signals.
