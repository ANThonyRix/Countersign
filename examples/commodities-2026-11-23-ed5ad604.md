# HOLD: Scientex Berhad / EVER GIVEN

**Commodities: cargo and counterparty** · memo `commodities-2026-11-23-ed5ad604` · 2026-11-23T14:50:54.657Z

Decision **HOLD** (REVIEW). 9/13 checks answered. Cost **$0.0900** over 9 paid Telegraph calls.

## Payment conditions

**PROCEED (illustrative documents)** · Overall recommendation **HOLD**.
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

The required values match across the cited records.

Records: Illustrative carrier bill of lading · Illustrative terminal discharge record · https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf

| Field | Expected | Observed |
| --- | --- | --- |
| Bill of lading number | DEMO-BL-011W | DEMO-BL-011W |
| Container number | TGHU1234567 | TGHU1234567 |
| Booked vessel IMO | 9811000 | 9811000 |
| Discharge vessel IMO | 9811000 | 9811000 |
| Booked voyage number | 011W | 011W |
| Discharge voyage number | 011W | 011W |
| Agreed discharge port | ROTTERDAM | ROTTERDAM |
| Recorded discharge port | ROTTERDAM | ROTTERDAM |

### Container discharged by payment deadline

Discharged on 2021-07-30, by the required 2021-07-31.

Records: Illustrative buyer purchase order and payment terms · Illustrative terminal discharge record

| Field | Expected | Observed |
| --- | --- | --- |
| Discharge by | 2021-07-31 | 2021-07-30 |

### Authoritative order documents

Obtain authenticated originals from the buyer, carrier and terminal before releasing payment.

## Why
- No usable answer: Authoritative order documents
- No usable answer: Registry lookup: Scientex Berhad (Malaysia)

## Findings

| Check | Result | Corroboration | Evidence |
|---|---|---|---|
| Vessel telemetry: EVER GIVEN (IMO 9811000) | **CLEAR** Vessel telemetry: no risk indicators in the miner's answer (raw answer, heuristic scan). | single | `0x03e40556…` |
| Sanctions screen: Scientex Berhad | **CLEAR** No sanctions match for "Scientex Berhad". | single | `0x7ed98ef1…` |
| Sanctions screen: EVER GIVEN | **CLEAR** No sanctions match for "EVER GIVEN". | single | `0x70e78c45…` |
| Port congestion: Rotterdam | **UNKNOWN** Congestion at Rotterdam: the miner's answer did not contain a usable `congestion_level` (status: missing). | single | `0x2c49298b…` |
| Supplier registration number | **CLEAR** Claimed registration 196801000264 matches the cited number 196801000264. | not_needed | Public record |
| Order matches bill of lading | **CLEAR** The required values match across the cited records. | not_needed | — |
| Booked container matches discharge record | **CLEAR** The required values match across the cited records. | not_needed | — |
| Container discharged by payment deadline | **CLEAR** Discharged on 2021-07-30, by the required 2021-07-31. | not_needed | — |
| Authoritative order documents | **UNKNOWN** Obtain authenticated originals from the buyer, carrier and terminal before releasing payment. | not_needed | — |
| Sanctions screen: Evergreen Marine Corporation | **CLEAR** No sanctions match for "Evergreen Marine Corporation". | single | `0xa219ffb0…` |
| Sanctions screen: Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership | **CLEAR** No sanctions match for "Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership". | single | `0x579ca0c0…` |
| Registry lookup: Scientex Berhad (Malaysia) | **UNKNOWN** The miner did not identify a registry record for "Scientex Berhad" in Malaysia. | single | `0xccdbeecb…`, `0x7053c12b…` |
| Adverse media: Scientex Berhad (registry malaysia) | **UNKNOWN** No usable search result identifies "Scientex Berhad". | single | `0xe0fa3148…` |

## Public records

The report signs the values supplied for comparison and their citations. Review the original records at the URLs below.
- https://scientex.com.my/wp-content/uploads/2021/06/SBQ3FY2021.pdf
- https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf
- https://www.ect.nl/en/news/news-feed/ever-given-arrived-at-ect-delta-terminal

## Evidence ledger

| # | Intent | Miner | Signal hash | Receipt | Cost | Verified |
|---|---|---|---|---|---|---|
| 1 | VESSEL_TELEMETRY_VERIFY_GENERAL | TxLens | `0x03e4055636f9ffd6dc7365ab99612dddd4b5821aa0bc503e8eda696195e7977d` | `0xfb4c9c2900346b8e1385d38631090dbf6a4266075be9aec1a83b78a03032f60d` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0xfb4c9c2900346b8e1385d38631090dbf6a4266075be9aec1a83b78a03032f60d) | $0.0100 | yes |
| 2 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0x7ed98ef1ff0194de678bbfaedcf1973a6f977ae25970fee94692e98048a8c1c6` | `0xb2db25af885bbc1799d7263d083e2ccb82cec468d973216dd59087c5998763f4` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0xb2db25af885bbc1799d7263d083e2ccb82cec468d973216dd59087c5998763f4) | $0.0100 | yes |
| 3 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0x70e78c454055fde0a79be08c23bb3b47831613b6db4c64dfff5b33c7d496a598` | `0x96844b908d8ab6337e66221afec4739c50905e9174b1613908caf8c31bc10b09` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x96844b908d8ab6337e66221afec4739c50905e9174b1613908caf8c31bc10b09) | $0.0100 | yes |
| 4 | LIVE_PORT_CONGESTION_GENERAL | TxLens | `0x2c49298b5bab975e5c63114a498b28985ebd57a687d4a86889f562711c74eca4` | `0x0edd637c86d0d289ed2355c0c67811b6de94eedd552242190fab29212ed7b7c2` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x0edd637c86d0d289ed2355c0c67811b6de94eedd552242190fab29212ed7b7c2) | $0.0100 | yes |
| 5 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0xa219ffb074f91da3d6287a591be76956cca4fae19b9948c224545757bb569e0f` | `0x1abe66083b40d3ff4d8add82d5233eccb4a14e74eb38333d2f9445764e74b34e` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x1abe66083b40d3ff4d8add82d5233eccb4a14e74eb38333d2f9445764e74b34e) | $0.0100 | yes |
| 6 | SANCTIONS_SCREENING_MATCH_GENERAL | TxLens | `0x579ca0c0aa0b5da0412269c2a66816ecb92976ef9908a05fe3c9321c26f2446c` | `0xba01d75707401295f3ef635bd73c8f6ea41ac318318c0e1b86816eb539413c45` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0xba01d75707401295f3ef635bd73c8f6ea41ac318318c0e1b86816eb539413c45) | $0.0100 | yes |
| 7 | CORPORATE_REGISTRY_LOOKUP_GENERAL | TxLens | `0xccdbeecb79fd51f76c1131ccecdbbb44dba19605b93d5e11bdf79e8fb79edd2c` | `0x6970dc422cc1609de12fd2fbcfcc7b086805272681b88a333d36c01b833220d6` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x6970dc422cc1609de12fd2fbcfcc7b086805272681b88a333d36c01b833220d6) | $0.0100 | yes |
| 8 | CORPORATE_REGISTRY_LOOKUP_GENERAL (cross-check) | PREFLIGHT Infrastructure Signals | `0x7053c12b46bca151953185a05ada6917b924b03de80ff3821577ce808f3bb6a1` | `0x4710d1ce7280e540ef7ce2e6a8ee0e7c4777535259bdf606cd688b694c05cf49` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x4710d1ce7280e540ef7ce2e6a8ee0e7c4777535259bdf606cd688b694c05cf49) | $0.0100 | yes |
| 9 | NEWS_SEARCH_GENERAL | ChainSight — Universal Intelligence & Data Oracle | `0xe0fa31488c87d55badee078fbd8c3d79c50bb72b414fd86556a9517e860522fd` | `0x9b143d03043f92bf4af77b8028b6904c86442e873b00ffe35ddaddc2117f7812` [Epoch 44](https://devnode.telegraphprotocol.com/v1/blocks/44/deliveries/0x9b143d03043f92bf4af77b8028b6904c86442e873b00ffe35ddaddc2117f7812) | $0.0100 | yes |

## Integrity

- Agent wallet: `0x77301A935d97F9c08d1F50829060B0Eb31346d5E`
- Memo digest (keccak256 of canonical JSON): `0x93accd9442cb428838351f388011fd9af97bce1a31eea1b4cd6b7a33e04c2f60`
- EIP-191 signature: `0x0c9cc84dbeadf6e6337b312c91d7de05c8562d3d3d0d742b41229a251af4241330fe358f0512249276d7e7841054f4897bc39f8449c848c095a45a1736e338861b`
- Verify: `npm run cs -- verify commodities-2026-11-23-ed5ad604`, or look up any signal at `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`

_Countersign reports what Telegraph miners answered, with the agent's own deterministic rules on top. It is decision support for a human desk, not legal or investment advice._
