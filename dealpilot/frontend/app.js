"use strict";
const STAGES = ["Intake", "Credit", "Committee", "Product", "Committed", "Closed"];
let S = null, openDeal = null;
const $ = (s, el = document) => el.querySelector(s);
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt$ = (n) => (typeof n === "number" ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "n/a");
const fmtT = (s) => (s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

async function api(path, opts) {
  const r = await fetch("/api" + path, opts && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText); }
  return r.json();
}
async function busy(fn) {
  $("#busy").classList.remove("hidden"); document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try { await fn(); } catch (e) { alert(e.message); } finally {
    $("#busy").classList.add("hidden"); document.querySelectorAll("button").forEach((b) => (b.disabled = false)); await refresh();
  }
}

async function refresh() {
  S = await api("/state");
  render();
  if (openDeal) showDeal(openDeal, true);
}

function render() {
  $("#now").textContent = fmtT(S.now) + " CT";
  $("#arr").textContent = `files landed ${S.n_arrived}/${S.n_total}`;
  const m = $("#mode"); m.textContent = S.mode; m.className = "pill " + (S.gemini_ready ? (S.mode.startsWith("FIXTURE") ? "warn" : "") : "bad");
  $("#personas").checked = S.personas;
  const er = $("#errors");
  if (!S.gemini_ready) { er.classList.remove("hidden"); er.textContent = "No GEMINI_API_KEY: nothing can be read. Put it in dealpilot/.env and restart (there is deliberately no fallback extractor)."; }
  else if (S.gemini && Object.keys(S.gemini.parked || {}).length) { er.classList.remove("hidden"); er.textContent = "Gemini quota exhausted on: " + Object.entries(S.gemini.parked).map(([m, mins]) => `${m} (resets in ~${mins} min)`).join(", ") + (S.stalled ? " - ingestion is STALLED until a model is available (files stay un-read, nothing is guessed)." : "") + " Enable billing on the API key to lift the free-tier limit."; }
  else if (S.errors.length) { er.classList.remove("hidden"); er.textContent = "Extraction errors: " + S.errors.map((e) => `${e.path}: ${e.error}`).join(" | "); }
  else er.classList.add("hidden");
  renderBoard(); renderInbox(); renderAlerts(); renderFraud();
}

function card(d) {
  const sla = d.sla; const cls = ["card"];
  if (d.fraud.flagged && !d.fraud.released) cls.push("hold"); else if (d.status === "funded") cls.push("funded");
  if (d.needed_by) cls.push("urgent");
  const chips = [];
  if (d.fraud.flagged && !d.fraud.released) chips.push(`<span class="chip bad">${d.fraud.confirmed ? "FRAUD HOLD" : "FLAGGED - frozen"}</span>`);
  if (d.fraud.released) chips.push(`<span class="chip ok">fraud cleared</span>`);
  if (d.status === "funded") chips.push(`<span class="chip ok">funded</span>`);
  if (d.status === "declined") chips.push(`<span class="chip warn">declined</span>`);
  d.issues.forEach((i) => chips.push(`<span class="chip ${i.startsWith("OLD_TRICK") ? "bad" : "warn"}">${esc(i)}</span>`));
  if (d.needed_by) chips.push(`<span class="chip warn">needed ${esc(fmtT(d.needed_by))}</span>`);
  if (d.anomaly && d.anomaly.unusual) chips.push(`<span class="chip" title="ML watch score only: never blocks">ML: unusual</span>`);
  const bar = sla ? `<div class="bar ${sla.pct >= 150 ? "bad" : sla.pct >= 100 ? "warn" : ""}"><i style="width:${Math.min(sla.pct, 200) / 2}%"></i></div><div class="m">${sla.elapsed}h / ${sla.hours}h SLA (${sla.pct}%)</div>` : "";
  return `<div class="${cls.join(" ")}" data-f="${esc(d.folder)}"><div class="t">${esc(d.name)}</div>
    <div class="m">${fmt$(d.amount)} &middot; RM ${esc(d.rm)}</div><div class="chips">${chips.join("")}</div>${bar}
    ${d.waiting_on && d.status === "active" ? `<div class="wait">&#9203; ${esc(d.waiting_on)}</div>` : ""}</div>`;
}

function renderBoard() {
  const cols = {}; STAGES.forEach((s) => (cols[s] = [])); cols.Stopped = [];
  S.deals.forEach((d) => {
    if (d.status === "declined" || d.status === "held") cols.Stopped.push(d);
    else cols[d.stage || "Intake"].push(d);
  });
  const names = [...STAGES, "Stopped"];
  $("#board").innerHTML = names.map((n) => `<div class="col"><h4>${n}<span>${cols[n].length}</span></h4>${cols[n].map(card).join("")}</div>`).join("");
  document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => showDeal(c.dataset.f)));
}

function renderInbox() {
  const p = S.pending;
  $("#c-inbox").textContent = p.length || "";
  const by = {}; p.forEach((r) => (by[r.to] = by[r.to] || []).push(r));
  let h = "";
  if (!p.length) h += `<p class="muted">No pending requests. Humans are only asked at: credit decision, committee approval, commitment sign-off, funding release, and fraud holds.</p>`;
  Object.keys(by).sort().forEach((who) => {
    const person = S.people[who] || { name: who, role: "" };
    h += `<h3>${esc(person.name)} <span class="muted">${esc(person.role)}</span></h3>`;
    by[who].forEach((r) => {
      h += `<div class="req ${r.type === "fraud_hold" ? "fraud" : r.urgent ? "urgent" : ""}"><div class="who">${esc(r.type.replace("_", " "))} &middot; ${esc(r.deal)} <span class="muted">${esc(fmtT(r.at))}</span></div>
        <div class="msg">${esc(r.message)}</div><input placeholder="note (needed for request_info)" id="n${r.id}">
        <div class="opts">${r.options.map((o) => `<button data-ans="${r.id}|${o}" class="${["approve", "hold", "release"].includes(o) ? "primary" : o === "decline" ? "danger" : ""}">${esc(o)}</button>`).join("")}</div></div>`;
    });
  });
  const info = S.unanswered_info;
  if (info.length) { h += `<h3>Sent to borrowers (awaiting documents)</h3>` + info.slice(-6).reverse().map((r) => `<div class="req"><div class="who">${esc(r.deal)} <span class="muted">${esc(fmtT(r.at))}</span></div><div class="msg">${esc(r.message)}</div></div>`).join(""); }
  $("#p-inbox").innerHTML = h;
  document.querySelectorAll("[data-ans]").forEach((b) => b.addEventListener("click", () => {
    const [id, ans] = b.dataset.ans.split("|");
    busy(() => api(`/humans/${id}/answer`, { answer: ans, note: $("#n" + id).value }));
  }));
}

function renderAlerts() {
  $("#c-alerts").textContent = S.alerts.length || "";
  $("#p-alerts").innerHTML = S.alerts.length ? S.alerts.map((a) => `<div class="alert ${a.level}"><div class="h">${esc(fmtT(a.at))} &middot; ${esc(a.level)} &middot; to <b>${esc(a.to)}</b>${a.cc.length ? " (cc " + esc(a.cc.join(", ")) + ")" : ""} &middot; ${esc(a.kind)}</div>${esc(a.message)}</div>`).join("") : `<p class="muted">No alerts yet. Deals alert at 100% of the stage SLA, escalate at 150%, and again at 200%.</p>`;
}

function renderFraud() {
  const flagged = S.deals.filter((d) => d.fraud.flagged);
  $("#c-fraud").textContent = flagged.length || "";
  let h = `<p class="muted">Cross-deal groups (shared rare attributes across independent evidence families). A single strange deal is only a watch note.</p>`;
  S.clusters.forEach((c) => { h += `<div class="cluster"><b>${c.members.map((m) => esc(c.labels[m] || m)).join(" &middot; ")}</b><div class="muted">score ${c.score} &middot; families: ${esc(c.families.join(", "))}</div><div>${esc(c.reason)}</div></div>`; });
  const old = flagged.filter((d) => !d.fraud.sources.includes("CROSS_DEAL"));
  old.forEach((d) => { h += `<div class="cluster"><b>${esc(d.name)}</b> <span class="muted">${esc(d.fraud.sources.join(", "))}</span><div>${esc(d.fraud.reason)}</div></div>`; });
  h += `<h3>History deals flagged as related</h3>` + (S.history_flags.length ? S.history_flags.map((x) => `<span class="chip bad">${esc(x)}</span>`).join(" ") : `<span class="muted">none</span>`);
  $("#p-fraud").innerHTML = h;
}

async function showDeal(folder, keepScroll) {
  openDeal = folder;
  const d = await api("/deals/" + encodeURIComponent(folder));
  const sc = $("#drawer").scrollTop;
  $("#dr-title").textContent = d.name;
  const f = d.facts || {};
  const rows = [["Legal name", f.legal_name], ["DBA", f.dba], ["EIN", f.ein], ["Amount", fmt$(f.amount_requested)], ["Product", f.product], ["Purpose", `${f.purpose_category || ""} - ${f.purpose || ""}`],
    ["Term", f.term_months && f.term_months + " months"], ["Guarantor", f.guarantor_name], ["Stated revenue", fmt$(f.annual_revenue_stated)], ["Needed by", f.needed_by && fmtT(f.needed_by)],
    ["Business address", f.business_address], ["Registered agent", f.registered_agent], ["Preparer", [f.preparer_name, f.preparer_firm].filter(Boolean).join(" - ")],
    ["Vendor", f.equipment_vendor && `${f.equipment_vendor} (${d.vendor_status}) ...${f.vendor_account_last4}`], ["RM", d.rm], ["Applicant note", f.applicant_notes]];
  let h = `<div class="chips">${d.fraud.flagged ? `<span class="chip bad">${esc(d.fraud.sources.join(", "))}${d.fraud.confirmed ? " - HOLD CONFIRMED" : d.fraud.released ? " - released" : " - awaiting Fraud Ops"}</span>` : `<span class="chip ok">no fraud flag</span>`}
    <span class="chip">${esc(d.status)} @ ${esc(d.stage || "-")}</span></div>`;
  if (d.waiting_on && d.status === "active") h += `<p><b>Waiting for:</b> ${esc(d.waiting_on)}<br><b>To unblock:</b> ${esc(d.unblock)}</p>`;
  if (d.fraud.flagged) h += `<h3>Fraud evidence</h3><p>${esc(d.fraud.reason)}</p>${d.fraud.linked_deals.length ? `<p>Linked: ${d.fraud.linked_deals.map((x) => `<span class="chip bad">${esc(x)}</span>`).join(" ")}</p>` : ""}`;
  if (d.watch.length) h += `<h3>Watch notes (never block on their own)</h3><ul>${d.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
  if (d.anomaly && d.anomaly.percentile !== undefined) h += `<p class="muted">ML watch score: ${(d.anomaly.percentile * 100).toFixed(0)}th percentile of the bank's normal book ${(d.anomaly.top || []).map((t) => `${t.feature} (z=${t.z})`).join(", ")}</p>`;
  h += `<h3>Extracted facts</h3><table>${rows.filter((r) => r[1]).map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join("")}</table>`;
  h += `<h3>Issues</h3>` + (d.findings.length ? d.findings.map((x) => `<div class="finding"><b>${esc(x.code)}</b> <span class="muted">${x.stage ? "blocks " + esc(x.stage) : "informational"}</span><br>${esc(x.text)}${x.evidence ? `<br><span class="muted">${esc(x.evidence)}</span>` : ""}
    ${x.blocks ? `<br><button data-ov="${esc(x.code)}">Accept this issue and continue</button>` : ""}</div>`).join("") : `<span class="muted">none</span>`);
  h += `<h3>Stage log</h3><p><button id="gen-memos">Generate Gemini memos for this deal</button></p><div class="tl">${d.log.map((e) => `<div class="e ${esc(e.decision)}"><b>${esc(e.stage)}</b> &middot; ${esc(e.decision)}<div class="muted">${esc(fmtT(e.entered_at))} &rarr; ${esc(e.exited_at ? fmtT(e.exited_at) : "now")}</div>
    ${e.why ? `<div><b>Why:</b> ${esc(e.why)}</div>` : ""}${e.saw ? `<div class="muted">Saw: ${esc(e.saw)}</div>` : ""}${e.memo ? `<pre class="memo">${esc(e.memo)}</pre>` : ""}${e.waiting_on ? `<div class="muted">Waiting on: ${esc(e.waiting_on)}</div>` : ""}</div>`).join("")}</div>`;
  if (d.credit_memo) h += `<h3>Credit memo</h3><pre class="memo">${esc(d.credit_memo)}</pre>`;
  h += `<h3>Human requests</h3>` + (d.requests.map((r) => `<div class="finding"><b>${esc(r.type)}</b> &rarr; ${esc(r.to)} <span class="muted">${esc(fmtT(r.at))}</span> ${r.answer ? `<span class="chip ok">${esc(r.answer)} @ ${esc(fmtT(r.answered_at))}</span>` : r.type === "info_request" ? `<span class="chip">awaiting docs</span>` : `<span class="chip warn">pending</span>`}<div class="muted">${esc(r.message)}</div></div>`).join("") || `<span class="muted">none</span>`);
  h += `<h3>Alerts</h3>` + (d.alerts.map((a) => `<div class="alert ${a.level}"><div class="h">${esc(fmtT(a.at))} &middot; ${esc(a.level)} &rarr; ${esc(a.to)}</div>${esc(a.message)}</div>`).join("") || `<span class="muted">none</span>`);
  h += `<h3>Documents (${d.docs.length})</h3><table>${d.docs.map((x) => `<tr><td>${esc(x.type)}</td><td>${esc(x.file)} <span class="muted">${esc(x.producer || "")}</span>${x.warnings.length ? ` <span class="chip warn">${esc(x.warnings[0].slice(0, 60))}</span>` : ""}</td></tr>`).join("")}</table>`;
  $("#dr-body").innerHTML = h;
  $("#drawer").classList.remove("hidden");
  if (keepScroll) $("#drawer").scrollTop = sc;
  const gm = $("#gen-memos"); if (gm) gm.addEventListener("click", () => busy(() => api(`/deals/${encodeURIComponent(folder)}/memos`, {})));
  document.querySelectorAll("[data-ov]").forEach((b) => b.addEventListener("click", () => busy(() => api(`/deals/${encodeURIComponent(folder)}/override`, { code: b.dataset.ov }))));
}

document.querySelectorAll("[data-adv]").forEach((b) => b.addEventListener("click", () => busy(() => api("/clock/advance", { by: b.dataset.adv }))));
$("#toEnd").addEventListener("click", () => busy(() => api("/clock/set", { t: "2026-11-06T18:00-06:00" })));
$("#reset").addEventListener("click", () => { if (confirm("Reset the sim clock and clear all deal state?")) busy(() => api("/clock/reset", {})); });
$("#personas").addEventListener("change", (e) => busy(() => api("/personas", { enabled: e.target.checked })));
$("#dr-close").addEventListener("click", () => { openDeal = null; $("#drawer").classList.add("hidden"); });
$("#t-go").addEventListener("click", () => busy(() => api("/clock/set", { t: $("#t-set").value })));
const load = (replace) => busy(() => api("/dataset/load", { root: $("#d-root").value || null, arrivals: $("#d-arr").value || null, folder: $("#d-folder").value || null, replace }));
$("#d-replace").addEventListener("click", () => load(true));
$("#d-append").addEventListener("click", () => load(false));
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  ["inbox", "alerts", "fraud", "data"].forEach((n) => $("#p-" + n).classList.toggle("hidden", n !== t.dataset.tab));
}));
refresh();
setInterval(() => { if (!document.hidden && $("#busy").classList.contains("hidden")) refresh().catch(() => {}); }, 5000);
