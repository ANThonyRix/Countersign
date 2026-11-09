# Countersign

Counterparty due diligence bought per answer from Telegraph miners and signed.

Countersign is an autonomous agent for the Telegraph Hackathon Season II (Apps & Agents). It plans the
checks a listing desk, a commodities trader or a legal team would order. It buys each check from a
Telegraph miner over x402 for $0.01 in test USDC on Sepolia, and asks a second, independent miner
whenever a critical answer is not clean. It then decides GO / REVIEW / STOP with a deterministic rule
and signs a memo. Anyone can re-verify the memo against the node.

One core, three mission packs:

| Pack | Mission | What it checks |
|---|---|---|
| `exchange` | Exchange: token listing desk | issuer sanctions, smart-contract audit, adverse media; optional: X account bot detection, on-chain treasury balance, source code review |
| `commodities` | Commodities: cargo and counterparty | seller registry and sanctions, vessel sanctions and telemetry, discharge port congestion; optional: bill of lading authenticity |
| `legal` | Legal: multi-jurisdiction diligence | registry standing in each jurisdiction, sanctions on the entity and each officer, regulatory filings, adverse media, B2B identity |

Questions about usage, costs, safety or the memo format: see [FAQ.md](FAQ.md).

Findings can trigger follow-up checks. A sanctions hit, a dead or missing registry record, or a bot-run
audience makes the agent buy a targeted news search.

## Run it in 10 minutes

Needs Node 20.12+ (tested on Node 24).

```bash
npm install
npm run wallet:new          # writes a fresh throwaway key to .env and prints the address
```

1. Send 0.01–0.05 Sepolia ETH to the printed address (any Sepolia faucet). The ETH pays gas for the mint.
2. Mint Telegraph test USDC and check the wallet:

   ```bash
   npm run cs -- mint
   npm run cs -- wallet
   ```

3. Get a free quote. The node prices every request before payment, so this costs nothing:

   ```bash
   npm run cs -- plan commodities --example
   ```

4. Run a pack for real. Each check costs $0.01. A run stops at `MAX_USD_PER_RUN` ($0.25 by default):

   ```bash
   npm run cs -- run commodities --example
   npm run cs -- run exchange --example
   npm run cs -- run legal --example
   ```

5. Re-verify a memo. This checks the signature, the digest and every signal hash against the node:

   ```bash
   npm run cs -- verify <memo-id>
   npm run cs -- show <memo-id>      # Markdown version
   ```

6. Open the web UI at http://127.0.0.1:4402:

   ```bash
   npm run serve
   ```

   The UI quotes and runs packs, streams every purchase live, and shows each memo with its evidence
   ledger. Its Verify button re-checks every signal on the node.

Pass your own subject as flags instead of `--example`. `npm run cs -- packs` lists each pack's fields.

```bash
npm run cs -- run commodities --seller "Trafigura Pte Ltd" --jurisdiction Singapore \
  --vessel "EVER GIVEN" --imo 9811000 --port Rotterdam
```

## How it works

```
subject ──► pack.plan() ──► free quote (POST /v1/ask, 402 + PAYMENT-REQUIRED)
                               │
                               ▼
               budget.reserve() ──► x402 exact payment (EIP-3009, test USDC)
                               │
                               ▼
               miner answer + signal_hash + X-TELEGRAPH-RECEIPT
                               │
                 evaluator ──► clear / flag / block / unknown
                               │   critical and not clean?
                               ├──► second miner (cross-check) ──► confirmed / disputed
                               │   finding implies more checks?
                               └──► follow-up checks (escalation)
                               ▼
               policy.decide() ──► GO / REVIEW / STOP
                               ▼
               memo: findings + evidence ledger, keccak256 digest, EIP-191 signature
```

| Path | Role |
|---|---|
| `src/telegraph/` | Engine client: discovery, ranked miners, quote, paid ask over x402, signal fetch and keccak256 hash recompute |
| `src/core/agent.ts` | Planner and runner: concurrency, cross-checks, escalations, events |
| `src/core/evaluators.ts` | Turn each miner answer into a verdict. Fields the miner did not return become `unknown`, never `clear` |
| `src/core/policy.ts` | The decision rule. No model decides the outcome |
| `src/core/budget.ts` | Per-run and per-day spend caps. A payment is reserved before signing and charged only on success |
| `src/core/memo.ts` | Canonical memo, digest, signature, Markdown |
| `src/packs/` | The three mission packs on shared check builders |
| `src/server.ts`, `web/` | Local API with an SSE run stream, and the web UI (no framework) |

### Decision rule

- **STOP**: a blocking finding that a second miner confirmed, or one from a non-critical source.
- **REVIEW**: any flag; any unconfirmed or disputed block; a critical check with no usable answer;
  miners disagreeing; or fewer than two thirds of checks answered.
- **GO**: everything else, which means every check came back clean.

### Verifying a memo

A memo carries every evidence item with its signal hash, its miner, its cost and its settlement
receipt. `verify` does three things:

1. Recomputes the memo digest and recovers the signer.
2. Fetches each signal from `GET /engine/v1/signal/{hash}`.
3. Recomputes keccak256 over the key-sorted payload and confirms the agent wallet paid for it.

Editing any field breaks the digest.

## Evidence: recorded runs

Three real runs on 2026-11-09, all paid autonomously by the agent wallet
`0x77301A935d97F9c08d1F50829060B0Eb31346d5E` in Telegraph test USDC on Sepolia (`eip155:11155111`),
$0.01 per signal, settled on chain. The full memos, with every miner answer and receipt, are in
[`examples/`](examples/). Re-check any of them with `npm run cs -- verify <memo-id>`.

| Memo | Subject | Decision | Paid signals | Cost |
|---|---|---|---|---|
| [`exchange-2026-11-09-58b7f27b`](examples/exchange-2026-11-09-58b7f27b.md) | Uniswap (UNI) listing | REVIEW | 5 | $0.05 |
| [`commodities-2026-11-09-f62362d5`](examples/commodities-2026-11-09-f62362d5.md) | Trafigura cargo | GO (proceed) | 5 | $0.05 |
| [`legal-2026-11-09-3b328f17`](examples/legal-2026-11-09-3b328f17.md) | Revolut Ltd | GO (clear) | 8 (7 checks + 1 cross-check) | $0.08 |

Each signal can be fetched at `https://devnode.telegraphprotocol.com/engine/v1/signal/<signal_hash>`, and
each transaction viewed at `https://sepolia.etherscan.io/tx/<tx_hash>`.

| Memo | Intent | Verdict | `signal_hash` | Settlement `tx_hash` |
|---|---|---|---|---|
| exchange | SMART_CONTRACT_AUDIT_GENERAL | clear | `0xac63848d1a2c2442183cef4c3eb41c7595f4171b8cc180d51652e55deb796ecd` | `0x32f0b18c82ae4cf25de685bcbc7131e1863a1901eac50656bc58f84b1e24ccd4` |
| exchange | SOCIAL_BOT_DETECTION_GENERAL | unknown | `0x15b689c8f3aebbe3004c61b916e07252d210db6245a76bd251a717f3b4361eef` | `0xf6a21e7faf707326966ca119f83153eae4f5898853ccadd3f5c86d0cb04884de` |
| exchange | NEWS_SEARCH_GENERAL | flag | `0xd00e6d3f4f936405083118197b1f79060847093ec7ed47b73bcc7810436b85a9` | `0x09bbe1bcf574b65ca03b7fde3191042fe47cc4c0a92ccabac73030f64628eb80` |
| exchange | SANCTIONS_SCREENING_MATCH_GENERAL | clear | `0xe0503456021c3dc7569d52d5b40dd1134b018009431ebbf53b27eb0d2ec50315` | `0x203eacd4f1e9d106e377d70a773193a1ab7d6faebda8b1b6bc45c4d38152d54e` |
| exchange | ONCHAIN_METRIC_VERIFY_GENERAL | unknown | `0x4e42f67364994201dc3599fc4f30a3ce561513a93ec3ca3ab3603590c56b9155` | `0x418acc350424f969cc3768d2d127632afec6ce9753856585a5ad1f49ef0c279b` |
| commodities | SANCTIONS_SCREENING_MATCH_GENERAL | clear | `0xe7b11952dce761e437736ca535aed420d4d1b2edc6c631d9ed4083265d5f3192` | `0xcf5a0f1dfa369b9408202102c8fcd06f6c6b51b380570e3ad21ce42cb5fe0439` |
| commodities | SANCTIONS_SCREENING_MATCH_GENERAL | clear | `0x39f5719ff17e33a40232aa16d879a0b53224aefce1252127815b18b91ee2cfff` | `0x5332c2a8077d77daf16a304ce04873e15c66175cf31e38146a12a12835e7ae43` |
| commodities | CORPORATE_REGISTRY_LOOKUP_GENERAL | clear | `0xacc7d89d6924b28fc38b7dce9cf28928ed1a236d712a57bac0b027ff30c9871a` | `0x63a949337ee3d2dc6143d0e97c657efda948f68804f5cd9cd8be9c20e42709e0` |
| commodities | VESSEL_TELEMETRY_VERIFY_GENERAL | clear | `0x2172e32a1769f4f675f4a18bd05288eb6b2e89e6ca60a4f833d330f52a385fb7` | `0xd4ae4fb0ccdb2472c6bb1b98fd9ffe26b6e5d8c873381a1397b2224658128a93` |
| commodities | LIVE_PORT_CONGESTION_GENERAL | unknown | `0xc32c453eeb472043cb4e9f1b56f572a4195a0395de909bc96a1ca1c7859dac61` | `0x04078eafb76c67fbbdbf76e8d0f6c2eddbd99c0e8f9b0454e983dc789dd48dec` |
| legal | SANCTIONS_SCREENING_MATCH_GENERAL | clear | `0x7f673b3d3ff85b0561bfc4dd0fcaa59188ed05adcd8342002f6e94db467a6921` | `0x30f0d603d2d9fdb5bc612d4daf534a8803be5ef8a1b44b1ce3f505b439732840` |
| legal | SANCTIONS_SCREENING_MATCH_GENERAL | clear | `0x6604f7fd059250cc4c97ed861974f7105da3b4a77581c200ab890f28c0afd37b` | `0xd19462c25ef59d5e742fccb3c2ec5b43f7361d6c4eb048b7e953670769cf9e4a` |
| legal | CORPORATE_REGISTRY_LOOKUP_GENERAL | clear | `0x8b7a659fa196e0fcdf7503f6d967c409a446df544541f941ac9d65b1ae0400e1` | `0xa7c706efa797118c9648e6a9f36883c2aabad79bb5ffca7fd7f92d16f840cf33` |
| legal | CORPORATE_REGISTRY_LOOKUP_GENERAL | unknown | `0x0b3fde8e7ddbeebed23a014f153f3c031492975dfe53d11f962b9279adf9c096` | `0x51b62c53070879b9a740c4801f9fd6dbe1689a1012564355506428b83849a74c` |
| legal | NEWS_SEARCH_GENERAL | unknown | `0xd39a7e352d8b2da364399d55f76aa3e420692b9aceb0ed6ffd9347dcedd23fb6` | `0x10e84bdfb68464f6737f454a3e6fd1e36863b5329ceb5c77f054b9e79c066d7f` |
| legal | REGULATORY_FILING_MONITOR_GENERAL | unknown | `0xe8f544739a9feae64952f5cd8c23a3ded5aa5cb334bce48033a9b7452b0dbe5d` | `0x471cf01f03c271b2fe0201a128c356c767d97eb8aa9733223d125b1145a0a8e2` |
| legal | B2B_IDENTITY_ENRICHMENT_GENERAL | clear | `0x31189586ac9d47f6af23741f81f0f5297dd99f960d9933cdf166dba7fc9b8db7` | `0xa40c7b2cfed25aab15993803a45e7ce4168ce5e974144b16a4624c2df3be2e94` |
| legal (cross-check) | CORPORATE_REGISTRY_LOOKUP_GENERAL | clear | `0xa617c485d4dc62542577a262d949a7b9e68a5f8a574880b458e04b8284b85e26` | `0x42c0abeb8dab461d7d8edd4bde981bf12edd41873e34a0963934dab1dc88ea9b` |

## Limitations

Countersign is a hackathon MVP on testnet. Read its memos with these limits in mind:

- **It is only as good as the miners.** Countersign does not check registries, sanctions lists or
  vessels itself. It buys answers from Telegraph miners and judges whether each answer is usable. A
  miner that returns a wrong but well-formed answer can produce a wrong verdict. Cross-checks with a
  second miner reduce this risk but do not remove it.
- **`unknown` means not verified.** When a miner returns no answer, an error, or leaves the
  fields a check needs empty (`field_status`), the finding is `unknown` (unverified), never `clear`.
  A critical check left `unknown`, or fewer than two thirds of checks answered, forces REVIEW. Six
  of the eighteen recorded signals above came back `unknown`.
- **GO is not legal or compliance advice.** It means every check the pack ordered came back clean
  from the miners that answered. A human still signs off.
- **Coverage is limited to live intents.** Packs use only the Telegraph intents that had miners on
  the devnode during the event. A check a real desk would order but no live intent serves is not
  covered, and a memo lists only the checks it actually bought.
- **Testnet only.** Payments are in Telegraph test USDC on Sepolia. Mainnet would need a funded wallet,
  real-money spend caps reviewed by the operator, and miners priced for production.
- **A valid signature proves authorship, not correctness.** `verify` proves that the wallet in
  `memo.agent` signed this exact memo and that every cited signal exists, matches its keccak hash and
  was paid by that wallet. It does not re-derive findings or the decision from the signal payloads,
  and it does not pin which wallet counts as "the" Countersign agent. Check the agent address
  against the one you expect.
- **Requests are public.** See Safety.
- **One agent at a time.** The local server runs one run at a time and keeps memos on disk in
  `data/`. It has no accounts and is not meant to be exposed beyond 127.0.0.1.

## Safety

- **Telegraph requests are public.** The Daemon feed shows each query and the payer wallet. Use public
  company, vessel and token names only, and a throwaway testnet key.
- `.env` holds the private key and is gitignored. Never commit it.
- Spend caps live in `.env`: `MAX_USD_PER_RUN`, `MAX_USD_PER_DAY` and `MAX_ATOMIC_PER_PAYMENT`. The
  agent refuses to sign any payment that would cross a cap. Engine errors (400, 422, 429, 503) come
  back before payment and cost nothing.
- The server binds to 127.0.0.1 and runs one agent at a time. It answers only to loopback Host
  names (add more with `ALLOWED_HOSTS`), refuses cross-origin POSTs and accepts only
  `application/json` bodies, so another site open in the browser cannot start a paid run.
- An evaluator never fails open: a verdict outside the intent's enum, or an evaluator error, is
  `unknown`, and a crashed check still reaches the policy as `unknown`.

## Tests

```bash
npm test            # policy, evaluators, signal hash against a real devnode signal, memo signing, budget caps
npm run typecheck
```

## What is borrowed

Built during the event. The agent, packs, policy, memo format, server and the agent UI (`web/app.html`,
`web/app.js`, `web/styles.css`) are original code. Borrowed parts:

- **Landing page kit.** `web/index.html` is built on the design kit of
  [taste-skill](https://www.tasteskill.dev) (design-taste-frontend). Everything under `web/assets/` is
  that kit, copied unchanged: CSS system, motion layer, UI fragments, diagrams and the starter
  template. The kit is MIT licensed, copyright (c) 2026 Leonxlnx
  ([github.com/Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)), and its license is
  kept in [`web/assets/LICENSE`](web/assets/LICENSE). The page CSS inside `web/index.html` and
  all of its copy are ours.
- **Libraries:** [`viem`](https://viem.sh), [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch)
  and [`@x402/evm`](https://www.npmjs.com/package/@x402/evm) for wallets and x402 payments;
  `tsx` and `typescript` for development.
- **Fonts:** Figtree, Instrument Sans and DM Mono from Google Fonts (SIL Open Font License).
- **Data:** every check answer comes from Telegraph miners on the devnode. Countersign does not ship
  any sanctions list, registry or vessel data.

## License

MIT, see [LICENSE](LICENSE). The kit in `web/assets/` keeps its own MIT license and copyright,
see [`web/assets/LICENSE`](web/assets/LICENSE).
