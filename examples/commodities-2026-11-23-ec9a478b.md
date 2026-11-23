# HOLD: Scientex Berhad / EVER GIVEN

**Commodities: cargo and counterparty** · memo `commodities-2026-11-23-ec9a478b` · 2026-11-23T11:35:09.436Z

Decision **HOLD** (REVIEW). 7/11 checks answered. Cost **$0.0900** over 9 paid Telegraph calls.

## Why
- Cited arrival at Rotterdam was 2021-07-29, 105 days after the required 2021-04-15. Hold payment pending a revised delivery plan or buyer approval.
- No usable answer: Cargo linked to the voyage
- No usable answer: Registry lookup: Scientex Berhad (Malaysia)
- Only 7 of 11 checks returned a usable answer.

## Findings

| Check | Result | Corroboration | Evidence |
|---|---|---|---|
| Vessel telemetry: EVER GIVEN (IMO 9811000) | **CLEAR** Vessel telemetry: no risk indicators in the miner's answer (raw answer, heuristic scan). | single | `0x05116138…` |
| Sanctions screen: EVER GIVEN | **CLEAR** No sanctions match for "EVER GIVEN". | single | `0x36b446d6…` |
| Sanctions screen: Scientex Berhad | **CLEAR** No sanctions match for "Scientex Berhad". | single | `0xfcb6a4c2…` |
| Port congestion: Rotterdam | **UNKNOWN** Congestion at Rotterdam: the miner's answer did not contain a usable `congestion_level` (status: missing). | single | `0x4e445a51…` |
| Supplier registration number | **CLEAR** Claimed registration 196801000264 matches the cited number 196801000264. | not_needed | Public record |
| Arrival against buyer deadline | **FLAG** Cited arrival at Rotterdam was 2021-07-29, 105 days after the required 2021-04-15. Hold payment pending a revised delivery plan or buyer approval. | not_needed | Public record |
| Cargo linked to the voyage | **UNKNOWN** Request a bill of lading or carrier booking that identifies the seller, goods, vessel and voyage before paying. | not_needed | — |
| Sanctions screen: Evergreen Marine Corporation | **CLEAR** No sanctions match for "Evergreen Marine Corporation". | single | `0x6d84daf5…` |
| Sanctions screen: Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership | **CLEAR** No sanctions match for "Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership". | single | `0xb9a13df8…` |
| Registry lookup: Scientex Berhad (Malaysia) | **UNKNOWN** The miner did not identify a registry record for "Scientex Berhad" in Malaysia. | single | `0x7f5cda34…`, `0x697d93aa…` |
| Adverse media: Scientex Berhad (registry malaysia) | **UNKNOWN** No usable search result identifies "Scientex Berhad". | single | `0x027666bb…` |

## Public records

The report signs the values supplied for comparison and their citations. Review the original records at the URLs below.
- https://scientex.com.my/wp-content/uploads/2021/06/SBQ3FY2021.pdf
- https://www.ect.nl/en/news/news-feed/ever-given-arrived-at-ect-delta-terminal
- https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf

## Evidence ledger

| # | Intent | Miner | Signal hash | Receipt | Cost | Verified |
|---|---|---|---|---|---|---|
| 1 | VESSEL_TELEMETRY_VERIFY_GENERAL | TxLens | `0x05116138c171fb89a82486c000da5e4908fd3ff83caed7127e1fb5bdac3677d2` | `0xbeba3b1e385acf29346123337867ca904399247600618f85676932486b8c9e27` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0xbeba3b1e385acf29346123337867ca904399247600618f85676932486b8c9e27) | $0.0100 | yes |
| 2 | SANCTIONS_SCREENING_MATCH_GENERAL | ChainSight — Universal Intelligence & Data Oracle | `0x36b446d60f8d3af86087546f09b0bdbacc78285ca0b3570c413d2d4c01bbf102` | `0xd20cf4063fc47ba94a936d032af70a70f75eb00353fd50a3ac491d7fb8bdbc82` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0xd20cf4063fc47ba94a936d032af70a70f75eb00353fd50a3ac491d7fb8bdbc82) | $0.0100 | yes |
| 3 | SANCTIONS_SCREENING_MATCH_GENERAL | ChainSight — Universal Intelligence & Data Oracle | `0xfcb6a4c27a661c227bc07d70e67ee997916190a61c3d41fe3979a6cf462554cb` | `0xc6ce48500a614e9592ead0a42a3ee03cbee57fffeb3db924d87c4db35707f429` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0xc6ce48500a614e9592ead0a42a3ee03cbee57fffeb3db924d87c4db35707f429) | $0.0100 | yes |
| 4 | LIVE_PORT_CONGESTION_GENERAL | TxLens | `0x4e445a51dce53b5e0b4b63386d2c33931fd41e854627ae89839461545fa037b6` | `0xa8169f8202cf168eee462326fcc6752527fe9d19ae902d031dbfa2a7ebf8f929` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0xa8169f8202cf168eee462326fcc6752527fe9d19ae902d031dbfa2a7ebf8f929) | $0.0100 | yes |
| 5 | SANCTIONS_SCREENING_MATCH_GENERAL | ChainSight — Universal Intelligence & Data Oracle | `0x6d84daf5a17cbee6dfbcc4b8ce883143d0417476d85689e23f406342817d1e5c` | `0x3b95778f1bd9e5d2a644fdc5a0ba51333bdad6d4cd8603e61e924c36b523639d` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0x3b95778f1bd9e5d2a644fdc5a0ba51333bdad6d4cd8603e61e924c36b523639d) | $0.0100 | yes |
| 6 | SANCTIONS_SCREENING_MATCH_GENERAL | ChainSight — Universal Intelligence & Data Oracle | `0xb9a13df8789bb15122124bfba73ad2f148e25c2efa907798fedcae4f6f99fbc8` | `0x9ecac139e7173ebd4058d5fba625be353870da00f30c007ad45b5c6e0824a168` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0x9ecac139e7173ebd4058d5fba625be353870da00f30c007ad45b5c6e0824a168) | $0.0100 | yes |
| 7 | CORPORATE_REGISTRY_LOOKUP_GENERAL | TxLens | `0x7f5cda3404f4e36c88dc7c6e07d2a7b7ed1c45dcf2ffa4d6fa5d5ebfb1bcb259` | `0x6f819f5c60c3dc0b278abee6b6a4c013fc1734063a899e1d120659baffc51a16` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0x6f819f5c60c3dc0b278abee6b6a4c013fc1734063a899e1d120659baffc51a16) | $0.0100 | yes |
| 8 | CORPORATE_REGISTRY_LOOKUP_GENERAL (cross-check) | LiveCert — Sourced Answers for Agents | `0x697d93aa759edb95ac51502b02254761209439945a791e75ba748c3ede3cb307` | `0xf74482156a653e51d3eeaad2b74d5a8d0f67427d2aed7f07af73668506a9e237` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0xf74482156a653e51d3eeaad2b74d5a8d0f67427d2aed7f07af73668506a9e237) | $0.0100 | yes |
| 9 | NEWS_SEARCH_GENERAL | ChainSight — Universal Intelligence & Data Oracle | `0x027666bbb4ceeb28cd644d54076eee748ebc5d4a56238c131aae0391b66aa643` | `0x6d2e4a2a4f9742821769da918ada1d4b512352a8d4730e34b78d5192300864f1` [Epoch 43](https://devnode.telegraphprotocol.com/v1/blocks/43/deliveries/0x6d2e4a2a4f9742821769da918ada1d4b512352a8d4730e34b78d5192300864f1) | $0.0100 | yes |

## Integrity

- Agent wallet: `0x77301A935d97F9c08d1F50829060B0Eb31346d5E`
- Memo digest (keccak256 of canonical JSON): `0x1fe9769e1ed37cb1f683bbfd3c0265b65e83d95340d24b960c45edf919e1a466`
- EIP-191 signature: `0x5a839c7b09b48cec5d99ab7b2d9170a7a93e03a35ac9d567e47105bf5b34f3c93673933ab54475ee76f502ca838888f4052296755935a4196ff7f50138ee18091b`
- Verify: `npm run cs -- verify commodities-2026-11-23-ec9a478b`, or look up any signal at `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`

_Countersign reports what Telegraph miners answered, with the agent's own deterministic rules on top. It is decision support for a human desk, not legal or investment advice._