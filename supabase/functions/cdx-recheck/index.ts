// Directory monthly re-check (2026-10-07): the Casting Companies Directory
// (CASTING_OFFICES, "cdx") and the Talent Agency & Management Directory
// (TALENT_AGENCIES, "agd"), both in swipecast-full.jsx.
//
// What changes on the site BY ITSELF (owner's call, 2026-10-07):
//   • a website link that is hijacked (slot/casino spam) or parked/for sale is hidden
//     (public.directory_link_blocks, auto=true) — the office/agency itself stays listed,
//     the row falls back to "search for them";
//   • the "Last checked" date (public.directory_last_checked) moves when the full monthly
//     check (website + the owner's-Mac activity step) completes.
// Everything else — removing an office, a new address, a new policy, additions — is only
// REPORTED. It goes live after the owner approves and the jsx list is edited.
//
// One row per month in public.cdx_recheck_runs ("YYYY-MM"):
//   "web"      cron 1st: dir "cdx" (54 sites) in one go; dir "agd" in AGD_PARTS slices
//              (~470 sites) so each call stays well inside the edge time limit.
//   "activity" the owner's Mac (Claude task, logged-in Chrome) posts findings for both
//              directories → merged, date moved, report emailed.
//   "report"   cron 3rd: fallback website-only report if the Mac step never arrived.
//   "dry"      check one dir/part and return the report; saves and sends nothing.
//   "status"   latest runs.
// POST {secret, action, dir?, part?, month?, findings?, additions?, agd_findings?}
// secret = app_secrets.cdx_recheck_secret. Report → owner only, via email_send_ledger.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimSends, releaseSends } from "../_shared/send-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const REPORT_TO = "officecasting01@gmail.com";
const JSX_URL = "https://raw.githubusercontent.com/glalov/swipecast1claude/main/swipecast-full.jsx";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const AGD_PARTS = 6;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Dir = "cdx" | "agd";
type Entry = { n: string; w: string };
type Web = { n: string; w: string; status: "ok" | "down" | "moved" | "parked" | "hijacked" | "off_topic"; detail: string };
type Finding = {
  n: string;
  verdict: "active" | "quiet" | "closed" | "moved" | "policy_changed" | "unsure";
  detail?: string; last_credit?: string; new_address?: string; new_policy?: string;
};
type Addition = { n: string; city?: string; why?: string; website?: string };
type Row = { n: string; why: string };

// ── the lists, straight from the live source ──────────────────────────────────
let srcCache: string | null = null;
async function source(): Promise<string> {
  if (srcCache) return srcCache;
  const r = await fetch(JSX_URL, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`repo fetch ${r.status}`);
  return (srcCache = await r.text());
}
async function loadList(dir: Dir): Promise<Entry[]> {
  const src = await source();
  if (dir === "cdx") {
    const start = src.indexOf("const CASTING_OFFICES=[");
    if (start < 0) throw new Error("CASTING_OFFICES not found");
    const i = start + "const CASTING_OFFICES=".length;
    return (JSON.parse(src.slice(i, src.indexOf("\n];", i) + 2)) as Entry[]).map((o) => ({ n: o.n, w: o.w || "" }));
  }
  // TALENT_AGENCIES is a JS literal (unquoted keys, comments), one entry per line.
  const start = src.indexOf("const TALENT_AGENCIES=[");
  if (start < 0) throw new Error("TALENT_AGENCIES not found");
  const body = src.slice(start, src.indexOf("\n];", start));
  const out: Entry[] = [];
  for (const line of body.split("\n")) {
    const n = line.match(/^\s*\{n:"((?:[^"\\]|\\.)*)"/);
    if (!n) continue;
    const w = line.match(/\bw:"([^"]*)"/);
    out.push({ n: n[1].replace(/\\"/g, '"'), w: w ? w[1] : "" });
  }
  return out;
}

// ── website check ─────────────────────────────────────────────────────────────
// Hijacked domains carry slot-spam vocabulary. A single "casino" is NOT enough:
// casting offices list credits like "Wind Creek Casino TVC" (2026-10-07 false positive).
const HIJACK_STRONG = /\b(judi|togel|gacor|maxwin|situs|slot online|slot gacor|bandar|pragmatic play|link alternatif|daftar)\b/i;
// Weak words must stand alone (not "b-toaster-slot" in Next Management's CSS, 2026-10-07),
// and need two DIFFERENT gambling words plus volume. "slot" alone never counts.
const HIJACK_WEAK = /(?<![-_.\w])(casino|poker|pokies|betting|sportsbook|jackpot|bonus|deposit)(?![-_\w])/gi;
const isHijacked = (t: string) => {
  if (HIJACK_STRONG.test(t)) return true;
  const hits = (t.match(HIJACK_WEAK) || []).map((w) => w.toLowerCase());
  return hits.length >= 6 && new Set(hits).size >= 2;
};
const PARKED = /(domain (is )?for sale|buy this domain|this domain (may be|is) for sale|hugedomains|sedo\.com|dan\.com|afternic|parkingcrew|domain parking|godaddy\.com\/domainsearch|is available for purchase|account (has been )?suspended)/i;
const STUB = /<title>[^<]*(coming soon|under construction|wordpress\s*›\s*error|account suspended)[^<]*<\/title>/i;
const TOPIC: Record<Dir, RegExp> = {
  cdx: /casting|cast\b|audition|actor/i,
  agd: /talent|agency|agent|management|manager|represent|client|actor|artist|model/i,
};
const bare = (h: string) => h.replace(/^www\./, "").toLowerCase();

async function get(url: string): Promise<{ status: number; host: string; body: string } | null> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(12000) });
    const body = (await r.text()).slice(0, 400000);
    return { status: r.status, host: new URL(r.url).hostname, body };
  } catch { return null; }
}

async function checkSite(dir: Dir, o: Entry): Promise<Web> {
  const full = o.w.replace(/^https?:\/\//, "");          // may carry a path (wixsite.com/bsta)
  const dom = full.replace(/\/.*$/, "");
  const want = bare(dom);
  const path = full.slice(dom.length);
  const base = { n: o.n, w: o.w };
  // Small old sites are often http-only or www-only: try all four before calling it down.
  let res: Awaited<ReturnType<typeof get>> = null;
  let last: Awaited<ReturnType<typeof get>> = null;
  const hosts = want.split(".").length === 2 ? [want, `www.${want}`] : [dom];
  for (const u of hosts.flatMap((h) => [`https://${h}${path}`, `http://${h}${path}`])) {
    const r = await get(u);
    if (r) last = r;
    // 401/403 = bot wall, 429 = rate limit: the site is there.
    if (r && (r.status < 400 || r.status === 401 || r.status === 403 || r.status === 429)) { res = r; break; }
  }
  if (!res) {
    return { ...base, status: "down", detail: last ? (last.status === 410 ? "Site was taken down (410 Gone)" : `Site answers with error ${last.status}`) : "Site does not answer (no connection)" };
  }
  const plain = res.body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const challenge = res.status === 401 || res.status === 403 || res.status === 429 || /just a moment|cf-chl|attention required|captcha/i.test(res.body);
  if (isHijacked(plain)) return { ...base, status: "hijacked", detail: `Shows gambling/spam content${bare(res.host) !== want ? ` (now ${res.host})` : ""}` };
  if (PARKED.test(res.body) || STUB.test(res.body) || (!challenge && res.body.length < 700)) return { ...base, status: "parked", detail: "Domain is parked, for sale or an empty placeholder" };
  const host = bare(res.host);
  if (host !== want && !host.endsWith("." + want) && !want.endsWith("." + host)) {
    return { ...base, status: "moved", detail: `Now redirects to ${res.host} (update the link)` };
  }
  if (!challenge && plain.length > 200 && !TOPIC[dir].test(plain)) {
    return { ...base, status: "off_topic", detail: dir === "cdx" ? "Site no longer mentions casting" : "Site no longer looks like a talent agency or management company" };
  }
  return { ...base, status: "ok", detail: "" };
}

async function webCheck(dir: Dir, list: Entry[]): Promise<Web[]> {
  const sites = list.filter((o) => o.w);
  const out: Web[] = [];
  let k = 0;
  const worker = async () => { while (k < sites.length) { const o = sites[k++]; out.push(await checkSite(dir, o)); } };
  await Promise.all(Array.from({ length: 10 }, worker));
  return out.sort((a, b) => a.n.localeCompare(b.n));
}
function slice<T>(arr: T[], part: number): T[] {
  const size = Math.ceil(arr.length / AGD_PARTS);
  return arr.slice(part * size, (part + 1) * size);
}

// ── the automatic part: hide hijacked/parked links, un-hide them once clean ────
// deno-lint-ignore no-explicit-any
async function syncLinkBlocks(sb: any, dir: Dir, web: Web[]) {
  const bad = web.filter((s) => s.status === "hijacked" || s.status === "parked");
  const clean = web.filter((s) => s.status !== "hijacked" && s.status !== "parked").map((s) => s.n);
  if (clean.length) {
    const { error } = await sb.from("directory_link_blocks").delete().eq("dir", dir).eq("auto", true).in("name", clean);
    if (error) console.error("[cdx-recheck] unblock", error.message);
  }
  if (bad.length) {
    const { error } = await sb.from("directory_link_blocks").upsert(
      bad.map((s) => ({ dir, name: s.n, website: s.w, reason: s.detail, auto: true })),
      { onConflict: "dir,name", ignoreDuplicates: true },
    );
    if (error) console.error("[cdx-recheck] block", error.message);
  }
}

// ── report ────────────────────────────────────────────────────────────────────
function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function sortOut(web: Web[], findings: Finding[] | null) {
  const remove: Row[] = [], look: Row[] = [], auto: Row[] = [];
  for (const x of findings ?? []) {
    if (x.verdict === "closed") remove.push({ n: x.n, why: x.detail || "Closed / no longer active" });
    else if (x.verdict === "quiet") remove.push({ n: x.n, why: `${x.detail || "No recent activity"}${x.last_credit ? ` · last credit ${x.last_credit}` : ""}` });
    else if (x.verdict === "moved") look.push({ n: x.n, why: `Address changed${x.new_address ? ` → ${x.new_address}` : ""}${x.detail ? ` · ${x.detail}` : ""}` });
    else if (x.verdict === "policy_changed") look.push({ n: x.n, why: `Submission policy now: ${x.new_policy || x.detail || "changed"}` });
    else if (x.verdict === "unsure") look.push({ n: x.n, why: x.detail || "Could not confirm activity" });
  }
  for (const s of web) {
    if (s.status === "ok") continue;
    if (s.status === "hijacked" || s.status === "parked") { auto.push({ n: s.n, why: `${s.w}: ${s.detail} → link hidden on the site` }); continue; }
    const why = `Website ${s.w}: ${s.detail}`;
    // A dead site alone is not a reason to remove a listing that is still working.
    const r = remove.find((x) => x.n === s.n) || look.find((x) => x.n === s.n);
    if (r) r.why += ` · ${why}`; else look.push({ n: s.n, why });
  }
  return { remove, look, auto };
}

const H = (color: string, label: string) => `<tr><td style="padding:22px 0 8px;font:700 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${color}">${label}</td></tr>`;
const R = (color: string, r: Row) => `<tr><td style="padding:10px 14px;border-left:3px solid ${color};background:#fff;border-radius:6px;font:15px/1.5 Helvetica,Arial,sans-serif;color:#1A1A1F"><b>${esc(r.n)}</b><br><span style="color:#433B32;font-size:14px">${esc(r.why)}</span></td></tr><tr><td style="height:8px"></td></tr>`;
const sec = (color: string, label: string, rows: Row[]) => !rows.length ? "" : H(color, `${label} (${rows.length})`) + rows.map((r) => R(color, r)).join("");

type Part = { label: string; total: number; web: Web[]; findings: Finding[] | null; additions: Addition[] };
function buildReport(key: string, parts: Part[], activityDone: boolean) {
  let html = "", removeAll = 0, lookAll = 0;
  const summary: Record<string, unknown> = {};
  for (const p of parts) {
    const { remove, look, auto } = sortOut(p.web, p.findings);
    const flagged = new Set([...remove, ...look].map((x) => x.n));
    const fine = p.total - flagged.size;
    removeAll += remove.length; lookAll += look.length;
    summary[p.label] = { total: p.total, sites: p.web.length, fine, remove: remove.length, look: look.length, auto: auto.length, add: p.additions.length };
    const line = activityDone
      ? `${p.total} checked · ${fine} still active${remove.length ? ` · ${remove.length} to remove` : ""}${look.length ? ` · ${look.length} need a look` : ""}`
      : `${p.web.length} websites checked · ${p.web.filter((s) => s.status === "ok").length} fine${look.length ? ` · ${look.length} need a look` : ""}`;
    html += `<tr><td style="padding:26px 0 2px;font:700 20px/1.3 Georgia,serif;color:#1A1A1F;border-top:1px solid #E2D9C8">${esc(p.label)}</td></tr>
<tr><td style="padding:0 0 4px;font:15px/1.5 Helvetica,Arial,sans-serif;color:#3A322A">${esc(line)}</td></tr>`;
    if (!remove.length && !look.length && !auto.length && !p.additions.length) html += `<tr><td style="padding:10px 0;font:15px/1.5 Helvetica,Arial,sans-serif;color:#206557"><b>All clear.</b> Nothing to change.</td></tr>`;
    html += sec("#B3261E", "Suggest removing", remove) + sec("#B7791F", "Needs a look", look)
      + sec("#206557", "Suggest adding", p.additions.map((a) => ({ n: `${a.n}${a.city ? ` · ${a.city}` : ""}`, why: `${a.why || ""}${a.website ? ` · ${a.website}` : ""}` })))
      + sec("#5B6475", "Done automatically", auto);
  }
  const title = `Directory check · ${monthName(key)}`;
  const missing = activityDone ? "" : `<tr><td style="padding:14px 16px;background:#FFF4E0;border-radius:8px;font:14px/1.5 Helvetica,Arial,sans-serif;color:#7A4A00"><b>The activity check didn't run this month.</b> It runs from your Mac (Chrome, logged into IMDbPro), and the Mac was off or the Claude app was closed. This report covers websites only, and the "Last checked" date on the site was not moved. Open the Claude app and run the task "Casting Directory monthly check" to finish it.</td></tr>`;
  const full = `<!doctype html><html><body style="margin:0;background:#F4EFE6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="font:700 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A6A2F">CastSlate · monthly re-check</td></tr>
<tr><td style="padding:6px 0 12px;font:700 26px/1.25 Georgia,serif;color:#1A1A1F">${esc(title)}</td></tr>
${missing}${html}
<tr><td style="padding:24px 0 0;font:14px/1.6 Helvetica,Arial,sans-serif;color:#433B32;border-top:1px solid #E2D9C8">
<b>Only the "Done automatically" items are already on the site.</b> Removals, new addresses, policies and additions wait for you. To apply, open Claude and say:<br>
<span style="display:inline-block;margin-top:6px;padding:6px 10px;background:#fff;border-radius:6px;font-family:Menlo,monospace;font-size:13px;color:#1A1A1F">apply the ${esc(monthName(key))} directory check</span><br>
and say which suggestions to skip, if any.</td></tr>
</table></td></tr></table></body></html>`;
  const subject = activityDone
    ? `Directory check · ${monthName(key)}: ${removeAll ? `${removeAll} to remove` : "nothing to remove"}${lookAll ? `, ${lookAll} to check` : ""}`
    : `Directory check · ${monthName(key)}: websites only (activity check missing)`;
  return { html: full, subject, summary };
}

// deno-lint-ignore no-explicit-any
async function sendReport(sb: any, ref: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return "no_resend_key";
  // ref = month + kind, so a full report can still follow a website-only fallback one.
  const ok = await claimSends(sb, "cdx_recheck_report", [REPORT_TO], "20 days", ref);
  if (!ok || !ok.has(REPORT_TO)) return "send_guard_repeat";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "CastSlate Directory Check <notifications@castslate.com>", to: [REPORT_TO], subject, html }),
  }).catch(() => null);
  if (!r || !r.ok) { await releaseSends(sb, "cdx_recheck_report", [REPORT_TO], ref); return `send_failed_${r?.status ?? "net"}`; }
  return "sent";
}

const monthKey = () => new Date().toISOString().slice(0, 7);

Deno.serve(async (req) => {
  try {
    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "cdx_recheck_secret").maybeSingle();
    if (!sec?.value || body.secret !== sec.value) return json({ error: "Unauthorized" }, 401);
    const key: string = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : monthKey();
    const dir: Dir = body.dir === "agd" ? "agd" : "cdx";
    const part = Math.max(0, Math.min(AGD_PARTS - 1, Number(body.part) || 0));

    if (body.action === "status") {
      const { data } = await sb.from("cdx_recheck_runs").select("month,web_checked_at,agd_parts,activity_checked_at,emailed_at,summary").order("month", { ascending: false }).limit(6);
      return json({ runs: data });
    }

    if (body.action === "dry") {
      const list = await loadList(dir);
      const web = await webCheck(dir, dir === "agd" ? slice(list, part) : list);
      const label = dir === "cdx" ? "Casting offices" : `Agencies & managers (part ${part + 1}/${AGD_PARTS})`;
      const rep = buildReport(key, [{ label, total: list.length, web, findings: Array.isArray(body.findings) ? body.findings : null, additions: body.additions || [] }], Array.isArray(body.findings));
      return json({ entries: list.length, sites: web.length, problems: web.filter((s) => s.status !== "ok"), subject: rep.subject, summary: rep.summary, html: rep.html });
    }

    if (body.action === "web") {
      const list = await loadList(dir);
      const web = await webCheck(dir, dir === "agd" ? slice(list, part) : list);
      await syncLinkBlocks(sb, dir, web);
      const { data: cur } = await sb.from("cdx_recheck_runs").select("*").eq("month", key).maybeSingle();
      const row: Record<string, unknown> = { month: key };
      if (dir === "cdx") Object.assign(row, { office_count: list.length, web_results: web, web_checked_at: new Date().toISOString() });
      else {
        const names = new Set(web.map((s) => s.n));
        const listed = new Set(list.map((e) => e.n));
        const kept = ((cur?.agd_web_results || []) as Web[]).filter((s) => !names.has(s.n) && listed.has(s.n));
        const parts = Array.from(new Set([...(cur?.agd_parts || []), part])).sort();
        Object.assign(row, { agd_count: list.length, agd_web_results: [...kept, ...web].sort((a, b) => a.n.localeCompare(b.n)), agd_parts: parts });
      }
      const { error } = await sb.from("cdx_recheck_runs").upsert(row, { onConflict: "month" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, month: key, dir, part, sites: web.length, problems: web.filter((s) => s.status !== "ok").length });
    }

    if (body.action === "activity" || body.action === "report") {
      let { data: run } = await sb.from("cdx_recheck_runs").select("*").eq("month", key).maybeSingle();
      if (!run) {
        // The casting web step never ran: do it now (agencies are too many for one call).
        const list = await loadList("cdx");
        const web = await webCheck("cdx", list);
        await syncLinkBlocks(sb, "cdx", web);
        const ins = await sb.from("cdx_recheck_runs").upsert({ month: key, office_count: list.length, web_results: web, web_checked_at: new Date().toISOString() }, { onConflict: "month" }).select("*").single();
        if (ins.error) return json({ error: ins.error.message }, 500);
        run = ins.data;
      }
      if (body.action === "activity") {
        if (!Array.isArray(body.findings)) return json({ error: "findings[] required" }, 400);
        const now = new Date().toISOString();
        const up = await sb.from("cdx_recheck_runs").update({
          findings: body.findings, additions: Array.isArray(body.additions) ? body.additions : [],
          agd_findings: Array.isArray(body.agd_findings) ? body.agd_findings : [], activity_checked_at: now,
        }).eq("month", key).select("*").single();
        if (up.error) return json({ error: up.error.message }, 500);
        run = up.data;
        // The full check is done: move the public "Last checked" date (automatic by design).
        const today = now.slice(0, 10);
        const dirs = ["cdx", ...(Array.isArray(body.agd_findings) ? ["agd"] : [])];
        const { error } = await sb.from("directory_last_checked").upsert(dirs.map((d) => ({ dir: d, checked_on: today, updated_at: now })), { onConflict: "dir" });
        if (error) console.error("[cdx-recheck] last_checked", error.message);
      } else if (run.emailed_at || run.activity_checked_at) {
        return json({ ok: true, skipped: "already_reported" });
      }
      const done = !!run.activity_checked_at;
      const agdMissing = AGD_PARTS - (run.agd_parts || []).length;
      const parts: Part[] = [
        { label: "Casting offices", total: run.office_count, web: run.web_results || [], findings: done ? run.findings || [] : null, additions: run.additions || [] },
      ];
      if (run.agd_count) parts.push({ label: `Agencies & managers${agdMissing > 0 ? ` (${agdMissing} of ${AGD_PARTS} website batches missing)` : ""}`, total: run.agd_count, web: run.agd_web_results || [], findings: done ? run.agd_findings || [] : null, additions: [] });
      const rep = buildReport(key, parts, done);
      const sent = await sendReport(sb, `${key}:${done ? "full" : "web"}`, rep.subject, rep.html);
      await sb.from("cdx_recheck_runs").update({ summary: rep.summary, report_html: rep.html, ...(sent === "sent" ? { emailed_at: new Date().toISOString() } : {}) }).eq("month", key);
      return json({ ok: true, month: key, email: sent, summary: rep.summary });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
