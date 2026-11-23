# HOLD: Scientex Berhad / EVER GIVEN

**Commodities: cargo and counterparty** · memo `commodities-2026-11-23-3435f1fa` · 2026-11-23T14:49:53.014Z

Decision **HOLD** (REVIEW). 9/12 checks answered. Cost **$0.0800** over 8 paid Telegraph calls.

## Payment conditions

**HOLD (illustrative documents)** · Overall recommendation **HOLD**.
This comparison uses the entered values. Telegraph receipts cover the supplier and shipping checks.

### Order matches bill of lading

The required values match across the cited records.

Records: Illustrative buyer purchase order and payment terms · Illustrative carrier bill of lading

| Field | Expected | Observed |
| --- | --- | --- |
| Order number | DEMO-PO-011W | DEMO-PO-011W |
| Seller registration number | 196801000264 | 196801000264 |
| Bill of lading seller | 196801000264 | 196801000264 |
| Product SKU | FILM-01 | FILM-01 |
| Quantity (kg) | 1000 | 1000 |

### Booked container matches discharge record

Container number: expected TGHU1234567, found TGHU1234572. Request a terminal discharge record for the container, bill of lading and voyage on this order.

Records: Illustrative carrier bill of lading · Illustrative terminal discharge record · https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf

| Field | Expected | Observed |
| --- | --- | --- |
| Bill of lading number | DEMO-BL-011W | DEMO-BL-011W |
| Container number | TGHU1234567 | TGHU1234572 |
| Booked vessel IMO | 9811000 | 9811000 |
| Discharge vessel IMO | 9811000 | 9811000 |
| Booked voyage number | 011W | 011W |
| Discharge voyage number | 011W | 011W |
| Agreed discharge port | ROTTERDAM | ROTTERDAM |
| Recorded discharge port | ROTTERDAM | ROTTERDAM |

### Container discharged by payment deadline

Confirm the deadline and provide a valid discharge date for the booked container and voyage.

Records: Illustrative buyer purchase order and payment terms · Illustrative terminal discharge record

| Field | Expected | Observed |
| --- | --- | --- |
| Discharge by | 2021-07-31 | 2021-07-30 |

### Authoritative order documents

Obtain authenticated originals from the buyer, carrier and terminal before releasing payment.

## Why
- Container number: expected TGHU1234567, found TGHU1234572. Request a terminal discharge record for the container, bill of lading and voyage on this order.
- No usable answer: Container discharged by payment deadline
- No usable answer: Authoritative order documents
- The miner returned a different registration number for "Scientex Berhad". Confirm the legal entity before paying.

## Findings

| Check | Result | Corroboration | Evidence |
|---|---|---|---|
| Sanctions screen: Scientex Berhad | **CLEAR** No sanctions match for "Scientex Berhad". | single | `0x360b09c0…` |
| Sanctions screen: EVER GIVEN | **CLEAR** No sanctions match for "EVER GIVEN". | single | `0x7b30d12e…` |
| Vessel telemetry: EVER GIVEN (IMO 9811000) | **CLEAR** Vessel telemetry: no risk indicators in the miner's answer (raw answer, heuristic scan). | single | `0xe03783ac…` |
| Sanctions screen: Evergreen Marine Corporation | **CLEAR** No sanctions match for "Evergreen Marine Corporation". | single | `0x02bc25bf…` |
| Supplier registration number | **CLEAR** Claimed registration 196801000264 matches the cited number 196801000264. | not_needed | Public record |
| Order matches bill of lading | **CLEAR** The required values match across the cited records. | not_needed | — |
| Booked container matches discharge record | **FLAG** Container number: expected TGHU1234567, found TGHU1234572. Request a terminal discharge record for the container, bill of lading and voyage on this order. | not_needed | — |
| Container discharged by payment deadline | **UNKNOWN** Confirm the deadline and provide a valid discharge date for the booked container and voyage. | not_needed | — |
| Authoritative order documents | **UNKNOWN** Obtain authenticated originals from the buyer, carrier and terminal before releasing payment. | not_needed | — |
| Port congestion: Rotterdam | **UNKNOWN** Congestion at Rotterdam: the miner's answer did not contain a usable `congestion_level` (status: missing). | single | `0x4aac986d…` |
| Sanctions screen: Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership | **CLEAR** No sanctions match for "Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership". | single | `0xb88ef1d0…` |
| Registry lookup: Scientex Berhad (Malaysia) | **FLAG** The miner returned a different registration number for "Scientex Berhad". Confirm the legal entity before paying. | single | `0x54354e61…`, `0x40b5de21…` |

## Public records

The report signs the values supplied for comparison and their citations. Review the original records at the URLs below.
- https://scientex.com.my/wp-content/uploads/2021/06/SBQ3FY2021.pdf
- https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf
- https://www.ect.nl/en/news/news-feed/ever-given-arrived-at-ect-delta-terminal

## Evidence ledger

| # | Intent | Miner | Signal hash | Receipt | Cost | Verified |
|---|---|---|---|---|---|---|
| 1 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0x360b09c070e1602ec06c07b70b3905f77fe95d4112f14ec996784f7a73694c46` | `0x2f329ded9616dc8eb513dc854be44e3697be3c4602b4cc55985cea0293ba6284` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x2f329ded9616dc8eb513dc854be44e3697be3c4602b4cc55985cea0293ba6284) | $0.0100 | yes |
| 2 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0x7b30d12e02892c6945ec47310fd3f4a43e4c8bad99ecd645d27fcf64047aa723` | `0xa374626c17cd9358af41c76736884bb12772ce6e0c3a7c77c82e5a231201cf57` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0xa374626c17cd9358af41c76736884bb12772ce6e0c3a7c77c82e5a231201cf57) | $0.0100 | yes |
| 3 | VESSEL_TELEMETRY_VERIFY_GENERAL | TxLens | `0xe03783ac6be4530bde9982dd20fabb83f7885ceeb9408284357a512b119fab82` | `0xfaf21c91c5b7ea4bc3c5b869daef677ed213e723687068da6d94e7c6955b6e17` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0xfaf21c91c5b7ea4bc3c5b869daef677ed213e723687068da6d94e7c6955b6e17) | $0.0100 | yes |
| 4 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0x02bc25bfb230d4a407bf95f0528a7de79f80dedab0a7a8f4d740f52ffe118d77` | `0x0a284af9f37f89833db9984066dd90e008ace2f37f5511f1687204b8f77a3adb` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x0a284af9f37f89833db9984066dd90e008ace2f37f5511f1687204b8f77a3adb) | $0.0100 | yes |
| 5 | LIVE_PORT_CONGESTION_GENERAL | TxLens | `0x4aac986d41dd61f62e2f62185aa9e6d1d507461160c8bb7459a29bfe7dd6cd05` | `0x470e117f186cbcd6aa5007cb55b56c6ef99f5487ff9e072c1b7bc9963e41cee1` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x470e117f186cbcd6aa5007cb55b56c6ef99f5487ff9e072c1b7bc9963e41cee1) | $0.0100 | yes |
| 6 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0xb88ef1d0917d710004f497f19729a396309c13c14557637778484e3263f3ea06` | `0xe40985004a1fe99e15fb7fa32c956989e30225ea15cd0924a4f2e8563b0a230a` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0xe40985004a1fe99e15fb7fa32c956989e30225ea15cd0924a4f2e8563b0a230a) | $0.0100 | yes |
| 7 | CORPORATE_REGISTRY_LOOKUP_GENERAL | Bronnoysund Enhetsregisteret | `0x54354e61638a8f0468c7863f31d19aefa53233ae4f296975d94ae9f96d3ac185` | `0x4f357aad6f8ebecab00215acc330277620bfcf8cb7f308c5cb70da65a8424860` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x4f357aad6f8ebecab00215acc330277620bfcf8cb7f308c5cb70da65a8424860) | $0.0100 | yes |
| 8 | CORPORATE_REGISTRY_LOOKUP_GENERAL (cross-check) | TxLens | `0x40b5de21f747fea50f6d209c2048bd74e9baa18b8c45901776b1afb44baefe8c` | `0x516012caea44baf356ab96cea36d71629708c97f394256e42758130affd1ea61` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x516012caea44baf356ab96cea36d71629708c97f394256e42758130affd1ea61) | $0.0100 | yes |

## Integrity

- Agent wallet: `0x77301A935d97F9c08d1F50829060B0Eb31346d5E`
- Memo digest (keccak256 of canonical JSON): `0xc3d40142b0b043f73928aa915ee0d35b96ea344309fabb90b006f5a0cda1e9fa`
- EIP-191 signature: `0x170090c867d07c8db81fc2d9f4fb69e507a9e97b96f3256c92ee6f07f03241cb1241cbe20cd3e788a53354968dd4e1fb4392cdacdf6f9b69e65c9b2453d8b3d21c`
- Verify: `npm run cs -- verify commodities-2026-11-23-3435f1fa`, or look up any signal at `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`

_Countersign reports what Telegraph miners answered, with the agent's own deterministic rules on top. It is decision support for a human desk, not legal or investment advice._
