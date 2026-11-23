# Public demo deployment

The public demo is served at https://countersign.ink by Caddy, with the Node application listening
on `127.0.0.1:4402`. One systemd service owns the agent, wallet and shared daily budget. Do not run
multiple replicas against the same wallet or data directory.

## Runtime

- Node.js 22.22.1, npm dependencies installed with `npm ci` and checked with `npm run typecheck`.
- Source and web assets: `/opt/countersign`.
- Secrets and environment: `/etc/countersign.env`, owned by root, mode `0600`.
- Memos and daily spend ledger: `/var/lib/countersign`, owned by the `countersign` service user.
- Caddy configuration: `/etc/caddy/Caddyfile` (template in this directory).
- systemd unit: `/etc/systemd/system/countersign.service`.
- Health endpoint: `/healthz` (process health, independent of Telegraph and Sepolia RPC availability).

The application uses `tsx` at runtime, so deployment installs development dependencies too.
No frontend bundling is required. The browser receives the files under `web/` directly.

## Required environment

Use `.env.example` for Telegraph, Sepolia, the throwaway testnet key and spend caps. Additionally set:

```dotenv
HOST=127.0.0.1
PORT=4402
ALLOWED_HOSTS=countersign.ink,www.countersign.ink
PUBLIC_ORIGIN=https://countersign.ink
TRUST_LOOPBACK_PROXY=true
COUNTERSIGN_DATA_DIR=/var/lib/countersign
```

The default caps are $0.25 per run and $2 per UTC day in **test USDC**. All visitors share the wallet,
run queue and public memo history. Visitors are limited by client IP; people sharing one network
also share its quota. Run quotas reset when the process restarts.

The current testnet uses `TELEGRAPH_PAYMENT_RAIL=escrow` on Ethereum Sepolia. Before opening
paid runs, use the same service wallet to fund the [current escrow contract](https://anjoman.ai/docs/using/escrow-inference)
with `npm run cs -- escrow:deposit --amount 0.25` or an operator-selected test USDC amount.
Confirm available credit with `npm run cs -- wallet`.

## Updates and operations

Back up `/etc/countersign.env` and `/var/lib/countersign` securely. Keep both out of source archives
and Git. Deploy code while no run is active; never overwrite the runtime data directory.

```sh
cd /opt/countersign
npm ci --no-audit --no-fund
npm run typecheck
systemctl restart countersign
systemctl status countersign caddy
journalctl -u countersign -n 50 --no-pager
curl --fail https://countersign.ink/healthz
```

Caddy obtains and renews HTTPS certificates automatically. DNS A records must point to the server;
`www` can be a CNAME to `countersign.ink`. Remove stale AAAA records unless IPv6 is configured.
