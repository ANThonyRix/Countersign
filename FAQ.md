# Countersign FAQ

Short answers about what Countersign is, how to run it and how to read what it produces.
For the full setup guide see [README.md](README.md).

---

## About the project

### What is Countersign?
Countersign is an autonomous due-diligence agent for counterparties. You give it a subject: a token, a
cargo seller and vessel, or a legal entity. It plans the checks a desk would order and buys each one
from a [Telegraph](https://anjoman.ai) miner, paying per answer. It then decides **GO / REVIEW / STOP**
with a fixed rule and issues a signed memo that anyone can re-verify.

It was built for Telegraph Hackathon Season II, track Apps & Agents.

### Who is it for?
Three kinds of desks, one per Telegraph commercial mission:

| Pack | Mission | Who uses it | Question it answers |
|---|---|---|---|
| `exchange` | 01 Exchange | Token listing desk at a spot or derivatives venue | Should we list this token? |
| `commodities` | 08 Commodities | Physical commodity trader | Is the seller real, is the ship clean, can it discharge on time? |
| `legal` | 04 Legal | Law firm or compliance team | Is this entity in good standing everywhere it operates? |

### What does each pack check?

| Pack | Checks | Optional checks |
|---|---|---|
| `exchange` | Sanctions on the issuing entity, smart-contract audit, adverse media | Bot detection on the X account, on-chain treasury balance, source code review |
| `commodities` | Seller registry and sanctions, vessel sanctions and telemetry, port congestion at discharge | Bill of lading authenticity |
| `legal` | Registry standing in each jurisdiction (up to 3), sanctions on the entity and each officer (up to 3), regulatory filings, adverse media, B2B identity | none |

A finding can trigger follow-up checks. A sanctions hit, a dead or missing registry record or a bot-run
audience makes the agent buy a targeted news search.

### Why buy each check from Telegraph instead of calling a data API?
- **Each answer comes from the miner ranked best for that intent.** Telegraph routes the request, so
  the agent never hardcodes a provider.
- **Each answer comes with proof.** A signed `signal_hash` and a settlement receipt show who answered,
  when, and that the agent paid for it.
- **You pay per answer.** Most checks cost $0.01, with no subscriptions and no API keys per vendor.

### Does an AI model make the decision?
No. Miners supply the answers. The decision is a deterministic rule in
[src/core/policy.ts](src/core/policy.ts):

- **STOP**: a blocking finding that a second miner confirmed, or one from a non-critical source.
- **REVIEW**: any flag; any unconfirmed or disputed block; a critical check with no usable answer;
  miners that disagree; or fewer than two thirds of checks answered.
- **GO**: everything else, which means every answered check came back clean.

The same inputs always give the same decision.

### Why do the decision labels differ between packs?
Each desk uses its own vocabulary for the same three outcomes:

| Rule outcome | `exchange` | `commodities` | `legal` |
|---|---|---|---|
| GO | LIST | PROCEED | CLEAR |
| REVIEW | REVIEW | HOLD | REVIEW |
| STOP | REJECT | BLOCK | ESCALATE |

The memo shows both, for example `Decision **PROCEED** (GO)`.

### What is a cross-check?
If a critical check comes back with anything other than a clean answer, the agent asks a second,
independent miner. The finding is then marked `confirmed` or `disputed`. A block that a second miner
does not confirm leads to REVIEW, never to STOP.

### Is this legal or investment advice?
No. Countersign reports what Telegraph miners answered and applies its own rule on top. It supports a
human decision and does not replace it.

---

## Getting started

### What do I need?
- Node.js 20.12 or newer (tested on Node 24).
- A small amount of Sepolia ETH (0.01–0.05) from any Sepolia faucet. It pays gas for minting test USDC.
- Nothing else. Telegraph test USDC is free to mint, and no account or API key is needed.

### How do I set it up?
```bash
npm install
npm run wallet:new        # creates a throwaway key in .env and prints the address
```
Send Sepolia ETH to the printed address, then:
```bash
npm run cs -- mint        # mints 10 test USDC to the agent wallet
npm run cs -- wallet      # shows address, ETH, test USDC, escrow credit and today's spend
```

### How do I try it without paying anything?
Ask for a quote. The node prices every request before payment, so a plan is free:
```bash
npm run cs -- plan exchange --example
```
It lists every check, its intent, its price and the worst-case cost with cross-checks.

### How do I run a real check?
```bash
npm run cs -- run exchange --example
npm run cs -- run commodities --example
npm run cs -- run legal --example
```
`--example` uses a built-in subject (Uniswap, Trafigura / EVER GIVEN, Revolut Ltd). The terminal
streams each purchase, each finding and the final decision.

### How do I check my own subject?
Pass fields as flags. `npm run cs -- packs` lists the fields of every pack and marks the required ones.

```bash
# Exchange
npm run cs -- run exchange --project "Uniswap" --token 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 \
  --entity "Universal Navigation Inc." --x @Uniswap

# Commodities
npm run cs -- run commodities --seller "Trafigura Pte Ltd" --jurisdiction Singapore \
  --vessel "EVER GIVEN" --imo 9811000 --port Rotterdam

# Legal
npm run cs -- run legal --entity "Revolut Ltd" --jurisdictions "United Kingdom, Lithuania" \
  --people "Nikolay Storonsky"
```

Required fields:

| Pack | Required | Optional |
|---|---|---|
| `exchange` | `--project`, `--token` | `--chain`, `--entity`, `--x`, `--treasury`, `--source` |
| `commodities` | `--seller`, `--jurisdiction`, `--vessel`, `--port` | `--imo`, `--document` |
| `legal` | `--entity`, `--jurisdictions` | `--people`, `--period` |

Add `--no-crosscheck` to skip second-miner checks and spend less.

### Is there a web interface?
Yes:
```bash
npm run serve
```
- http://127.0.0.1:4402/ is the landing page.
- http://127.0.0.1:4402/app.html is the agent. Pick a pack, fill the form or load the example, get a
  free quote, then run. Each purchase streams in live. The memo opens with its evidence ledger, and the
  **Verify** button re-checks every signal on the node.

### All CLI commands

| Command | What it does |
|---|---|
| `npm run cs -- wallet` | Agent address, Sepolia ETH, test USDC, escrow credit, today's spend |
| `npm run cs -- mint [--amount 10]` | Mint test USDC (needs Sepolia ETH for gas) |
| `npm run cs -- packs` | List packs and their fields |
| `npm run cs -- plan <pack> [fields]` | Free quote: planned checks and prices |
| `npm run cs -- run <pack> [fields]` | Real run: pays per check and writes a signed memo |
| `npm run cs -- verify <memo-id\|file.json>` | Re-check signature, digest and every signal hash |
| `npm run cs -- show <memo-id>` | Print a memo as Markdown |

---

## The memo

### What is in a memo?
Each run writes two files to `data/memos/`: `<pack>-<date>-<id>.json` and a Markdown copy. A memo has:

1. **Decision** with its label, the share of checks answered, and the total cost.
2. **Why**: the reasons behind the decision.
3. **Findings**: one row per check, with the verdict (CLEAR / FLAG / BLOCK / UNKNOWN), a summary,
   corroboration (single, confirmed or disputed) and the signal hash.
4. **Evidence ledger**: intent, miner, full signal hash, settlement receipt, cost, verified flag.
5. **Integrity**: agent wallet, keccak256 digest of the canonical JSON, EIP-191 signature.

See real memos in [examples/](examples/).

### What does UNKNOWN mean?
The miner returned no usable value for that field, or the request failed. Countersign never treats a
missing answer as clean. An UNKNOWN on a critical check leads to REVIEW.

### How do I verify a memo, mine or someone else's?
```bash
npm run cs -- verify exchange-2026-11-09-58b7f27b
npm run cs -- verify path/to/memo.json
```
Verification does three things:
1. Recomputes the memo digest and recovers the signer from the signature.
2. Fetches every signal from `GET https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`.
3. Recomputes keccak256 over the signal payload and confirms the agent wallet paid for it.

Changing any field in the memo breaks the digest. You can also open any signal URL in a browser.

---

## Cost and safety

### How much does a run cost?
Most checks cost $0.01 in test USDC. A typical run costs $0.05–$0.08. Cross-checks and follow-up
checks add a few cents. The free `plan` command prints the base cost and the worst case before you pay.

### What stops the agent from overspending?
Three caps in `.env`. The agent refuses to sign any payment that would cross one:

| Variable | Default | Meaning |
|---|---|---|
| `MAX_USD_PER_RUN` | `0.25` | Budget for one run |
| `MAX_USD_PER_DAY` | `2.00` | Budget per day across all runs |
| `MAX_ATOMIC_PER_PAYMENT` | `100000` | Ceiling for one payment, in 6-decimal units ($0.10) |

The budget is reserved before signing and charged only when the payment succeeds. Engine errors (400,
422, 429, 503) come back before payment and cost nothing.

### Are my queries private?
**No.** Every Telegraph request is public. The Daemon feed shows the query and the payer wallet. Use
only public company, vessel and token names, and only a throwaway testnet key. Do not put client names
or confidential deal terms into a run.

### Where is the private key, and is it safe?
In `.env`, which is gitignored. `npm run wallet:new` generates a fresh throwaway key. Never commit
`.env` and never reuse a key that holds real funds.

### Is this mainnet money?
No. Countersign runs on Ethereum Sepolia with Telegraph test USDC
(`0xcc194e1a843B658526D0D5C431f670028582Ae17`). Telegraph plans to move to mainnet with the same
contracts and settlement path.

---

## Troubleshooting

| Message or symptom | Cause | Fix |
|---|---|---|
| `AGENT_PRIVATE_KEY is missing or malformed` | No key in `.env` | `npm run wallet:new` |
| Mint fails | No Sepolia ETH for gas | Fund the address from a Sepolia faucet |
| Finding says `Not bought: run budget of $0.25 reached` | `MAX_USD_PER_RUN` or `MAX_USD_PER_DAY` reached | Raise the cap in `.env` or run again tomorrow |
| Paid checks fail across the board | Not enough test USDC in the wallet | `npm run cs -- wallet`, then `npm run cs -- mint` |
| `429` | More than 60 new questions per minute | Wait a minute. The agent already limits itself to 4 parallel requests |
| `503 no_compatible_miner` | No miner serves that intent right now | Check shows as UNKNOWN; retry later |
| Many UNKNOWN findings | Miners answered without the needed fields | The memo still records what was paid; the decision falls back to REVIEW |
| `verify` shows `BAD` for a signal | Node unreachable or the memo was edited | Retry; if it persists, the memo is not trustworthy |
| Web UI shows a run already in progress | The server runs one agent at a time | Wait for the current run to finish |

---

## For developers

### Where is the code?

| Path | Role |
|---|---|
| `src/telegraph/` | Engine client: intents, ranked miners, quote, paid ask over x402, signal verification |
| `src/core/agent.ts` | Planner and runner: concurrency, cross-checks, follow-up checks, events |
| `src/core/evaluators.ts` | Turns each miner answer into a verdict |
| `src/core/policy.ts` | The decision rule |
| `src/core/budget.ts` | Spend caps |
| `src/core/memo.ts` | Memo, digest, signature, Markdown |
| `src/packs/` | The three packs |
| `src/server.ts`, `web/` | Local API and web UI |

### Is there an HTTP API?
The local server (`npm run serve`, bound to 127.0.0.1) exposes:

| Method and path | What it does |
|---|---|
| `GET /api/status` | Node, network, wallet, budget, current run |
| `GET /api/packs` | Packs and their fields |
| `POST /api/plan` | Free quote. Body: `{ "pack": "exchange", "subject": { ... } }` |
| `POST /api/runs` | Start a run. Same body. Returns a run id |
| `GET /api/runs/<id>/events` | Live run events (Server-Sent Events) |
| `GET /api/memos` | List memos |
| `GET /api/memos/<id>` | One memo as JSON |
| `GET /api/memos/<id>/verify` | Verify a memo |

### How do I add a new pack?
Copy one of the files in `src/packs/`, define its `fields`, `example`, `labels` and the checks it plans
from the shared builders in `src/packs/checks.ts`, then register it in `src/packs/index.ts`. The agent,
budget, policy, memo and web UI pick it up without changes.

### How do I run the tests?
```bash
npm test          # policy, evaluators, signal hash on a real devnode signal, memo signing, budget caps
npm run typecheck
```
