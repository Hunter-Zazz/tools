"use strict";

const API_BASE = "https://mempool.space/api";
const TRACE_BATCH_SIZE = 10;
const MAX_RECENT = 10;
const MAX_TRACE_DEPTH = 250;
const MAX_FRONTIER = 2000;
const EXAMPLE_TXID = "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16";
const TXID_RE = /^[0-9a-fA-F]{64}$/;

const $ = (selector) => document.querySelector(selector);
const form = $("#trace-form");
const queryInput = $("#query");
const traceButton = $("#trace-button");
const exampleButton = $("#example-button");
const expandTraceButton = $("#expand-trace");
const expandNote = $("#expand-note");
const notice = $("#notice");
const txResults = $("#tx-results");
const addressResults = $("#address-results");
const summary = $("#summary");
const tree = $("#tree");
const limit = $("#limit");
const addressSummary = $("#address-summary");
const utxos = $("#utxos");
const recent = $("#recent");
const downloadTx = $("#download-tx");
const downloadAddress = $("#download-address");

let latestEvidence = null;
let activeTraceSession = null;

function showNotice(message, type = "loading") {
  notice.hidden = false;
  notice.className = `notice ${type}`;
  notice.textContent = message;
}

function clearNotice() {
  notice.hidden = true;
  notice.textContent = "";
  notice.className = "notice";
}

function setBusy(busy, label = "Tracing…") {
  traceButton.disabled = busy;
  exampleButton.disabled = busy;
  expandTraceButton.disabled = busy;
  traceButton.textContent = busy ? label : "Trace funds";
}

function btc(sats) {
  return `${(Number(sats) / 100000000).toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`;
}

function short(id) {
  return id && id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id;
}

function when(ts) {
  if (!ts) return "Unconfirmed / time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(ts * 1000));
}

async function api(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error("Bitcoin record not found.");
    if (response.status === 429) {
      throw new Error("Public API rate limit reached. Retry shortly.");
    }
    throw new Error(`Blockchain API returned HTTP ${response.status}.`);
  }

  return response.json();
}

async function detect(value) {
  if (TXID_RE.test(value)) return { type: "tx", value: value.toLowerCase() };

  const validation = await api(`/v1/validate-address/${encodeURIComponent(value)}`);
  if (!validation.isvalid) {
    throw new Error("That is not a valid Bitcoin transaction ID or address.");
  }

  return { type: "address", value: validation.address || value };
}

function createTraceSession(txid) {
  return {
    txid,
    root: null,
    queue: [],
    seen: new Set(),
    cache: new Map(),
    count: 0,
    frontierLimited: false,
  };
}

async function bundle(txid, session) {
  if (session.cache.has(txid)) return session.cache.get(txid);

  const request = Promise.all([
    api(`/tx/${txid}`),
    api(`/tx/${txid}/outspends`),
  ]).then(([tx, outspends]) => ({ tx, outspends }));

  session.cache.set(txid, request);
  return request;
}

function enqueueChildren(node, session) {
  for (const output of node.outputs) {
    if (!output.spent || !output.spentBy) continue;

    if (node.depth >= MAX_TRACE_DEPTH) {
      output.child = {
        txid: output.spentBy,
        depth: node.depth + 1,
        depthLimited: true,
      };
      continue;
    }

    if (session.queue.length >= MAX_FRONTIER) {
      session.frontierLimited = true;
      output.child = {
        txid: output.spentBy,
        depth: node.depth + 1,
        frontierLimited: true,
      };
      continue;
    }

    const placeholder = {
      txid: output.spentBy,
      depth: node.depth + 1,
      pending: true,
    };

    output.child = placeholder;
    session.queue.push({ output, txid: output.spentBy, depth: node.depth + 1 });
  }
}

async function fetchTraceNode(txid, depth, session) {
  if (session.seen.has(txid)) {
    return { txid, depth, repeated: true };
  }

  session.seen.add(txid);
  session.count += 1;

  const { tx, outspends } = await bundle(txid, session);
  const outputs = tx.vout.map((output, index) => {
    const spend = outspends[index] || { spent: false };
    return {
      index,
      value: output.value,
      address: output.scriptpubkey_address || null,
      scriptType: output.scriptpubkey_type || null,
      spent: Boolean(spend.spent),
      spentBy: spend.spent ? spend.txid : null,
      spentVin: spend.spent ? spend.vin : null,
      child: null,
    };
  });

  const node = {
    txid,
    depth,
    fee: tx.fee,
    confirmed: Boolean(tx.status?.confirmed),
    blockHeight: tx.status?.block_height ?? null,
    blockTime: tx.status?.block_time ?? null,
    outputs,
  };

  enqueueChildren(node, session);
  return node;
}

async function expandTraceSession(session, budget = TRACE_BATCH_SIZE) {
  let fetched = 0;

  if (!session.root) {
    session.root = await fetchTraceNode(session.txid, 0, session);
    fetched += 1;
  }

  while (fetched < budget && session.queue.length > 0) {
    const next = session.queue.shift();

    if (session.seen.has(next.txid)) {
      next.output.child = {
        txid: next.txid,
        depth: next.depth,
        repeated: true,
      };
      continue;
    }

    const child = await fetchTraceNode(next.txid, next.depth, session);
    next.output.child = child;
    fetched += 1;
  }

  return fetched;
}

function card(label, value, detail = "") {
  const article = document.createElement("article");
  article.className = "summary";

  const labelNode = document.createElement("span");
  const valueNode = document.createElement("strong");
  const detailNode = document.createElement("small");

  labelNode.textContent = label;
  valueNode.textContent = value;
  detailNode.textContent = detail;
  article.append(labelNode, valueNode, detailNode);
  return article;
}

function buildTraceEvidence(session) {
  const root = session.root;
  const total = root.outputs.reduce((sum, output) => sum + output.value, 0);
  const spent = root.outputs.filter((output) => output.spent).length;
  const unspent = root.outputs.length - spent;

  return {
    generated_at: new Date().toISOString(),
    tool: "Poseidon Ledger — Trace Your Stolen Crypto",
    provider: API_BASE,
    evidence_class: "PROVEN_ON_CHAIN",
    doctrine: "Track assets when we can. Track value when asset continuity changes. Never upgrade correlation into proof.",
    query: { type: "transaction", value: session.txid },
    search_controls: {
      batch_size: TRACE_BATCH_SIZE,
      transactions_analysed: session.count,
      pending_frontier: session.queue.length,
      max_trace_depth: MAX_TRACE_DEPTH,
      max_frontier: MAX_FRONTIER,
      frontier_limited: session.frontierLimited,
    },
    summary: {
      total_satoshis: total,
      spent_outputs: spent,
      unspent_outputs: unspent,
    },
    trace: root,
  };
}

function renderTraceSession(session) {
  const root = session.root;
  const total = root.outputs.reduce((sum, output) => sum + output.value, 0);
  const spent = root.outputs.filter((output) => output.spent).length;
  const unspent = root.outputs.length - spent;
  const hasMore = session.queue.length > 0;

  summary.replaceChildren(
    card("Starting transaction", short(session.txid), "Full TXID in evidence export"),
    card("Root output value", btc(total), `${root.outputs.length} outputs`),
    card("Root output state", `${spent} spent / ${unspent} unspent`, "Direct on-chain evidence"),
    card("Transactions analysed", String(session.count), `${TRACE_BATCH_SIZE} fetched per search`),
  );

  tree.replaceChildren(txNode(root, true));

  if (session.frontierLimited) {
    limit.textContent = `Frontier safety limit reached (${MAX_FRONTIER})`;
  } else if (hasMore) {
    limit.textContent = `${session.count} analysed · more path available`;
  } else {
    limit.textContent = `${session.count} analysed · observable path complete`;
  }

  expandTraceButton.hidden = !hasMore;
  expandNote.hidden = !hasMore;
  if (hasMore) {
    expandTraceButton.textContent = `Expand search · next ${TRACE_BATCH_SIZE}`;
    expandNote.textContent = `${session.queue.length} downstream transaction${session.queue.length === 1 ? "" : "s"} waiting in the trace frontier.`;
  }

  latestEvidence = buildTraceEvidence(session);
  addressResults.hidden = true;
  txResults.hidden = false;
}

async function runTx(txid) {
  activeTraceSession = createTraceSession(txid);
  await expandTraceSession(activeTraceSession, TRACE_BATCH_SIZE);
  renderTraceSession(activeTraceSession);
  txResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runAddress(address) {
  const [info, currentUtxos, txs] = await Promise.all([
    api(`/address/${encodeURIComponent(address)}`),
    api(`/address/${encodeURIComponent(address)}/utxo`),
    api(`/address/${encodeURIComponent(address)}/txs`),
  ]);

  const chain = info.chain_stats || {};
  const received = chain.funded_txo_sum || 0;
  const spent = chain.spent_txo_sum || 0;
  const balance = received - spent;

  addressSummary.replaceChildren(
    card("Address", `${address.slice(0, 12)}…${address.slice(-8)}`, "Validated Bitcoin address"),
    card("Confirmed balance", btc(balance), `${currentUtxos.length} current UTXOs`),
    card("Total received", btc(received), `${chain.funded_txo_count || 0} funded outputs`),
    card("Transactions", String(chain.tx_count || 0), "Confirmed chain history count"),
  );

  utxos.replaceChildren();
  if (!currentUtxos.length) {
    const paragraph = document.createElement("p");
    paragraph.className = "small";
    paragraph.textContent = "No current unspent outputs returned for this address.";
    utxos.append(paragraph);
  } else {
    for (const item of currentUtxos) {
      const row = document.createElement("div");
      row.className = "row";
      const id = document.createElement("strong");
      const meta = document.createElement("span");
      id.textContent = `${item.txid}:${item.vout}`;
      meta.textContent = `${btc(item.value)} · ${item.status?.confirmed ? `block ${item.status.block_height}` : "unconfirmed"}`;
      row.append(id, meta);
      utxos.append(row);
    }
  }

  recent.replaceChildren();
  for (const tx of txs.slice(0, MAX_RECENT)) {
    const row = document.createElement("div");
    row.className = "row";
    const id = document.createElement("strong");
    const meta = document.createElement("span");
    id.textContent = tx.txid;
    meta.textContent = `${tx.status?.confirmed ? `Block ${tx.status.block_height}` : "Unconfirmed"} · ${when(tx.status?.block_time)}`;
    row.append(id, meta);
    recent.append(row);
  }

  latestEvidence = {
    generated_at: new Date().toISOString(),
    tool: "Poseidon Ledger — Trace Your Stolen Crypto",
    provider: API_BASE,
    evidence_class: "PROVEN_ON_CHAIN",
    query: { type: "address", value: address },
    address_info: info,
    utxos: currentUtxos,
    recent_transactions: txs.slice(0, MAX_RECENT),
  };

  activeTraceSession = null;
  txResults.hidden = true;
  addressResults.hidden = false;
  addressResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function download() {
  if (!latestEvidence) return;

  const id = latestEvidence.query.value.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 24) || "trace";
  const blob = new Blob([JSON.stringify(latestEvidence, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `poseidon-ledger-${id}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  txResults.hidden = true;
  addressResults.hidden = true;
  latestEvidence = null;
  activeTraceSession = null;

  const raw = queryInput.value.trim();
  if (!raw) {
    showNotice("Paste a Bitcoin transaction ID or address first.", "error");
    queryInput.focus();
    return;
  }

  setBusy(true);
  showNotice(`Checking public Bitcoin records · fetching at most ${TRACE_BATCH_SIZE} transactions…`, "loading");

  try {
    const query = await detect(raw);
    if (query.type === "tx") await runTx(query.value);
    else await runAddress(query.value);
    clearNotice();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "The trace failed unexpectedly.", "error");
  } finally {
    setBusy(false);
  }
});

expandTraceButton.addEventListener("click", async () => {
  if (!activeTraceSession || activeTraceSession.queue.length === 0) return;

  setBusy(true, "Tracing…");
  showNotice(`Expanding the trace by at most ${TRACE_BATCH_SIZE} transactions…`, "loading");

  try {
    await expandTraceSession(activeTraceSession, TRACE_BATCH_SIZE);
    renderTraceSession(activeTraceSession);
    clearNotice();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "The trace expansion failed unexpectedly.", "error");
  } finally {
    setBusy(false);
  }
});

exampleButton.addEventListener("click", () => {
  queryInput.value = EXAMPLE_TXID;
  queryInput.focus();
});

downloadTx.addEventListener("click", download);
downloadAddress.addEventListener("click", download);
