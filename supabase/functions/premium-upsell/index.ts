// premium-upsell — Supabase Edge Function
// A recurring "castings + go Premium" campaign for NON-PREMIUM talent only.
//
// POST { action:"run", slot:"noon"|"evening" }  → send to every eligible free user.
// POST { action:"test", to_email, slot? }        → preview send to one address.
// GET  ?action=unsubscribe&uid=<id>              → opt out of THIS campaign only.
//
// Design decisions (why this is safe to run twice a day):
//   • Recipients are resolved AT SEND TIME as talent/actor profiles whose
//     membership_status is NOT 'active'. The moment a user upgrades to Premium
//     their row flips to 'active' and they are excluded automatically — there is
//     no static list to maintain, so upgraders stop receiving it instantly.
//   • Premium users are NEVER emailed: the recipient query excludes them, and a
//     second in-loop guard drops anyone whose status is 'active' as a backstop.
//   • Unsubscribing here sets email_preferences.premium_upsell_optout = true — a
//     DEDICATED opt-out, so leaving this campaign does NOT stop their casting
//     digest (which uses casting_digest_enabled / unsubscribed_at).
//   • Hard-bounced / complained addresses (email_unsubscribes, populated by
//     resend-webhook) are always suppressed — never re-mailed.
//   • The on/off toggle lives in site_settings.premium_upsell_enabled (+ a
//     premium_upsell_paused emergency stop). When off, run() sends nothing.
//   • Every send is logged to premium_upsell_logs with the slot (noon|evening)
//     so the admin panel can show noon vs evening stats separately.
//   • Sends go out via Resend's batch endpoint (100/call) — same scaling approach
//     as the daily digest, keeping the run under the Edge Function wall clock.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");

// ── Universal email footer "A · Cream Colophon" (approved 2026-09-10) ─────────
// The SAME helpers live in every CastSlate email function: send-notification-
// email, day2-getnoticed, premium-upsell, process-digest-queue, weekly-upsell,
// winback-run and member-announce. Change one, change all seven. Each email
// passes its own "why you got this" sentence, accent colour and unsubscribe URL.
const CS_CREAM = "#F3EEE6";
function csFooterStripe(accent: string): string {
  return `<tr><td style="height:6px;line-height:6px;font-size:0;background:${accent};background:linear-gradient(90deg,${accent},${accent} 55%,${accent}55)">&nbsp;</td></tr>`;
}
function csFooterA(reason: string, accent: string, unsubUrl: string): string {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const serif = "Georgia,'Times New Roman',serif";
  const fb = "https://www.facebook.com/people/CastSlate/61590920810941/";
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:560px;margin:0 auto">
  <tr><td align="center" style="padding:30px 22px 40px">
    <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="max-width:500px;width:100%">
      <tr><td align="center" style="padding-bottom:10px"><table cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td style="padding-right:10px;vertical-align:middle"><img src="${APP_URL}/logo-email-tile.png" width="34" height="34" alt="CastSlate" style="display:block;border-radius:8px"/></td>
        <td style="vertical-align:middle;font-family:${sans};font-size:17px;font-weight:800;letter-spacing:2.4px;color:#1A1A2E">CASTSLATE</td>
      </tr></table></td></tr>
      <tr><td align="center" style="font-family:${serif};font-style:italic;font-size:14px;color:#8A7A66;padding-bottom:20px">Get seen. Get cast.</td></tr>
      <tr><td align="center" style="font-family:${sans};font-size:12.5px;line-height:1.7;color:#7A7064;padding-bottom:18px">${reason}</td></tr>
      <tr><td align="center" style="font-family:${sans};font-size:13px;font-weight:700;color:#2B2622;padding-bottom:3px">Getting too many emails, or not enough?</td></tr>
      <tr><td align="center" style="padding-bottom:12px"><a href="${APP_URL}/account-settings" style="font-family:${sans};font-size:13px;font-weight:700;color:${accent};text-decoration:none">Choose what you receive &rarr;</a></td></tr>
      <tr><td align="center" style="font-family:${sans};font-size:12.5px;color:#7A7064;padding-bottom:22px">Or to stop completely, <a href="${unsubUrl}" style="color:${accent};text-decoration:underline">unsubscribe</a>.</td></tr>
      <tr><td align="center" style="padding-bottom:20px"><a href="${fb}" style="text-decoration:none"><table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td width="30" height="30" align="center" style="width:30px;height:30px;background:${accent};border-radius:15px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:30px;color:#FFFFFF;text-align:center">f</td></tr></table></a></td></tr>
      <tr><td align="center" style="border-top:1px solid #E2D9CB;padding-top:16px;font-family:${sans};font-size:11.5px;color:#A39684">&copy; ${new Date().getFullYear()} CastSlate &middot; <a href="mailto:team@castslate.com" style="color:#8A7A66;text-decoration:none">team@castslate.com</a></td></tr>
    </table>
  </td></tr>
</table>`;
}

const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/premium-upsell`;

// Auth: service-role key or the shared admin campaign secret (mirrors send-campaign).
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";

// ── Email provider — Resend (pinned, like the digest). ──
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
};

function emailConfigured(): boolean { return !!RESEND_API_KEY; }

// Escape user/casting-supplied text before it goes into the HTML body.
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

interface SendEmailArgs { from:string; to:string[]; subject:string; html:string; text?:string; replyTo?:string; headers?:Record<string,string>; }
interface SendEmailResult { ok:boolean; id:string|null; err:string|null; status:number; }

async function sendEmail(a: SendEmailArgs): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) return { ok:false, id:null, err:"RESEND_API_KEY not set", status:500 };
  // deno-lint-ignore no-explicit-any
  const body:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
  if (a.text) body.text = a.text;
  if (a.replyTo) body.reply_to = a.replyTo;
  if (a.headers) body.headers = a.headers;
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(body),
  });
  if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.id ?? null, err:null, status:r.status }; }
  return { ok:false, id:null, err:await r.text(), status:r.status };
}

// Batch send via Resend (up to 100 messages/call). Results come back in input order.
async function sendBatch(items: SendEmailArgs[]): Promise<SendEmailResult[]> {
  if (!RESEND_API_KEY) return items.map(()=>({ ok:false, id:null, err:"RESEND_API_KEY not set", status:500 }));
  // deno-lint-ignore no-explicit-any
  const payload = items.map((a) => {
    const o:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
    if (a.replyTo) o.reply_to = a.replyTo;
    if (a.headers) o.headers = a.headers;
    return o;
  });
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method:"POST",
      headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" },
      body:JSON.stringify(payload),
    });
    if (r.ok) {
      const d = await r.json().catch(()=>({}));
      // deno-lint-ignore no-explicit-any
      const arr:any[] = Array.isArray((d as any)?.data) ? (d as any).data : [];
      return items.map((_, i) => ({ ok:true, id: arr[i]?.id ?? null, err:null, status:r.status }));
    }
    const errText = await r.text();
    return items.map(() => ({ ok:false, id:null, err:errText, status:r.status }));
  } catch (e) {
    return items.map(() => ({ ok:false, id:null, err:String(e), status:500 }));
  }
}

// ── Casting helpers (mirrors process-digest-queue) ──
// (No "posted N days ago" stamp on the cards — removed by request. Recency is
// enforced by the RECENT_POOL window below rather than shown as a date.)

function matches(prefs: any, c: any): boolean {
  const loc=(c.location||"").toLowerCase();
  const open=!loc||loc.includes("nationwide")||loc.includes("remote")||loc.includes("worldwide")||loc.includes("any");
  const cities=((prefs.preferred_cities)||[]).filter(Boolean);
  if(!open&&cities.length>0){
    if(!cities.some((city:string)=>{ const cl=city.toLowerCase().trim(); return loc.includes(cl)||cl.includes(loc.split(",")[0].trim()); })) return false;
  }
  const up=((prefs.union_preference)||"any").toLowerCase();
  if(up!=="any"){
    const cu=(c.union_status||"").toLowerCase();
    const isU=cu.includes("sag")||cu.includes("aea")||cu.includes("union");
    const nonU=cu.includes("non-union")||cu.includes("non union");
    if(up==="union"&&!isU) return false;
    if(up==="non_union"&&isU&&!nonU) return false;
  }
  const types=((prefs.preferred_project_types)||[]).filter(Boolean);
  if(types.length>0){
    const ct=(c.type||"").toLowerCase();
    if(!types.some((t:string)=>{ const tl=t.toLowerCase(); return ct.includes(tl)||tl.includes(ct); })) return false;
  }
  if(prefs.paid_only&&!c.pay) return false;
  return true;
}

// Age safety-filter. A casting is age-appropriate when the actor's age is unknown,
// the casting has no roles, or at least one role's age range covers the actor.
// Roles with no / "Any" / unparseable range count as covering — we only EXCLUDE a
// casting when every role has a real numeric range and none of them fit. This stops
// e.g. a 24-year-old receiving a casting whose roles are all 50+.
function roleCoversAge(ageRange: any, age: number): boolean {
  if(!ageRange) return true;
  const s=String(ageRange).toLowerCase().replace(/[–—]/g,"-");
  const nums=(s.match(/\d+/g)||[]).map(Number);
  if(nums.length===0) return true;               // "Any", "All ages", etc.
  if(s.includes("+")) return age>=nums[0];        // "18+", "All ages 18+"
  if(nums.length>=2){ const lo=Math.min(nums[0],nums[1]), hi=Math.max(nums[0],nums[1]); return age>=lo&&age<=hi; }
  return true;                                    // single loose number → be lenient
}
function castingAgeOk(c: any, age: number|null|undefined): boolean {
  if(!age || age<=0) return true;                 // no age on file → don't filter
  const roles=c.roles||[];
  if(!roles.length) return true;
  return roles.some((r:any)=>roleCoversAge(r.age_range,age));
}

// ── Full-width "wide screen" layout (approved 2026-09-11) ───────────────────
// Edge-to-edge colour bands instead of one narrow card, modelled on how the
// big casting sites lay their promos out. Two palettes, keyed to the slot so
// noon and evening never look like duplicate mail in the same inbox:
//   noon    = Golden Hour (sunset masthead, ivory paper, gold Premium band)
//   evening = Sage & Clay (deep sage masthead, sand paper, clay CTAs)
// The studio marquee sits UP TOP, under the masthead and above the still, with
// the logos at 30px — it used to be a small strip at the bottom.
interface Palette {
  paper:string; ink:string; body:string; line:string; rule:string; kicker:string; alert:string;
  mastBg:string; mastInk:string; mastSub:string;
  cta:string; ctaInk:string; radius:string;
  permBg:string; permInk:string; permBody:string; permAccent:string; permCta:string; permCtaInk:string;
  stripBg:string; stripInk:string; stripLine:string; stripDot:string;
  foot:string; footInk:string; footSub:string; footLink:string;
  fallbackStill:string;
}
const PALETTES: Record<string, Palette> = {
  noon: {
    paper:"#FFF9F0", ink:"#25170F", body:"#6B5847", line:"#EEDFC9", rule:"#E0873B", kicker:"#B4531C", alert:"#C2432C",
    mastBg:"linear-gradient(115deg,#7A2E1E 0%,#C05A25 55%,#E0873B 100%)", mastInk:"#FFF3E2", mastSub:"#F2C79B",
    cta:"#C05A25", ctaInk:"#FFFFFF", radius:"999px",
    permBg:"radial-gradient(ellipse 520px 320px at 50% 0%,rgba(232,185,106,.28) 0%,rgba(43,26,18,0) 70%),#2B1A12",
    permInk:"#FBEEDC", permBody:"#C6AE93", permAccent:"#E8B96A",
    permCta:"linear-gradient(90deg,#F4D987,#D9A92E)", permCtaInk:"#2B1A12",
    stripBg:"#FFF3E2", stripInk:"#A9825C", stripLine:"#EBD6BA", stripDot:"#E0873B",
    foot:"#25170F", footInk:"#FFF3E2", footSub:"#B5967A", footLink:"#E8B96A",
    fallbackStill:"https://image.tmdb.org/t/p/w1280/7HR38hMBl23lf38MAN63y4pKsHz.jpg",
  },
  evening: {
    paper:"#FAF4EC", ink:"#22322E", body:"#5F7069", line:"#DCE6DF", rule:"#C3653F", kicker:"#2F5B52", alert:"#C3653F",
    mastBg:"linear-gradient(120deg,#24453E 0%,#2F5B52 60%,#3C7065 100%)", mastInk:"#F4FAF6", mastSub:"#AFCBC0",
    cta:"#C3653F", ctaInk:"#FFFFFF", radius:"10px",
    permBg:"radial-gradient(ellipse 520px 300px at 50% 0%,rgba(195,101,63,.30) 0%,rgba(31,58,53,0) 70%),#1F3A35",
    permInk:"#F2F8F4", permBody:"#A9C2B8", permAccent:"#E8A87C",
    permCta:"#E08A57", permCtaInk:"#221208",
    stripBg:"#F1EAE0", stripInk:"#8D9A91", stripLine:"#DED3C4", stripDot:"#C3653F",
    foot:"#22322E", footInk:"#F4FAF6", footSub:"#9DB3A9", footLink:"#E8A87C",
    fallbackStill:"https://image.tmdb.org/t/p/w1280/bKCpRjjTKcr3KAITmwjVMobbBYg.jpg",
  },
};

const PERKS = [
  "Unlimited casting submissions",
  "Unlimited photos, videos &amp; demo reels",
  "Actor's Slate &amp; 'Cast Me As' videos",
  "Actor Business Card + QR code",
  "Manager Mode weekly check-ins",
  "Agency &amp; Manager Directory — 650+ in LA &amp; NY",
];

// One casting = one wide row: category / pay / button on the left, the role
// details on the right. Stacks to a single column under 620px.
function castingRow(c: any, p: Palette): string {
  const roles = c.roles || [];
  const r = roles[0];
  const extra = roles.length - 1;
  const roleLine = r
    ? [r.name || "Role", r.age_range, (r.gender && String(r.gender).toLowerCase() !== "any") ? r.gender : null]
        .filter(Boolean).map((x) => esc(x)).join(" &middot; ")
      + (extra > 0 ? ` &middot; <span style="color:${p.body}">+${extra} more role${extra === 1 ? "" : "s"}</span>` : "")
    : "Open casting call";
  const title = esc(String(c.title ?? "").trim()) || "Open casting";
  const href  = c.slug ? `${APP_URL}/casting/${encodeURIComponent(String(c.slug))}` : `${APP_URL}/browse-castings`;
  // The pay field is free text a CD typed: "Paid", "$2,500/week", "Unpaid",
  // "Deferred". Only prefix "Paid —" when the value is an amount, or we end up
  // printing "Paid — Paid." to every recipient.
  const rawPay = String(c.pay ?? "").trim();
  // Long free-text rates ("Varies by project. Some opportunities may be...")
  // would swallow the row, so clamp before it reaches the layout.
  const payText = rawPay.length > 64 ? `${rawPay.slice(0, 64).trim()}\u2026` : rawPay;
  // Only prefix "Paid —" when the value is an actual amount. Otherwise we print
  // "Paid — Paid." or, worse, "Paid — Unpaid" to every recipient.
  const isAmount = /[\d$]/.test(rawPay) && !/^(paid|unpaid|deferred|no pay|tfp)/i.test(rawPay);
  const payLine = !rawPay
    ? "Deferred / copy, credit &amp; meals"
    : isAmount ? `Paid — ${esc(payText)}` : esc(payText);
  let deadline: string | null = null;
  if (c.deadline) {
    const raw = String(c.deadline);
    const d = new Date(raw.length <= 10 ? `${raw}T12:00:00Z` : raw);
    if (!isNaN(d.getTime())) {
      deadline = d.toLocaleDateString("en-US", { timeZone:"America/New_York", month:"short", day:"numeric" });
    }
  }
  return `
      <tr><td class="row-pad" style="padding:22px 40px;border-top:1px solid ${p.line};">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td class="col" width="44%" style="width:44%;vertical-align:top;padding-right:24px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${p.kicker};">${esc(String(c.type || "Casting")).toUpperCase()}</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:${p.ink};margin:8px 0 16px;">${payLine}</div>
            <a href="${href}" style="display:inline-block;background:${p.cta};color:${p.ctaInk};text-decoration:none;padding:13px 30px;border-radius:${p.radius};font-size:14px;font-weight:800;letter-spacing:.3px;">View Now</a>
          </td>
          <td class="col" width="56%" style="width:56%;vertical-align:top;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;color:${p.ink};line-height:1.25;margin:0 0 10px;">&lsquo;${title}&rsquo;</div>
            <div style="font-size:14.5px;line-height:2;color:${p.body};">
              <strong style="color:${p.ink};">Location:</strong> ${esc(c.location || "Location TBD")}${c.union_status ? ` &middot; ${esc(c.union_status)}` : ""}<br/>
              <strong style="color:${p.ink};">Role:</strong> ${roleLine}<br/>
              ${deadline ? `<strong style="color:${p.ink};">Apply by:</strong> <span style="color:${p.alert};font-weight:700;">${deadline}</span>` : `<strong style="color:${p.ink};">Status:</strong> Open now`}
            </div>
          </td>
        </tr></table>
      </td></tr>`;
}

function marquee(p: Palette): string {
  // The three logos live in ONE table row so they can never wrap to a second
  // line on a phone, and each has a mobile width that keeps its aspect ratio
  // (shrinking height alone used to stretch them).
  const cell = (f: string, cls: string, w: number) =>
    `<td style="vertical-align:middle;"><img class="${cls}" src="${APP_URL}/logos/${f}" width="${w}" height="30" style="width:${w}px;height:30px;vertical-align:middle;border:0;" alt=""/></td>`;
  const dot =
    `<td class="sep" style="vertical-align:middle;padding:0 26px;"><span style="display:inline-block;width:5px;height:5px;border-radius:5px;background:${p.stripDot};"></span></td>`;
  return `
    <tr><td class="strip-pad" style="background:${p.stripBg};padding:30px 40px 28px;text-align:center;border-bottom:1px solid ${p.stripLine};">
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 16px;"><tr>
        <td style="width:44px;height:1px;background:${p.stripLine};font-size:0;line-height:0;">&nbsp;</td>
        <td class="strip-label" style="padding:0 14px;font-size:11px;font-weight:800;letter-spacing:3.4px;text-transform:uppercase;color:${p.stripInk};white-space:nowrap;">Casting across every format</td>
        <td style="width:44px;height:1px;background:${p.stripLine};font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;"><tr>
        ${cell("a24-black.png","l-a24",72)}${dot}${cell("neon-black.png","l-neon",106)}${dot}${cell("netflix-red.png","l-nflx",111)}
      </tr></table>
      <div style="margin-top:16px;font-size:11.5px;letter-spacing:.4px;color:${p.stripInk};">Indie features to streaming series &mdash; the same inbox.</div>
    </td></tr>`;
}

interface Hero { image_url: string; caption: string; subject_hook: string; style: string; accent: string; title: string; year: number | null; }

function buildEmail(firstName: string, castings: any[], userId: string, slot: string, hero: Hero | null = null): string {
  const p     = PALETTES[slot === "evening" ? "evening" : "noon"];
  const count = castings.length;
  const unsub = `${UNSUB_BASE}?action=unsubscribe&uid=${userId}&slot=${slot}`;
  const still = hero?.image_url || p.fallbackStill;

  const slotLabel = slot === "evening" ? "Evening castings" : "Noon castings";
  const kicker    = slot === "evening" ? "Before the day's out" : "Fresh for you today";
  const headline  = slot === "evening"
    ? (count ? "Still open tonight" : "Still open tonight")
    : (count ? "The work is looking for you" : "New castings are waiting");
  const lede = count
    ? (slot === "evening"
        ? `${count === 1 ? "A role is" : `${count} roles are`} taking submissions right now, ${esc(firstName)}. Ten minutes today beats a week of waiting.`
        : `${count === 1 ? "A role" : `${count} roles`} opened since yesterday, ${esc(firstName)}. Submit while they're still reading.`)
    : "New projects post every day. Take a look and submit to the ones that fit.";

  const rows  = castings.map((c) => castingRow(c, p)).join("");
  const perks = PERKS.map((t) => `
          <tr><td style="padding:9px 0;color:${p.permInk};font-size:15.5px;">
            <span style="color:${p.permAccent};font-weight:800;">&#10022;</span>&nbsp;&nbsp;${t}</td></tr>`).join("");

  const caption = hero?.caption
    ? `<tr><td class="row-pad" style="padding:18px 40px 0;text-align:center;">
        <div style="font-size:10px;color:${p.stripInk};letter-spacing:.4px;margin-bottom:8px;">Still: <em>${esc(hero.title)}</em>${hero.year ? ` (${hero.year})` : ""}</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.35;font-weight:700;color:${p.ink};">${esc(hero.caption)}</div>
      </td></tr>` : "";

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>${headline} &mdash; CastSlate</title>
<style>
@media only screen and (max-width:620px){
  .col{display:block!important;width:100%!important;padding-right:0!important;}
  .col+.col{padding-top:14px!important;}
  .row-pad,.prem-pad,.strip-pad{padding-left:18px!important;padding-right:18px!important;}
  .mast{padding-left:16px!important;padding-right:16px!important;}
  .hl{font-size:28px!important;} .hl2{font-size:25px!important;}
  .l-a24{width:44px!important;height:18px!important;}
  .l-neon{width:64px!important;height:18px!important;}
  .l-nflx{width:67px!important;height:18px!important;}
  .sep{padding:0 11px!important;}
  .strip-label{font-size:9.5px!important;letter-spacing:2.2px!important;padding:0 8px!important;}
}
</style></head>
<body style="margin:0;padding:0;background:${p.paper};-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${p.paper};">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:1400px;width:100%;">

    <tr><td class="mast" style="background:${p.mastBg};padding:26px 40px;text-align:center;">
      <a href="${APP_URL}" style="text-decoration:none;">
        <img src="${APP_URL}/email/castslate-logo.png" width="34" height="34" alt="CastSlate" style="vertical-align:middle;border-radius:8px;border:0;"/>
        <span style="vertical-align:middle;margin-left:12px;font-size:26px;font-weight:800;letter-spacing:3px;color:${p.mastInk};">CASTSLATE</span>
      </a>
      <div style="margin-top:12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${p.mastSub};">${slotLabel}</div>
    </td></tr>

    ${marquee(p)}

    <tr><td style="padding:0;line-height:0;"><img src="${still}" width="1400" alt="" style="display:block;width:100%;height:auto;border:0;"/></td></tr>
    <tr><td style="height:5px;line-height:5px;font-size:0;background:${p.rule};">&nbsp;</td></tr>
    ${caption}

    <tr><td class="row-pad" style="padding:40px 40px 10px;text-align:center;">
      <div style="font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${p.kicker};margin-bottom:14px;">${kicker}</div>
      <h1 class="hl" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:40px;font-weight:700;color:${p.ink};letter-spacing:-.5px;line-height:1.12;">${headline}</h1>
      <p style="margin:0 auto;max-width:560px;font-size:16px;line-height:1.75;color:${p.body};">${lede}</p>
    </td></tr>

    <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="height:2px;line-height:2px;font-size:0;background:${p.rule};">&nbsp;</td></tr>
    ${rows}

    <tr><td class="row-pad" style="padding:30px 40px 46px;text-align:center;${count ? `border-top:1px solid ${p.line};` : ""}">
      <a href="${APP_URL}/browse-castings" style="display:inline-block;background:transparent;border:2px solid ${p.cta};color:${p.cta};text-decoration:none;padding:13px 36px;border-radius:${p.radius};font-size:14px;font-weight:800;">Browse all open castings</a>
    </td></tr>

    <tr><td class="prem-pad" style="background:${p.permBg};padding:48px 40px;">
      <div style="text-align:center;">
        <div style="font-size:11px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:${p.permAccent};margin-bottom:14px;">More roles. Unlimited submissions.</div>
        <h2 class="hl2" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:${p.permInk};line-height:1.15;">Go Premium, and stop<br/>counting submissions.</h2>
        <p style="margin:0 auto 26px;max-width:520px;font-size:15.5px;line-height:1.7;color:${p.permBody};">Free accounts get one submission, total. Premium members applied to every casting above the day it posted.</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;margin:0 auto;">${perks}</table>
      <div style="text-align:center;margin-top:30px;">
        <a href="${APP_URL}/membership" style="display:inline-block;background:${p.permCta};color:${p.permCtaInk};text-decoration:none;padding:17px 50px;border-radius:${p.radius};font-size:16px;font-weight:800;letter-spacing:.3px;">Unlock Premium &rarr;</a>
        <div style="margin-top:16px;font-size:12.5px;letter-spacing:1px;color:${p.permBody};">$129 / YEAR &nbsp;&middot;&nbsp; $17.99 MONTHLY &nbsp;&middot;&nbsp; CANCEL ANYTIME</div>
      </div>
    </td></tr>

    <tr><td class="row-pad" style="background:${p.foot};padding:34px 40px;text-align:center;">
      <div style="font-size:17px;font-weight:800;letter-spacing:2.6px;color:${p.footInk};">CASTSLATE</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:${p.footSub};margin-top:8px;">Get seen. Get cast.</div>
      <div style="margin-top:18px;font-size:12px;line-height:1.8;color:${p.footSub};">You're receiving this because you signed up for CastSlate casting recommendations.<br/>
        <a href="${APP_URL}/account-settings" style="color:${p.footLink};">Choose what you receive</a> &nbsp;&middot;&nbsp; <a href="${unsub}" style="color:${p.footLink};">Unsubscribe</a></div>
      <div style="margin-top:14px;font-size:11.5px;color:${p.footSub};">&copy; ${new Date().getFullYear()} CastSlate &middot; <a href="mailto:team@castslate.com" style="color:${p.footSub};text-decoration:none;">team@castslate.com</a></div>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}

function subjectFor(slot: string, count: number, hero: Hero | null = null): string {
  if (hero) return `${hero.subject_hook} — ${count} ${count===1?"role":"roles"} open today`;
  // Append the NY date so every send has a unique subject — this stops Gmail's
  // conversation view from collapsing separate daily emails into one thread.
  const day = new Date().toLocaleDateString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"});
  if (slot === "evening") {
    return count ? `Still open tonight: ${count} casting${count!==1?"s":""} for you — ${day}` : `Tonight's open castings on CastSlate — ${day}`;
  }
  return count ? `${count} new casting${count!==1?"s":""} for you — ${day}` : `New castings are waiting — ${day}`;
}

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  // Dedicated unsubscribe for THIS campaign only (keeps their digest intact).
  // Handles BOTH ways a person unsubscribes, so neither can silently fail:
  //   • GET  — the visible "Unsubscribe" link in the email body (a browser click).
  //   • POST — the native one-click button Gmail/Apple Mail render from the
  //            List-Unsubscribe header (RFC 8058; body is "List-Unsubscribe=One-Click",
  //            NOT JSON). Both carry ?action=unsubscribe&uid=... in the URL, so we
  //            match on that and MUST handle it before any req.json() parse below.
  {
    const url=new URL(req.url);
    if((req.method==="GET"||req.method==="POST")&&url.searchParams.get("action")==="unsubscribe"&&url.searchParams.get("uid")){
      const uid=url.searchParams.get("uid")!;
      const slot=(url.searchParams.get("slot")==="evening")?"evening":"noon";
      const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
      // Only log the opt-out event once (skip if they were already opted out) so
      // the per-slot "Unsubscribed" stat counts people, not repeat link clicks.
      const{data:existing}=await sb.from("email_preferences").select("premium_upsell_optout").eq("user_id",uid).maybeSingle();
      await sb.from("email_preferences").upsert(
        {user_id:uid,premium_upsell_optout:true,updated_at:new Date().toISOString()},
        {onConflict:"user_id"}
      );
      if(!existing || existing.premium_upsell_optout!==true){
        try{ await sb.from("premium_upsell_logs").insert({user_id:uid,slot,status:"skipped",reason:"unsubscribe_click"}); }catch(_){ /* non-fatal */ }
      }
      // Visible link (GET) → friendly confirmation page. One-click (POST) → 200 OK.
      return req.method==="GET"
        ? new Response(null,{ status:302, headers:{...cors,"Location":`${APP_URL}/unsubscribed`} })
        : new Response(JSON.stringify({ok:true,unsubscribed:true}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
    }
    if(req.method==="GET") return new Response("Not found",{status:404});
  }

  const res=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
  const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);

  try{
    const body=await req.json();
    const{action,to_email,secret}=body;
    const slot=(body.slot==="evening")?"evening":"noon";

    // Auth: service-role/admin secret OR an admin user JWT.
    let authorized = !!secret && (secret===SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret===ADMIN_SECRET));
    if(!authorized){
      const authz=req.headers.get("Authorization")||"";
      if(authz.startsWith("Bearer ")){
        try{
          const{data:{user}}=await sb.auth.getUser(authz.slice(7));
          if(user){ const{data:prof}=await sb.from("profiles").select("user_type").eq("id",user.id).maybeSingle(); if(prof&&["admin","super_admin"].includes(prof.user_type)) authorized=true; }
        }catch(_){ /* fall through */ }
      }
    }
    if(!authorized) return res({error:"Unauthorized"},401);

    if(!emailConfigured()) return res({error:"Email provider not configured"},500);

    // ── TEST: preview send to one address (does not touch logs/recipients). ──
    if(action==="test"){
      if(!to_email) return res({error:"to_email required"},400);
      const today=new Date().toISOString().slice(0,10);
      let thero: Hero | null = null;
      try{
        const{data:hs}=await sb.from("site_settings").select("hero_rotation_enabled").eq("id",1).maybeSingle();
        if(hs?.hero_rotation_enabled || body.force_hero){
          const{data:h}=await sb.rpc("get_next_email_hero");
          if(h) thero = (Array.isArray(h) ? h[0] : h) as Hero;
        }
      }catch(e){ console.error("[upsell] hero unavailable:", (e as Error).message); }
      const nowTest=new Date().toISOString();
      const{data:cs}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).or(`expires_at.is.null,expires_at.gte.${today}`).or(`go_live_at.is.null,go_live_at.lte.${nowTest}`).order("created_at",{ascending:false}).limit(3);
      // Pull the real roles too — a test send with empty role rows does not show
      // what recipients actually get, which is the whole point of a test.
      const trb:Record<string,any[]>={};
      if(cs?.length){
        const{data:troles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cs.map((c:any)=>c.id));
        (troles||[]).forEach((r:any)=>{(trb[r.casting_id]??=[]).push(r);});
      }
      const preview=(cs||[]).map((c:any)=>({...c,posted_at:c.created_at,roles:trb[c.id]||[]}));
      if(!preview.length) preview.push({id:"preview",title:'Indie Feature — "The Long Winter"',type:"Film",location:"New York, NY",union_status:"SAG-AFTRA",pay:"$2,500/week",synopsis:"A character-driven drama about a Brooklyn ceramicist navigating her first gallery show.",slug:"sample",posted_at:new Date().toISOString(),roles:[{name:"NADIA",age_range:"28–38",gender:"Female",pay:"$2,500/week"}]});
      const html=buildEmail("there",preview,"test",slot,thero);
      const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject:subjectFor(slot,preview.length,thero),html});
      if(!r.ok) return res({error:r.err},500);
      return res({ok:true,test:true,slot,to:to_email,provider_id:r.id});
    }

    if(action!=="run") return res({error:"Unknown action"},400);

    // ── RUN: the twice-daily campaign. ──
    const{data:cfg}=await sb.from("site_settings").select("premium_upsell_enabled,premium_upsell_paused").eq("id",1).maybeSingle();
    if(cfg && cfg.premium_upsell_enabled===false) return res({ok:false,message:"Disabled",slot,sent:0,skipped:0});
    if(cfg && cfg.premium_upsell_paused===true)   return res({ok:false,message:"Paused",slot,sent:0,skipped:0});

    // ── Non-premium talent profiles (paginated). membership_status != 'active'
    //    (null counts as free). Anyone who upgraded is excluded here + guarded below.
    const profiles:any[]=[];
    {
      const PAGE=1000; let from=0;
      while(true){
        const{data,error}=await sb.from("profiles")
          .select("id,display_name,notification_email,membership_status,age")
          .in("user_type",["talent","actor"])
          .eq("account_status","active")
          .eq("visible",true)
          .or("membership_status.is.null,membership_status.neq.active")
          .order("created_at",{ascending:true})
          .range(from,from+PAGE-1);
        if(error){ console.error("[premium-upsell] profiles page error",error); break; }
        if(!data?.length) break;
        profiles.push(...data);
        if(data.length<PAGE) break;
        from+=PAGE;
      }
    }
    if(!profiles.length) return res({ok:true,message:"No eligible users",slot,sent:0,skipped:0});

    const uids=profiles.map((p:any)=>p.id);

    // ── Per-user email preferences (for the dedicated opt-out + notif flag). ──
    const pm:Record<string,any>={};
    {
      const CH=300;
      for(let i=0;i<uids.length;i+=CH){
        const{data:prefs}=await sb.from("email_preferences").select("*").in("user_id",uids.slice(i,i+CH));
        (prefs||[]).forEach((p:any)=>{pm[p.user_id]=p;});
      }
    }

    // ── Recipient emails direct from auth.users (authoritative, covers new accounts). ──
    const emailMap:Record<string,string>={};
    {
      const CH=1000;
      for(let i=0;i<uids.length;i+=CH){
        const{data,error}=await sb.rpc("get_digest_emails",{uids:uids.slice(i,i+CH)});
        if(error){ console.error("[premium-upsell] get_digest_emails error",error); continue; }
        (data||[]).forEach((r:any)=>{ if(r?.id&&r?.email) emailMap[r.id]=r.email; });
      }
    }

    // ── Suppression list (hard bounces + complaints + manual unsubs). ──
    const suppressed=new Set<string>();
    {
      const PAGE=1000; let from=0;
      while(true){
        const{data,error}=await sb.from("email_unsubscribes").select("email").range(from,from+PAGE-1);
        if(error){ console.error("[premium-upsell] suppression load error",error); break; }
        if(!data?.length) break;
        data.forEach((r:any)=>{ if(r.email) suppressed.add(String(r.email).trim().toLowerCase()); });
        if(data.length<PAGE) break; from+=PAGE;
      }
    }

    // ── Active castings + roles (for the personalized job cards). ──
    const today=new Date().toISOString().slice(0,10);
    // One still per run — every recipient in this slot gets the same frame.
    let runHero: Hero | null = null;
    try{
      const{data:hs}=await sb.from("site_settings").select("hero_rotation_enabled").eq("id",1).maybeSingle();
      if(hs?.hero_rotation_enabled){
        const{data:h}=await sb.rpc("get_next_email_hero");
        if(h) runHero = (Array.isArray(h) ? h[0] : h) as Hero;
      }
    }catch(e){ console.error("[upsell] hero unavailable:", (e as Error).message); }
    // RECENCY WINDOW — two guards, because "still open" is not the same as
    // "fresh". The pool is the N most recently POSTED active castings AND
    // nothing posted more than RECENT_DAYS ago, so this campaign can never
    // resurface a months-old listing just because it is technically still open.
    const RECENT_POOL=20;
    const RECENT_DAYS=14;
    const freshSince=new Date(Date.now()-RECENT_DAYS*86400000).toISOString();
    // Same go-live guard as the digest: a casting scheduled for a future date is
    // already published=true and merely hidden by the site, so without this it
    // would be emailed before anyone could open it.
    const goLiveGate=new Date().toISOString();
    const{data:castings}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).or(`expires_at.is.null,expires_at.gte.${today}`).or(`go_live_at.is.null,go_live_at.lte.${goLiveGate}`).gte("created_at",freshSince).order("created_at",{ascending:false}).limit(RECENT_POOL);
    const cwr:any[]=[];
    if(castings?.length){
      const cids=castings.map((c:any)=>c.id);
      const rb:Record<string,any[]>={};
      for(let i=0;i<cids.length;i+=200){
        const{data:roles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cids.slice(i,i+200));
        (roles||[]).forEach((r:any)=>{(rb[r.casting_id]??=[]).push(r);});
      }
      castings.forEach((c:any)=>cwr.push({...c,posted_at:c.created_at,roles:rb[c.id]||[]}));
    }
    const shuffle=(arr:any[])=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; };
    const JOB_CAP=3;

    // ── Phase 1: decide each user's email (in-memory). ──
    interface Out{ userId:string; email:string; subject:string; html:string; }
    const outbox:Out[]=[];
    const logs:Record<string,unknown>[]=[];
    let sent=0, skipped=0, failed=0;
    const skipReasons:Record<string,number>={};
    const bump=(r:string)=>{ skipReasons[r]=(skipReasons[r]||0)+1; };

    for(const p of profiles){
      const email=emailMap[p.id]||null;
      const pf=pm[p.id]??{};
      // Backstop: never email a premium member even if the query ever returns one.
      if(p.membership_status==="active"){ skipped++; bump("premium"); continue; }
      let skipReason:string|null=null;
      if(pf.premium_upsell_optout===true)     skipReason="campaign_optout";
      else if(p.notification_email===false)   skipReason="email_notifications_off";
      else if(!email)                         skipReason="no_email";
      else if(suppressed.has(String(email).trim().toLowerCase())) skipReason="suppressed";
      if(skipReason){ skipped++; bump(skipReason); logs.push({user_id:p.id,email,slot,status:"skipped",reason:skipReason}); continue; }

      // Personalized job cards (best-effort; email still sends with 0 matches).
      const pool=cwr.filter((c:any)=>matches(pf,c) && castingAgeOk(c,p.age));
      // NEWEST-FIRST GUARANTEE. A pure shuffle means a casting posted an hour ago
      // can lose the coin toss and never appear. Hoist the newest matching casting
      // to the front so anything just posted is ALWAYS included; the remaining
      // slots stay shuffled so the rest of the mix still varies between sends.
      const newest=pool.reduce((best:any,c:any)=>
        (!best||String(c.created_at||c.posted_at||"")>String(best.created_at||best.posted_at||"")) ? c : best, null);
      const rest=shuffle(pool.filter((c:any)=>!newest||c.id!==newest.id));
      const batch=(newest?[newest,...rest]:rest).slice(0,JOB_CAP)
        .sort((a:any,b:any)=>String(b.created_at||b.posted_at||"").localeCompare(String(a.created_at||a.posted_at||"")));
      const first=(p.display_name??"").split(" ")[0].trim()||"there";
      outbox.push({ userId:p.id, email, subject:subjectFor(slot,batch.length,runHero), html:buildEmail(first,batch,p.id,slot,runHero) });
    }

    // ── Phase 2: send in batches of 100 via Resend, log each result. ──
    const BATCH=100;
    for(let i=0;i<outbox.length;i+=BATCH){
      const group=outbox.slice(i,i+BATCH);
      const results=await sendBatch(group.map((o)=>({from:FROM_EMAIL,to:[o.email],replyTo:CONTACT_EMAIL,subject:o.subject,html:o.html,headers:{"List-Unsubscribe":`<${UNSUB_BASE}?action=unsubscribe&uid=${o.userId}&slot=${slot}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}})));
      group.forEach((o,idx)=>{
        const r=results[idx];
        if(r?.ok){ sent++; logs.push({user_id:o.userId,email:o.email,slot,status:"sent",provider_message_id:r.id}); }
        else{ failed++; logs.push({user_id:o.userId,email:o.email,slot,status:"failed",error_message:r?.err}); }
      });
      if(i+BATCH<outbox.length) await new Promise((r)=>setTimeout(r,600));
    }

    // ── Bulk-write logs. ──
    for(let i=0;i<logs.length;i+=500){
      try{ await sb.from("premium_upsell_logs").insert(logs.slice(i,i+500)); }catch(e){ console.error("[premium-upsell] log insert failed",e); }
    }

    const summary={ok:true,slot,sent,skipped,failed,total_users:profiles.length,skip_reasons:skipReasons};
    console.log("[premium-upsell] run complete",JSON.stringify(summary));
    return res(summary);
  }catch(e){
    console.error("[premium-upsell]",e);
    return res({error:String(e)},500);
  }
});
