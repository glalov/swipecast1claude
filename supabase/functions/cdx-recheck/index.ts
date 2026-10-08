// Casting Directory monthly re-check (2026-10-07).
//
// The Casting Companies Directory (CASTING_OFFICES in swipecast-full.jsx) promises
// "active offices only". This keeps that true and reports to the owner once a month.
// It NEVER edits the directory: it only reports. Changes go live after the owner
// approves them and the list in the jsx is edited and deployed.
//
// One run per month, keyed "YYYY-MM" in public.cdx_recheck_runs:
//   1. action "web"      (cron, 1st of the month): reads the CURRENT office list from
//      the public repo, then checks every office website — down, moved to another
//      domain, parked/for sale, hijacked (casino/slots spam), no longer about casting.
//   2. action "activity" (the owner's Mac, same day): a Claude task checks each office's
//      recent credits and published submission policy in the owner's logged-in Chrome
//      and posts its findings here. That merges into the run and sends the report.
//   3. action "report"   (cron, 3rd of the month): if the Mac step never arrived (Mac
//      off), sends the website-only report and says the activity check is missing.
//   "dry" = run the website check and return the report HTML; saves and sends nothing.
//   "status" = latest runs.
//
// POST {secret, action, month?, findings?}; secret = app_secrets.cdx_recheck_secret.
// Report email → the owner only, claimed through email_send_ledger (one per month).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimSends, releaseSends } from "../_shared/send-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const REPORT_TO = "officecasting01@gmail.com";
const JSX_URL = "https://raw.githubusercontent.com/glalov/swipecast1claude/main/swipecast-full.jsx";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Office = { n: string; c: string[]; w: string; a: [string, string][]; av: string; p: string; st: string };
type Web = { n: string; w: string; status: "ok" | "down" | "moved" | "parked" | "hijacked" | "not_casting"; detail: string };
// What the Mac step posts, one per office it has something to say about.
type Finding = {
  n: string;
  verdict: "active" | "quiet" | "closed" | "moved" | "policy_changed" | "unsure";
  detail?: string;
  last_credit?: string;
  new_address?: string;
  new_policy?: string;
};
type Addition = { n: string; city?: string; why?: string; website?: string };

// ── the office list, straight from the live source ────────────────────────────
async function loadOffices(): Promise<Office[]> {
  const r = await fetch(JSX_URL, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`repo fetch ${r.status}`);
  const src = await r.text();
  const start = src.indexOf("const CASTING_OFFICES=[");
  if (start < 0) throw new Error("CASTING_OFFICES not found");
  const i = start + "const CASTING_OFFICES=".length;
  const j = src.indexOf("\n];", i);
  return JSON.parse(src.slice(i, j + 2)) as Office[];
}

// ── website check ─────────────────────────────────────────────────────────────
// Hijacked domains (2026-10 check found three) carry slot-spam vocabulary. A single
// "casino" is NOT enough: casting offices list credits like "Wind Creek Casino TVC".
const HIJACK_STRONG = /\b(judi|togel|gacor|maxwin|situs|slot online|slot gacor|bandar|pragmatic play|link alternatif|daftar)\b/i;
const HIJACK_WEAK = /\b(slots?|casino|poker|betting|sportsbook|jackpot|bonus)\b/gi;
const isHijacked = (t: string) => HIJACK_STRONG.test(t) || (t.match(HIJACK_WEAK) || []).length >= 6;
const PARKED = /(domain (is )?for sale|buy this domain|this domain (may be|is) for sale|hugedomains|sedo\.com|dan\.com|afternic|parkingcrew|domain parking|godaddy\.com\/domainsearch|is available for purchase)/i;
const bare = (h: string) => h.replace(/^www\./, "").toLowerCase();

async function get(url: string): Promise<{ status: number; host: string; body: string } | null> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(15000) });
    const body = (await r.text()).slice(0, 400000);
    return { status: r.status, host: new URL(r.url).hostname, body };
  } catch { return null; }
}

async function checkSite(o: Office): Promise<Web> {
  const want = bare(o.w.replace(/^https?:\/\//, "").split("/")[0]);
  let res = await get(`https://${o.w.replace(/^https?:\/\//, "")}`);
  if (!res || res.status >= 500) res = (await get(`http://${o.w.replace(/^https?:\/\//, "")}`)) ?? res;
  const base = { n: o.n, w: o.w };
  if (!res) return { ...base, status: "down", detail: "Site does not answer (no connection)" };
  const text = res.body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // Cloudflare / bot walls answer 403/503 with a challenge: the site is alive.
  const challenge = /just a moment|cf-chl|attention required|captcha/i.test(res.body);
  if (isHijacked(plain)) return { ...base, status: "hijacked", detail: `Shows gambling/spam content${bare(res.host) !== want ? ` (now ${res.host})` : ""}` };
  if (PARKED.test(res.body)) return { ...base, status: "parked", detail: "Domain is parked or for sale" };
  if (res.status >= 400 && !challenge) return { ...base, status: "down", detail: `Site answers with error ${res.status}` };
  const host = bare(res.host);
  if (host !== want && !host.endsWith("." + want) && !want.endsWith("." + host)) {
    return { ...base, status: "moved", detail: `Now redirects to ${res.host} (update the link)` };
  }
  if (!challenge && plain.length > 200 && !/casting|cast\b|audition|actor/i.test(plain)) {
    return { ...base, status: "not_casting", detail: "Site no longer mentions casting" };
  }
  return { ...base, status: "ok", detail: "" };
}

async function webCheck(offices: Office[]): Promise<Web[]> {
  const sites = offices.filter((o) => o.w);
  const out: Web[] = [];
  let k = 0;
  const worker = async () => { while (k < sites.length) { const o = sites[k++]; out.push(await checkSite(o)); } };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out.sort((a, b) => a.n.localeCompare(b.n));
}

// ── report ────────────────────────────────────────────────────────────────────
function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function buildReport(key: string, total: number, web: Web[], findings: Finding[] | null, additions: Addition[]) {
  const remove: { n: string; why: string }[] = [];
  const look: { n: string; why: string }[] = [];
  const f = new Map((findings ?? []).map((x) => [x.n, x]));
  for (const x of findings ?? []) {
    if (x.verdict === "closed") remove.push({ n: x.n, why: x.detail || "Closed / no longer casting" });
    else if (x.verdict === "quiet") remove.push({ n: x.n, why: `${x.detail || "No recent projects"}${x.last_credit ? ` · last credit ${x.last_credit}` : ""}` });
    else if (x.verdict === "moved") look.push({ n: x.n, why: `Address changed${x.new_address ? ` → ${x.new_address}` : ""}${x.detail ? ` · ${x.detail}` : ""}` });
    else if (x.verdict === "policy_changed") look.push({ n: x.n, why: `Submission policy now: ${x.new_policy || x.detail || "changed"}` });
    else if (x.verdict === "unsure") look.push({ n: x.n, why: x.detail || "Could not confirm activity" });
  }
  for (const s of web) {
    if (s.status === "ok") continue;
    const why = `Website ${s.w}: ${s.detail}`;
    // A dead/hijacked site alone is NOT a reason to remove an office that is still casting:
    // the fix is to hide the link. Only pair it with a removal when activity also says so.
    const r = remove.find((x) => x.n === s.n);
    if (r) r.why += ` · ${why}`;
    else look.push({ n: s.n, why: s.status === "hijacked" || s.status === "parked" ? `${why} → hide the link` : why });
  }
  const flagged = new Set([...remove, ...look].map((x) => x.n));
  const fine = total - flagged.size;
  const title = `Casting Directory check · ${monthName(key)}`;
  const sec = (color: string, label: string, rows: { n: string; why: string }[]) => !rows.length ? "" : `
    <tr><td style="padding:22px 0 8px;font:700 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${color}">${label} (${rows.length})</td></tr>
    ${rows.map((r) => `<tr><td style="padding:10px 14px;border-left:3px solid ${color};background:#fff;border-radius:6px;font:15px/1.5 Helvetica,Arial,sans-serif;color:#1A1A1F"><b>${esc(r.n)}</b><br><span style="color:#433B32;font-size:14px">${esc(r.why)}</span></td></tr><tr><td style="height:8px"></td></tr>`).join("")}`;
  const adds = !additions.length ? "" : `
    <tr><td style="padding:22px 0 8px;font:700 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#206557">Suggest adding (${additions.length})</td></tr>
    ${additions.map((a) => `<tr><td style="padding:10px 14px;border-left:3px solid #2A8472;background:#fff;border-radius:6px;font:15px/1.5 Helvetica,Arial,sans-serif;color:#1A1A1F"><b>${esc(a.n)}</b>${a.city ? ` · ${esc(a.city)}` : ""}<br><span style="color:#433B32;font-size:14px">${esc(a.why || "")}${a.website ? ` · ${esc(a.website)}` : ""}</span></td></tr><tr><td style="height:8px"></td></tr>`).join("")}`;
  const missing = findings ? "" : `<tr><td style="padding:14px 16px;margin-top:10px;background:#FFF4E0;border-radius:8px;font:14px/1.5 Helvetica,Arial,sans-serif;color:#7A4A00"><b>The activity check didn't run this month.</b> It runs from your Mac (Chrome, logged into IMDbPro), and the Mac was off or the Claude app was closed. This report covers websites only. Open the Claude app and run the task "Casting Directory monthly check" to finish it.</td></tr>`;
  const counts = findings
    ? `${total} offices checked · ${fine} still active${remove.length ? ` · ${remove.length} to remove` : ""}${look.length ? ` · ${look.length} need a look` : ""}`
    : `${web.length} websites checked · ${web.filter((s) => s.status === "ok").length} fine${look.length ? ` · ${look.length} need a look` : ""}`;
  const nothing = !remove.length && !look.length && !additions.length
    ? `<tr><td style="padding:18px 0;font:15px/1.5 Helvetica,Arial,sans-serif;color:#206557"><b>All clear.</b> Nothing to change this month.</td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#F4EFE6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="font:700 12px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A6A2F">CastSlate · monthly re-check</td></tr>
<tr><td style="padding:6px 0 4px;font:700 26px/1.25 Georgia,serif;color:#1A1A1F">${esc(title)}</td></tr>
<tr><td style="padding:0 0 10px;font:15px/1.5 Helvetica,Arial,sans-serif;color:#3A322A">${esc(counts)}</td></tr>
${missing}${nothing}
${sec("#B3261E", "Suggest removing", remove)}
${sec("#B7791F", "Needs a look", look)}
${adds}
<tr><td style="padding:24px 0 0;font:14px/1.6 Helvetica,Arial,sans-serif;color:#433B32;border-top:1px solid #E2D9C8">
<b>Nothing on the site changes until you approve.</b> To apply, open Claude and say:<br>
<span style="display:inline-block;margin-top:6px;padding:6px 10px;background:#fff;border-radius:6px;font-family:Menlo,monospace;font-size:13px;color:#1A1A1F">apply the ${esc(monthName(key))} casting directory check</span><br>
and say which suggestions to skip, if any.</td></tr>
</table></td></tr></table></body></html>`;
  const subject = findings
    ? `Casting Directory · ${monthName(key)}: ${fine} active${remove.length ? `, ${remove.length} to remove` : ""}${look.length ? `, ${look.length} to check` : ""}`
    : `Casting Directory · ${monthName(key)}: websites checked (activity check missing)`;
  return { html, subject, summary: { total, fine, remove: remove.length, look: look.length, add: additions.length } };
}

// ref = month + kind, so a full report can still follow a website-only fallback one.
async function sendReport(sb: ReturnType<typeof createClient>, ref: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return "no_resend_key";
  const key = ref;
  const ok = await claimSends(sb, "cdx_recheck_report", [REPORT_TO], "20 days", key);
  if (!ok || !ok.has(REPORT_TO)) return "send_guard_repeat";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "CastSlate Directory Check <notifications@castslate.com>", to: [REPORT_TO], subject, html }),
  }).catch(() => null);
  if (!r || !r.ok) { await releaseSends(sb, "cdx_recheck_report", [REPORT_TO], key); return `send_failed_${r?.status ?? "net"}`; }
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

    if (body.action === "status") {
      const { data } = await sb.from("cdx_recheck_runs").select("month,web_checked_at,activity_checked_at,emailed_at,summary").order("month", { ascending: false }).limit(6);
      return json({ runs: data });
    }

    if (body.action === "dry") {
      const offices = await loadOffices();
      const web = await webCheck(offices);
      const rep = buildReport(key, offices.length, web, Array.isArray(body.findings) ? body.findings : null, body.additions || []);
      return json({ offices: offices.length, sites: web.length, problems: web.filter((s) => s.status !== "ok"), subject: rep.subject, summary: rep.summary, html: rep.html });
    }

    if (body.action === "web") {
      const offices = await loadOffices();
      const web = await webCheck(offices);
      const { error } = await sb.from("cdx_recheck_runs").upsert({ month: key, office_count: offices.length, web_results: web, web_checked_at: new Date().toISOString() }, { onConflict: "month" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, month: key, sites: web.length, problems: web.filter((s) => s.status !== "ok").length });
    }

    if (body.action === "activity" || body.action === "report") {
      let { data: run } = await sb.from("cdx_recheck_runs").select("*").eq("month", key).maybeSingle();
      if (!run) {
        // Web step never ran (or failed): do it now so the report is complete.
        const offices = await loadOffices();
        const web = await webCheck(offices);
        const ins = await sb.from("cdx_recheck_runs").upsert({ month: key, office_count: offices.length, web_results: web, web_checked_at: new Date().toISOString() }, { onConflict: "month" }).select("*").single();
        if (ins.error) return json({ error: ins.error.message }, 500);
        run = ins.data;
      }
      if (body.action === "activity") {
        if (!Array.isArray(body.findings)) return json({ error: "findings[] required" }, 400);
        const up = await sb.from("cdx_recheck_runs").update({ findings: body.findings, additions: Array.isArray(body.additions) ? body.additions : [], activity_checked_at: new Date().toISOString() }).eq("month", key).select("*").single();
        if (up.error) return json({ error: up.error.message }, 500);
        run = up.data;
      } else if (run.emailed_at || run.activity_checked_at) {
        // "report" is only the Mac-was-off fallback; the activity step sends its own.
        return json({ ok: true, skipped: "already_reported" });
      }
      const rep = buildReport(key, run.office_count, run.web_results || [], run.activity_checked_at ? run.findings || [] : null, run.additions || []);
      const sent = await sendReport(sb, `${key}:${run.activity_checked_at ? "full" : "web"}`, rep.subject, rep.html);
      await sb.from("cdx_recheck_runs").update({ summary: rep.summary, report_html: rep.html, ...(sent === "sent" ? { emailed_at: new Date().toISOString() } : {}) }).eq("month", key);
      return json({ ok: true, month: key, email: sent, summary: rep.summary });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
