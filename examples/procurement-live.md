# Live procurement payment review

[Watch the live recording](https://countersign.ink/procurement.html#live) · [Open the signed report](https://countersign.ink/app.html#/memo/commodities-2026-11-24-8712c156) · [Signed JSON](commodities-2026-11-24-8712c156.json) · [Report in Markdown](commodities-2026-11-24-8712c156.md)

The buyer orders 1,000 kg of packaging film under `DEMO-PO-011W`. Bill of lading `DEMO-BL-011W` names container `TGHU1234567` on Ever Given voyage `011W`. The buyer requires that container to be discharged in Rotterdam by 31 July 2021. The entered terminal record shows the same container discharged on 30 July.

- **Shipment checks — PROCEED.** The entered order, bill of lading, container and discharge deadline agree.
- **Overall payment — HOLD.** The buyer still needs authenticated originals and a resolved supplier registry check.

The voyage is based on public records. The order, bill of lading, container entries and terms are illustrative. The nine Telegraph checks and escrow receipts come from a real Ethereum Sepolia run, with a total cost of 0.09 test USDC. Verify memo confirmed the signature and all nine signals.

## Reproduce the run

1. Open the [prefilled procurement case](https://countersign.ink/app.html?case=commodities&payment=proceed).
2. Expand **Trade details and public records** to inspect the order packet.
3. Select **Get free quote** to preview the checks. **Run diligence** authorizes the agent to buy checks from testnet escrow.
4. Open **Payment conditions** and **Evidence ledger** in the report. Use **Verify memo** to check the signature and signals.
