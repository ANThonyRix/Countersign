// Countersign web client. No framework: all text goes through textContent, never innerHTML,
// because miner answers are untrusted input.

const $ = (sel) => document.querySelector(sel);
const stage = $("#stage");

const state = {
  packs: [],
  pack: null,
  drafts: {},
  status: null,
  memos: [],
  source: null,
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  return body;
}

const usd = (n, digits = 2) => `$${Number(n || 0).toFixed(digits)}`;
const short = (h, a = 6, b = 4) => (h && h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h || "");
const when = (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const tag = (cls, text) => el("span", { class: `tag ${cls}`, text: text ?? cls });
const packById = (id) => state.packs.find((p) => p.id === id);
const signalUrl = (hash) => `${state.status?.node ?? "https://devnode.telegraphprotocol.com"}/engine/v1/signal/${hash}`;
const isMobile = () => matchMedia("(max-width: 900px)").matches;

function focusStage() {
  stage.focus({ preventScroll: true });
  if (isMobile()) stage.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// ---------- status bar ----------

async function loadStatus() {
  try {
    state.status = await api("/api/status");
  } catch (err) {
    state.status = { error: err.message };
  }
  renderWallet();
  updateRunAvailability();
}

function renderWallet() {
  const box = $("#wallet");
  const s = state.status;
  $("#network-chip").classList.toggle("down", !!s?.error);
  if (!s || s.error) return box.replaceChildren(el("span", { class: "muted", text: "Node unreachable" }));
  const w = s.wallet;
  if (!w) return box.replaceChildren(el("span", { class: "muted", text: "No agent wallet" }));
  if (w.error) return box.replaceChildren(el("span", { class: "muted", text: "Wallet RPC unavailable" }));
  box.replaceChildren(
    el("dl", {},
      el("div", { class: "w-addr" }, el("dt", { text: "Agent" }), el("dd", {}, el("a", { href: w.explorer, target: "_blank", rel: "noopener", text: short(w.address) }))),
      el("div", {}, el("dt", { text: "Test USDC" }), el("dd", { text: Number(w.usdc).toFixed(2) })),
      el("div", { class: "w-day" }, el("dt", { text: "Spent today" }), el("dd", { text: `${usd(s.budget.spentUsd)} / ${usd(s.budget.capUsd)}` })),
    ),
  );
}

function runBlocker() {
  const s = state.status;
  if (!s || s.error) return "The server cannot reach the Telegraph node right now.";
  if (s.running) return "A run is already in progress.";
  if (!s.wallet) return "No agent wallet yet. Run `npm run wallet:new` on the server.";
  if (s.wallet.error) return "Cannot read the wallet balance from Sepolia.";
  if (Number(s.wallet.usdc) < 0.1) return "The agent wallet needs test USDC. Run `npm run cs -- mint` on the server.";
  if (s.budget.spentUsd >= s.budget.capUsd) return "Today's spend cap is used up.";
  return null;
}

function updateRunAvailability() {
  const blocker = runBlocker();
  const btn = $("#run-btn");
  if (btn.getAttribute("aria-busy") !== "true") btn.disabled = !!blocker;
  const hint = $("#run-hint");
  hint.hidden = !blocker;
  hint.textContent = blocker ?? "";
}

// ---------- composer ----------

function renderPacks() {
  const box = $("#packs");
  box.querySelectorAll(".pack-opt").forEach((n) => n.remove());
  for (const p of state.packs) {
    const id = `pack-${p.id}`;
    box.append(
      el("div", { class: "pack-opt" },
        el("input", { type: "radio", name: "pack", id, value: p.id, checked: p.id === state.pack?.id, onchange: () => selectPack(p.id) }),
        el("label", { for: id }, el("strong", { text: p.mission.split(":")[0] }), el("span", { text: p.title })),
      ),
    );
  }
}

function saveDraft() {
  if (!state.pack) return;
  state.drafts[state.pack.id] = readForm();
}

function selectPack(id) {
  saveDraft();
  state.pack = packById(id);
  $("#pack-tagline").textContent = state.pack.tagline;
  $("#estimate").textContent = "";
  renderFields();
}

function renderFields() {
  const draft = state.drafts[state.pack.id] ?? {};
  const box = $("#fields");
  box.replaceChildren(
    ...state.pack.fields.map((f) => {
      const id = `f-${f.name}`;
      const helpId = `${id}-help`;
      const errId = `${id}-err`;
      const common = {
        id,
        name: f.name,
        placeholder: f.placeholder ?? "",
        "aria-describedby": `${f.help || f.type === "list" ? helpId : ""} ${errId}`.trim(),
        required: !!f.required,
        "data-type": f.type,
        autocomplete: "off",
        spellcheck: f.type === "address" || f.type === "textarea" ? "false" : null,
      };
      const control = f.type === "textarea" ? el("textarea", { ...common, rows: 4 }) : el("input", { ...common, type: "text" });
      control.value = draft[f.name] ?? "";
      control.addEventListener("input", () => control.closest(".field").classList.remove("invalid"));
      const help = f.help ?? (f.type === "list" ? "Separate entries with commas." : null);
      return el("div", { class: "field" },
        el("label", { for: id }, f.label, f.required ? el("span", { class: "req", "aria-hidden": "true", text: "*" }) : null),
        control,
        help ? el("span", { class: "help", id: helpId, text: help }) : null,
        el("span", { class: "err", id: errId }),
      );
    }),
  );
}

function readForm() {
  const out = {};
  for (const f of state.pack?.fields ?? []) {
    const node = document.getElementById(`f-${f.name}`);
    if (node) out[f.name] = node.value.trim();
  }
  return out;
}

function validate() {
  let first;
  for (const f of state.pack.fields) {
    const node = document.getElementById(`f-${f.name}`);
    const v = node.value.trim();
    let msg = "";
    if (f.required && !v) msg = `${f.label} is required.`;
    else if (v && f.type === "address" && !/^0x[0-9a-fA-F]{40}$/.test(v)) msg = "Enter a 0x address with 40 hex characters.";
    const field = node.closest(".field");
    field.classList.toggle("invalid", !!msg);
    node.setAttribute("aria-invalid", msg ? "true" : "false");
    field.querySelector(".err").textContent = msg;
    if (msg && !first) first = node;
  }
  first?.focus();
  return !first;
}

function showFormError(message) {
  const box = $("#form-error");
  box.hidden = !message;
  box.textContent = message ?? "";
}

function setBusy(btn, busy, label) {
  btn.setAttribute("aria-busy", busy ? "true" : "false");
  btn.disabled = busy;
  if (label) btn.textContent = label;
}

async function onQuote() {
  showFormError();
  if (!validate()) return;
  const btn = $("#quote-btn");
  setBusy(btn, true, "Quoting…");
  try {
    const result = await api("/api/plan", { method: "POST", body: JSON.stringify({ pack: state.pack.id, subject: readForm() }) });
    $("#estimate").textContent = `About ${usd(result.estimate.baseUsd)}, up to ${usd(result.estimate.worstCaseUsd)}`;
    location.hash = "#/quote";
    renderQuote(result);
    focusStage();
  } catch (err) {
    showFormError(err.message);
  } finally {
    setBusy(btn, false, "Get free quote");
  }
}

async function onRun(e) {
  e.preventDefault();
  showFormError();
  if (!validate()) return;
  const btn = $("#run-btn");
  setBusy(btn, true, "Starting…");
  try {
    const { runId } = await api("/api/runs", { method: "POST", body: JSON.stringify({ pack: state.pack.id, subject: readForm() }) });
    location.hash = `#/run/${runId}`;
    focusStage();
  } catch (err) {
    showFormError(err.message);
  } finally {
    setBusy(btn, false, "Run diligence");
    loadStatus();
  }
}

// ---------- memo history ----------

async function loadMemos() {
  try {
    state.memos = await api("/api/memos");
  } catch {
    state.memos = [];
  }
  renderMemoList();
}

function renderMemoList() {
  const list = $("#memo-list");
  if (!state.memos.length) {
    return list.replaceChildren(el("li", { class: "muted small", text: "No memos yet. Your first run writes one here." }));
  }
  const current = location.hash.startsWith("#/memo/") ? decodeURIComponent(location.hash.slice(7)) : null;
  list.replaceChildren(
    ...state.memos.map((m) =>
      el("li", {},
        el("a", { href: `#/memo/${encodeURIComponent(m.id)}`, "aria-current": m.id === current ? "page" : null },
          tag(m.decision, m.decision_label),
          el("span", { style: "min-width:0" },
            el("span", { class: "m-sub", text: m.subject, style: "display:block" }),
            el("span", { class: "m-meta", text: `${packById(m.pack)?.mission.split(":")[0] ?? m.pack} · ${when(m.created_at)}${m.source === "example" ? " · example" : ""}` }),
          ),
          el("span", { class: "m-cost", text: usd(m.cost_usd) }),
        ),
      ),
    ),
  );
}

// ---------- views ----------

function renderIntro() {
  stage.replaceChildren($("#intro-tpl").content.cloneNode(true));
}

function viewHead(title, sub, action) {
  return el("div", { class: "view-head" }, el("div", {}, el("h1", { text: title }), sub ? el("p", { class: "sub", text: sub }) : null), action ?? null);
}

function renderQuote(result) {
  const ok = result.checks.filter((c) => c.ok);
  const failed = result.checks.filter((c) => !c.ok);
  stage.replaceChildren(
    el("div", { class: "view" },
      viewHead(`Quote: ${state.pack.title}`, "Nothing was paid. The node priced each request before payment."),
      el("dl", { class: "stats" },
        stat("Checks planned", String(result.checks.length)),
        stat("Base cost", usd(result.estimate.baseUsd)),
        stat("With cross-checks", usd(result.estimate.worstCaseUsd)),
        stat("Run budget", usd(result.estimate.budgetUsd)),
      ),
      el("section", { class: "card", "aria-labelledby": "q-checks" },
        el("h2", { id: "q-checks", text: "Checks the agent will buy" }),
        el("ul", { class: "rows" },
          ...result.checks.map((c) =>
            el("li", {},
              c.ok ? tag("clear", "priced") : tag("block", String(c.status)),
              el("div", {},
                el("div", { class: "r-title", text: c.title }),
                el("div", { class: "r-sub" }, el("span", { class: "mono", text: c.intent }), c.critical ? " · critical, cross-checked on a hit" : "", c.ok ? "" : ` · ${c.code}`),
                c.problems ? el("div", { class: "r-sub", style: "color:var(--stop)", text: JSON.stringify(c.problems) }) : null,
              ),
              el("span", { class: "r-end", text: c.ok ? usd(c.priceUsd, 4) : "n/a" }),
            ),
          ),
        ),
        failed.length && ok.length
          ? el("p", { class: "small muted", style: "margin-top:var(--s4)", text: `${failed.length} check(s) would fail and are not charged. The run skips them and marks coverage.` })
          : null,
      ),
    ),
  );
}

function stat(label, value) {
  return el("div", { class: "stat" }, el("dt", { text: label }), el("dd", { text: value }));
}

// ---------- live run ----------

function attachRun(runId) {
  state.source?.close();
  const rows = new Map();
  let spent = 0;
  let paid = 0;
  const list = el("ul", { class: "rows" });
  const log = el("ul", { class: "log", "aria-live": "polite" });
  const spentEl = el("dd", { text: usd(0, 4) });
  const callsEl = el("dd", { text: "0" });
  const doneEl = el("dd", { text: "0 / 0" });
  const statusEl = el("dd", {}, el("span", { class: "pulse", text: "Running" }));
  const decisionBox = el("div");

  stage.replaceChildren(
    el("div", { class: "view" },
      viewHead("Run in progress", "The agent is buying checks from Telegraph miners. Each paid answer appears below as it lands."),
      el("dl", { class: "stats" },
        el("div", { class: "stat" }, el("dt", { text: "Status" }), statusEl),
        el("div", { class: "stat" }, el("dt", { text: "Spent" }), spentEl),
        el("div", { class: "stat" }, el("dt", { text: "Paid calls" }), callsEl),
        el("div", { class: "stat" }, el("dt", { text: "Findings" }), doneEl),
      ),
      decisionBox,
      el("div", { class: "grid-2" },
        el("section", { class: "card", "aria-labelledby": "r-checks" }, el("h2", { id: "r-checks", text: "Checks" }), list),
        el("section", { class: "card", "aria-labelledby": "r-log" }, el("h2", { id: "r-log", text: "Ledger feed" }), log),
      ),
    ),
  );

  const addLog = (text, cls) => {
    log.append(el("li", { class: cls, text: `${new Date().toLocaleTimeString()}  ${text}` }));
    log.scrollTop = log.scrollHeight;
  };
  const countDone = () => {
    const all = [...rows.values()];
    doneEl.textContent = `${all.filter((r) => r.done).length} / ${all.length}`;
  };
  const addRow = (id, title, sub, child) => {
    if (rows.has(id)) return rows.get(id);
    const tagEl = tag("pending", "queued");
    const subEl = el("div", { class: "r-sub", text: sub });
    const endEl = el("span", { class: "r-end", text: "" });
    const li = el("li", { class: child ? "child" : null }, tagEl, el("div", {}, el("div", { class: "r-title", text: title }), subEl), endEl);
    list.append(li);
    const row = { li, tagEl, subEl, endEl, cost: 0, done: false };
    rows.set(id, row);
    countDone();
    return row;
  };
  const setTag = (row, cls, text) => row.tagEl.replaceWith((row.tagEl = tag(cls, text)));

  const source = new EventSource(`/api/runs/${runId}/events`);
  state.source = source;
  source.onmessage = (msg) => {
    const e = JSON.parse(msg.data);
    switch (e.type) {
      case "plan":
        for (const c of e.checks) addRow(c.id, c.title, `${c.intent}${c.critical ? " · critical" : ""}`);
        addLog(`planned ${e.checks.length} checks, estimate ${usd(e.estimateUsd)}`);
        break;
      case "check_start": {
        const row = addRow(e.checkId, e.title, "", true);
        setTag(row, "buying", e.role === "crosscheck" ? "2nd miner" : "buying");
        row.tagEl.classList.add("pulse");
        addLog(`${e.role === "crosscheck" ? "cross-checking" : "buying"} ${e.title}${e.miner ? ` via ${e.miner}` : ""}`);
        break;
      }
      case "evidence": {
        const ev = e.evidence;
        const row = rows.get(ev.checkId);
        if (ev.error) addLog(`${ev.intent}: ${ev.error}`, "bad");
        else {
          spent += ev.costUsd;
          paid += ev.costUsd > 0 ? 1 : 0;
          spentEl.textContent = usd(spent, 4);
          callsEl.textContent = String(paid);
          addLog(`paid ${usd(ev.costUsd, 4)} to ${ev.minerName ?? ev.minerId ?? "miner"} · signal ${short(ev.signalHash, 10, 6)}`);
        }
        if (row) {
          row.cost += ev.costUsd || 0;
          row.endEl.textContent = usd(row.cost, 4);
          if (ev.minerName || ev.minerId) row.subEl.textContent = `${ev.intent} · ${ev.minerName ?? ev.minerId}`;
        }
        break;
      }
      case "finding": {
        const f = e.finding;
        const row = addRow(f.checkId, f.title, "", !!f.escalatedFrom);
        setTag(row, f.skipped ? "unknown" : f.verdict, f.skipped ? "skipped" : f.verdict);
        row.subEl.textContent = f.summary + (f.corroboration === "confirmed" ? " · confirmed by 2nd miner" : f.corroboration === "disputed" ? " · disputed by 2nd miner" : "");
        row.done = true;
        countDone();
        break;
      }
      case "escalate":
        for (const c of e.checks) addRow(c.id, c.title, `follow-up: ${e.reason}`, true);
        addLog(`escalating: ${e.checks.map((c) => c.title).join(", ")}`, "warn");
        break;
      case "skip": {
        const row = rows.get(e.checkId);
        if (row) {
          setTag(row, "unknown", "skipped");
          row.subEl.textContent = e.reason;
          row.done = true;
          countDone();
        }
        addLog(`skipped ${e.checkId}: ${e.reason}`, "warn");
        break;
      }
      case "verify":
        addLog(`signal ${e.ok ? "verified" : "NOT verified"} for ${e.evidenceId}`, e.ok ? null : "bad");
        break;
      case "decision":
        decisionBox.replaceChildren(decisionBlock(e.decision, e.label, e.reasons));
        addLog(`decision ${e.label}`);
        break;
      case "error":
        addLog(e.message, "bad");
        break;
    }
  };
  source.addEventListener("end", (msg) => {
    source.close();
    const { memoId, error } = JSON.parse(msg.data);
    statusEl.replaceChildren(document.createTextNode(error ? "Failed" : "Done"));
    loadStatus();
    loadMemos();
    if (error) decisionBox.replaceChildren(el("div", { class: "error-box", role: "alert", text: `Run failed: ${error}` }));
    else if (memoId) setTimeout(() => (location.hash = `#/memo/${encodeURIComponent(memoId)}`), 900);
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) addLog("lost connection to the run stream", "bad");
  };
}

function decisionBlock(decision, label, reasons) {
  return el("section", { class: `decision ${decision}`, "aria-label": `Decision ${label}` },
    el("div", { class: "decision-label", text: label }),
    el("ul", {}, ...reasons.map((r) => el("li", { text: r }))),
  );
}

// ---------- memo ----------

async function renderMemo(id) {
  stage.replaceChildren(el("p", { class: "muted pulse", text: "Loading memo…" }));
  let memo;
  try {
    memo = await api(`/api/memos/${encodeURIComponent(id)}`);
  } catch (err) {
    return stage.replaceChildren(el("div", { class: "error-box", role: "alert", text: `Could not load memo ${id}: ${err.message}` }));
  }
  renderMemoList();
  const pack = packById(memo.pack);
  const evidenceById = new Map(memo.evidence.map((e) => [e.id, e]));
  const verifyCells = new Map();

  const ledgerRows = memo.evidence.map((e) => {
    const vCell = el("td", { class: "mono", text: e.signalHash ? "not checked" : "n/a" });
    if (e.signalHash) verifyCells.set(e.id, vCell);
    return el("tr", {},
      el("td", {}, el("div", { text: memo.findings.find((f) => f.checkId === e.checkId)?.title ?? e.checkId }), el("div", { class: "small muted mono", text: e.routedIntent ?? e.intent })),
      el("td", { class: "nowrap", text: e.role === "crosscheck" ? "2nd miner" : "primary" }),
      el("td", { class: "nowrap", text: e.minerName ?? e.minerId ?? "router" }),
      el("td", {}, e.error ? tag("block", "error") : tag(e.verdict ?? "unknown")),
      el("td", { class: "num", text: usd(e.costUsd, 4) }),
      el("td", { class: "mono" }, e.signalHash ? el("a", { href: signalUrl(e.signalHash), target: "_blank", rel: "noopener", text: short(e.signalHash, 10, 6) }) : el("span", { class: "muted", text: e.error ? short(e.error, 40, 0) : "none" })),
      el("td", { class: "mono" }, e.receipt?.tx_hash ? el("a", { href: `https://sepolia.etherscan.io/tx/${e.receipt.tx_hash}`, target: "_blank", rel: "noopener", text: short(e.receipt.tx_hash) }) : el("span", { class: "muted", text: "batched" })),
      vCell,
    );
  });

  const verifyBtn = el("button", { class: "btn btn-primary", type: "button", text: "Verify memo" });
  const verifyOut = el("div", { class: "verify-out", "aria-live": "polite" });
  verifyBtn.addEventListener("click", async () => {
    setBusy(verifyBtn, true, "Verifying…");
    verifyOut.replaceChildren(el("p", { class: "muted small", text: "Recomputing the digest, recovering the signer and fetching every signal from the node…" }));
    try {
      const v = await api(`/api/memos/${encodeURIComponent(memo.id)}/verify`);
      for (const s of v.signals) {
        const cell = verifyCells.get(s.evidenceId);
        if (!cell) continue;
        const good = s.found && s.nodeVerified && s.localHashMatch && !s.error;
        cell.className = `mono ${good ? "ok" : "bad"}`;
        cell.textContent = good
          ? "node ✓ keccak ✓"
          : !s.found
            ? "not on node"
            : s.error
              ? "wrong payer"
              : `node ${s.nodeVerified ? "✓" : "✗"} keccak ${s.localHashMatch ? "✓" : "✗"}`;
        if (s.error) cell.title = s.error;
      }
      const okSignals = v.signals.filter((s) => s.found && s.nodeVerified && s.localHashMatch && !s.error).length;
      verifyOut.replaceChildren(
        el("p", { class: `result ${v.ok ? "ok" : "bad"}`, text: v.ok ? "Memo verified." : "Memo failed verification." }),
        el("p", { class: "small muted", text: `Digest ${v.signature.digestMatches ? "matches" : "does not match"} content. Signer ${v.signature.signerMatches ? "is" : "is not"} the agent. ${okSignals} of ${v.signals.length} signals verified on the node and by local keccak256. Checked ${when(v.checkedAt)}.` }),
      );
    } catch (err) {
      verifyOut.replaceChildren(el("p", { class: "result bad", text: `Verification could not run: ${err.message}` }));
    } finally {
      setBusy(verifyBtn, false, "Verify memo");
    }
  });

  const subjectFields = Object.entries(memo.subject.fields).filter(([, v]) => v);
  stage.replaceChildren(
    el("article", { class: "view", "aria-labelledby": "memo-title" },
      el("div", { class: "view-head" },
        el("div", {},
          el("h1", { id: "memo-title", text: memo.subject.name }),
          el("p", { class: "sub", text: `${memo.mission} · ${when(memo.created_at)}` }),
        ),
        verifyBtn,
      ),
      decisionBlock(memo.decision, memo.decision_label, memo.reasons),
      el("dl", { class: "stats" },
        stat("Total cost", usd(memo.cost.total_usd, 4)),
        stat("Paid calls", String(memo.cost.paid_calls)),
        stat("Coverage", `${memo.coverage.answered} / ${memo.coverage.total}`),
        stat("Per finding", usd(memo.cost.per_finding_usd, 4)),
      ),
      el("div", { class: "grid-2" },
        el("section", { class: "card", "aria-labelledby": "m-findings" },
          el("h2", { id: "m-findings", text: "Findings" }),
          el("ul", { class: "findings" },
            ...memo.findings.map((f) =>
              el("li", {},
                f.skipped ? tag("unknown", "skipped") : tag(f.verdict),
                el("div", {},
                  el("h3", { text: f.title }),
                  el("p", { class: "f-sum", text: f.skipped ? f.skipped : f.summary }),
                  el("p", { class: "f-meta" },
                    el("span", { text: f.why }),
                    f.corroboration !== "not_needed" ? el("span", { text: corroborationText(f.corroboration) }) : null,
                    f.escalatedFrom ? el("span", { text: `follow-up of ${f.escalatedFrom}` }) : null,
                    el("span", { text: `${f.evidence.filter((id) => evidenceById.has(id)).length} evidence` }),
                  ),
                ),
              ),
            ),
          ),
        ),
        el("section", { class: "card", "aria-labelledby": "m-subject" },
          el("h2", { id: "m-subject", text: "Subject and signature" }),
          el("dl", { class: "sig" },
            ...subjectFields.flatMap(([k, v]) => [el("dt", { text: pack?.fields.find((f) => f.name === k)?.label ?? k }), el("dd", { text: v.length > 120 ? `${v.slice(0, 120)}…` : v })]),
            el("dt", { text: "Agent" }), el("dd", {}, el("a", { href: `https://sepolia.etherscan.io/address/${memo.agent}`, target: "_blank", rel: "noopener", text: memo.agent })),
            el("dt", { text: "Digest" }), el("dd", { text: memo.digest }),
            el("dt", { text: "Signature" }), el("dd", { text: short(memo.signature, 26, 12) }),
            el("dt", { text: "Network" }), el("dd", { text: `${memo.network.chain} · ${memo.network.node}` }),
          ),
          verifyOut,
        ),
      ),
      el("section", { class: "card", "aria-labelledby": "m-ledger" },
        el("h2", { id: "m-ledger", text: "Evidence ledger" }),
        el("div", { class: "ledger-wrap" },
          el("table", { class: "ledger" },
            el("thead", {}, el("tr", {}, ...["Check", "Role", "Miner", "Verdict", "Cost", "Signal", "Settlement", "Verified"].map((h) => el("th", { scope: "col", text: h })))),
            el("tbody", {}, ...ledgerRows),
          ),
        ),
        el("details", { class: "raw" },
          el("summary", { text: "Raw signed memo (JSON)" }),
          el("pre", { text: JSON.stringify(memo, null, 2) }),
        ),
      ),
    ),
  );
}

function corroborationText(c) {
  return { single: "one miner", confirmed: "confirmed by a 2nd miner", disputed: "disputed by a 2nd miner" }[c] ?? c;
}

// ---------- routing ----------

function route(e) {
  const h = location.hash;
  if (h.startsWith("#/memo/")) {
    // On a phone the stage sits below the form, so bring the memo into view after a click.
    return renderMemo(decodeURIComponent(h.slice(7))).then(() => e && focusStage());
  }
  if (h.startsWith("#/run/")) return attachRun(h.slice(6));
  if (h === "#/quote" && stage.querySelector(".view")) return;
  // The skip link targets #stage: move focus there, keep the current view.
  if (h === "#stage") return;
  state.source?.close();
  renderIntro();
  renderMemoList();
}

async function init() {
  $("#subject-form").addEventListener("submit", onRun);
  $("#quote-btn").addEventListener("click", onQuote);
  $("#fill-example").addEventListener("click", () => {
    state.drafts[state.pack.id] = { ...state.pack.example };
    renderFields();
    showFormError();
  });
  window.addEventListener("hashchange", route);

  try {
    state.packs = await api("/api/packs");
  } catch (err) {
    // Keep the intro on screen so the page still explains itself; say how to start the server.
    renderIntro();
    stage.prepend(el("div", { class: "error-box", role: "alert", text: `Cannot reach the Countersign server (${err.message}). Start it with npm run serve, then reload.` }));
    $("#memo-list").replaceChildren(el("li", { class: "muted small", text: "Server offline." }));
    return;
  }
  state.pack = state.packs[0];
  renderPacks();
  selectPack(state.pack.id);
  await Promise.all([loadStatus(), loadMemos()]);
  if (state.status?.running && !location.hash.startsWith("#/run/")) location.hash = `#/run/${state.status.running.id}`;
  route();
}

init();
