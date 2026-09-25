#!/usr/bin/env python3
"""Full-page promo campaign templates (Obsession + Backrooms), built in the
same structure as the noon/evening premium-upsell emails: full-width colour
bands, 1400px shell, masthead with rising glow, studio strip, full-bleed still,
wide two-column casting rows, dark closing band, own footer band.

Writes:
  email/promo-fullpage-obsession.html   production template ({{CASTINGS_WIDE}})
  email/promo-fullpage-backrooms.html   production template ({{CASTINGS_WIDE}})
  email/castslate-promo-fullpage-demo.html  side-by-side preview, filled with
                                            the castings passed in DEMO_JSON

The {{CASTINGS_WIDE}} tag is filled by send-campaign at send time (same RPC as
the other promo tags). The Python row renderer below exists ONLY for the demo —
per the campaign-castings memory, a Python preview proves layout, never the JS.
"""
import html, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = "https://www.castslate.com"

PALETTES = {
    # Obsession → the noon "Navy Dawn" palette
    "obsession": dict(
        paper="#FAF9F7", ink="#221F2E", body="#605C6B", line="#E6E4E0", rule="#EAC080", kicker="#45476E",
        mastBg="radial-gradient(ellipse 72% 125% at 50% 102%,rgba(242,179,96,.36) 0%,rgba(240,176,96,.11) 46%,rgba(240,176,96,0) 72%),linear-gradient(118deg,#26273F 0%,#33355A 52%,#3E4168 100%)",
        mastBgFlat="#33355A", mastInk="#FFF8EE", mastSub="#EAC080",
        cta="#3E4168", ctaInk="#FFFFFF", radius="999px", pay="#1F6B4A",
        darkBg="radial-gradient(ellipse 540px 320px at 50% 0%,rgba(234,192,128,.26) 0%,rgba(34,31,46,0) 70%),#221F2E",
        darkFlat="#221F2E", darkInk="#F8F3EC", darkBody="#B0A9B8", darkAccent="#EAC080",
        darkCta="linear-gradient(90deg,#F4D9A6,#E0AE63)", darkCtaFlat="#EAC080", darkCtaInk="#221F2E",
        stripBg="#F2F1EE", stripInk="#8B8794", stripLine="#E2E0DB", stripDot="#EAC080",
        foot="#1A1824", footInk="#F8F3EC", footSub="#9C96A5", footLink="#EAC080",
    ),
    # Backrooms → the evening "Sage & Clay" palette
    "backrooms": dict(
        paper="#F8F9F7", ink="#22322E", body="#5F7069", line="#E3E8E4", rule="#C3653F", kicker="#2F5B52",
        mastBg="radial-gradient(ellipse 72% 125% at 50% 102%,rgba(238,152,96,.36) 0%,rgba(232,168,124,.11) 46%,rgba(232,168,124,0) 72%),linear-gradient(118deg,#24453E 0%,#2F5B52 52%,#3C7065 100%)",
        mastBgFlat="#2F5B52", mastInk="#F4FAF6", mastSub="#E8A87C",
        cta="#C3653F", ctaInk="#FFFFFF", radius="10px", pay="#1F6B4A",
        darkBg="radial-gradient(ellipse 540px 320px at 50% 0%,rgba(232,168,124,.26) 0%,rgba(31,58,53,0) 70%),#1F3A35",
        darkFlat="#1F3A35", darkInk="#F2F8F4", darkBody="#A9C2B8", darkAccent="#E8A87C",
        darkCta="#E08A57", darkCtaFlat="#E08A57", darkCtaInk="#221208",
        stripBg="#EFF1EE", stripInk="#8A9791", stripLine="#DFE4E0", stripDot="#C3653F",
        foot="#1A2B27", footInk="#F4FAF6", footSub="#9DB3A9", footLink="#E8A87C",
    ),
}

COPY = {
    "obsession": dict(
        title="The slow-burn is having a year. Three roles are open.",
        preheader="Paid work, real casting directors, and nothing behind a paywall.",
        slot="Now casting",
        # Owner's pick 2026-09-25: the bed shot, both faces visible.
        still="https://image.tmdb.org/t/p/w1280/fnASfC4pJ4NSzJ1ch7FBD99PiaZ.jpg",
        alt="Two people sitting up in bed, she rests her head on his shoulder",
        film="Obsession", year="2026",
        kicker="This week&rsquo;s call sheet",
        headline="The slow-burn is having a year. <br/>So audition like it.",
        lede="Quiet dread, long takes, one unbearable close-up &mdash; it&rsquo;s the mode everything is shot in right now. These paid projects opened on CastSlate this week. All of them are free to submit to, and a real person reads every profile that comes in.",
    ),
    "backrooms": dict(
        title="Liminal, tense, and casting this week",
        preheader="Three paid projects are open right now. Free to join, free to submit.",
        slot="Now casting",
        still="https://image.tmdb.org/t/p/w1280/1nIid8bKdfMBilvDtOy2vIdiSKo.jpg",
        alt="Fluorescent-lit showroom interior",
        film="Backrooms", year="A24, 2026",
        kicker="Open this week",
        headline="Liminal, tense, quietly wrong &mdash; <br/>and casting right now",
        lede="Everyone wants the eerie stuff this year. The difference between watching it and being in it is a submission. These are the newest paid projects open on CastSlate &mdash; every one of them was still live the moment this email went out.",
    ),
}


def esc(v):
    return html.escape(str(v if v is not None else ""), quote=True)


def type_slug(t):
    import re
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(t or "casting").lower()))


def money(n):
    return "$" + f"{float(n):,.0f}"


def wide_row(c, p):
    """Demo-only mirror of send-campaign's wideRow()."""
    lo, hi, unit = c.get("rate_lo"), c.get("rate_hi"), c.get("rate_unit")
    sfx = {"flat": " flat", "week": "/week", "hour": "/hour"}.get(unit, "/day")
    pay = ""
    if lo is not None and hi is not None:
        pay = (money(lo) if float(lo) == float(hi) else f"{money(lo)}&ndash;{money(hi)}") + sfx
    roles = c.get("top_roles") or []
    r = roles[0] if roles else None
    more = max(0, (c.get("role_count") or 0) - 1)
    role_line = "Open casting call"
    if r:
        bits = [esc(r.get("name") or "Role")]
        if r.get("age"): bits.append(esc(r["age"]))
        if r.get("gender") and str(r["gender"]).lower() not in ("any", "all genders"): bits.append(esc(r["gender"]))
        role_line = " &middot; ".join(bits)
        if more: role_line += f' &middot; <span style="color:{p["body"]}">+{more} more role{"s" if more != 1 else ""}</span>'
    union = c.get("union_status") or ""
    if "not applicable" in union.lower(): union = ""
    href = f'{APP}/casting/{c["slug"]}'
    pay_html = (f'<img src="{APP}/email/money-icon.png" width="18" height="18" alt="" style="display:inline-block;width:18px;height:18px;vertical-align:-3px;margin-right:8px;border:0;"/>Paid &mdash; {pay}'
                if pay else "Paid")
    return f"""
      <tr><td class="row-pad" style="padding:22px 40px;border-top:1px solid {p['line']};">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td class="col" width="44%" style="width:44%;vertical-align:top;padding-right:24px;">
            <table cellpadding="0" cellspacing="0" role="presentation"><tr>
              <td style="vertical-align:middle;padding-right:12px;"><img src="{APP}/email/type-icons/{type_slug(c.get('ctype'))}.png" width="46" height="46" alt="" style="display:block;width:46px;height:46px;border:0;"/></td>
              <td style="vertical-align:middle;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:{p['kicker']};">{esc(c.get('ctype') or 'Casting').upper()}</td>
            </tr></table>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:{p['pay']};font-weight:700;margin:12px 0 16px;white-space:nowrap;overflow:hidden;">{pay_html}</div>
            <a href="{href}" style="display:inline-block;background:{p['cta']};color:{p['ctaInk']};text-decoration:none;padding:13px 30px;border-radius:{p['radius']};font-size:14px;font-weight:800;letter-spacing:.3px;">View Now</a>
          </td>
          <td class="col" width="56%" style="width:56%;vertical-align:top;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;color:{p['ink']};line-height:1.25;margin:0 0 10px;">&lsquo;{esc(c.get('title') or 'Open casting')}&rsquo;</div>
            <div style="font-size:14.5px;line-height:2;color:{p['body']};">
              <strong style="color:{p['ink']};">Location:</strong> {esc(c.get('location') or 'Location TBD')}{(' &middot; ' + esc(union)) if union else ''}<br/>
              <strong style="color:{p['ink']};">Role:</strong> {role_line}<br/>
              <strong style="color:{p['ink']};">Status:</strong> Open now &middot; free to submit
            </div>
          </td>
        </tr></table>
      </td></tr>"""


def marquee(p):
    def logo(f, cls, w):
        h = 26; ww = round(w * h / 30)
        return f'<img class="{cls}" src="{APP}/logos/{f}" width="{ww}" height="{h}" style="width:{ww}px;height:{h}px;vertical-align:middle;border:0;" alt=""/>'
    def col(f, w, last):
        br = "" if last else f"border-right:1px solid {p['stripLine']};"
        return f'<td width="33%" style="width:33.33%;text-align:center;vertical-align:middle;padding:4px 0;{br}">{logo(f, "", w)}</td>'
    def cell(f, cls, w):
        return f'<td style="vertical-align:middle;">{logo(f, cls, w)}</td>'
    dot = f'<td class="sep" style="vertical-align:middle;padding:0 26px;"><span style="display:inline-block;width:5px;height:5px;border-radius:5px;background:{p["stripDot"]};"></span></td>'
    return f"""
    <tr><td class="strip-pad" style="background:{p['stripBg']};padding:20px 40px 18px;text-align:center;border-bottom:1px solid {p['stripLine']};">
      <table class="mq-label" cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 12px;"><tr>
        <td class="mq-rule" style="width:120px;vertical-align:middle;"><div style="height:1px;line-height:1px;font-size:0;background:{p['stripLine']};">&nbsp;</div></td>
        <td class="strip-label" style="padding:0 14px;font-size:10.5px;font-weight:800;letter-spacing:3.2px;text-transform:uppercase;color:{p['stripInk']};white-space:nowrap;">Casting across every format</td>
        <td class="mq-rule" style="width:120px;vertical-align:middle;"><div style="height:1px;line-height:1px;font-size:0;background:{p['stripLine']};">&nbsp;</div></td>
      </tr></table>
      <table class="mq-desk" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center" style="width:100%;max-width:1000px;margin:0 auto;"><tr>
        {col("a24-black.png", 72, False)}{col("neon-black.png", 106, False)}{col("netflix-red.png", 111, True)}
      </tr></table>
      <!--[if !mso]><!-->
      <table class="mq-mob" cellpadding="0" cellspacing="0" role="presentation" align="center" style="display:none;margin:0 auto;"><tr>
        {cell("a24-black.png","l-a24",72)}{dot}{cell("neon-black.png","l-neon",106)}{dot}{cell("netflix-red.png","l-nflx",111)}
      </tr></table>
      <!--<![endif]-->
      <div class="mq-sub" style="margin-top:12px;font-size:11px;letter-spacing:.4px;color:{p['stripInk']};">Indie features to streaming series &mdash; the same inbox.</div>
    </td></tr>"""


# "Promise cards" (owner's pick B, 2026-09-25): tinted panel, three columns,
# ringed check + serif promise + a short line under each. On phones the
# columns stack into centred rows split by hairlines (.tB rules below).
TRUST = [("Free to join", "Set up in two minutes"),
         ("Free to submit", "Straight to the casting team"),
         ("Every profile reviewed", "Read by a real person")]


def trust(p):
    cols = []
    for i, (t, sub) in enumerate(TRUST):
        last = i == len(TRUST) - 1
        br = "" if last else f"border-right:1px solid {p['line']};"
        cls = "tB tB-last" if last else "tB"
        cols.append(f"""<td class="{cls}" width="33%" style="width:33.33%;vertical-align:top;text-align:center;padding:4px 14px;{br}">
          <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 10px;"><tr><td width="36" height="36" style="width:36px;height:36px;border:2px solid {p['rule']};border-radius:40px;text-align:center;vertical-align:middle;font-size:16px;line-height:16px;font-weight:800;color:{p['cta']};">&#10003;</td></tr></table>
          <div class="tB-t" style="font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:700;color:{p['ink']};line-height:1.25;">{t}</div>
          <div style="font-size:12.5px;color:{p['body']};margin-top:5px;line-height:1.5;">{sub}</div>
        </td>""")
    return f"""<table class="trust-b" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:30px auto 0;width:100%;max-width:720px;background:{p['stripBg']};border-radius:14px;"><tr><td class="trust-b-in" style="padding:22px 10px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
        {"".join(cols)}
        </tr></table>
      </td></tr></table>"""


def template(key):
    p, c = PALETTES[key], COPY[key]
    tag = "NAVY" if key == "obsession" else "SAGE"
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>{c['title']}</title>
<style>
@media only screen and (max-width:620px){{
  .col{{display:block!important;width:100%!important;padding-right:0!important;}}
  .col+.col{{padding-top:14px!important;}}
  .row-pad,.prem-pad,.strip-pad{{padding-left:18px!important;padding-right:18px!important;}}
  .mast{{padding:26px 16px!important;}}
  .mast-logo{{width:34px!important;height:34px!important;border-radius:8px!important;}}
  .mast-word{{font-size:26px!important;letter-spacing:3px!important;margin-left:12px!important;}}
  .mast-sub{{font-size:11px!important;letter-spacing:3px!important;margin-top:12px!important;}}
  .hl{{font-size:28px!important;}} .hl2{{font-size:25px!important;}}
  .hl br,.hl2 br{{display:none!important;}}
  .trust-b{{margin-top:24px!important;border-radius:12px!important;}}
  .trust-b-in{{padding:6px 18px!important;}}
  .tB{{display:block!important;width:auto!important;border-right:0!important;border-bottom:1px solid {p['line']}!important;padding:16px 0!important;}}
  .tB-last{{border-bottom:0!important;}}
  .tB-t{{font-size:18px!important;}}
  .l-a24{{width:38px!important;height:16px!important;}}
  .l-neon{{width:56px!important;height:16px!important;}}
  .l-nflx{{width:58px!important;height:16px!important;}}
  .sep{{padding:0 11px!important;}}
  .strip-label{{font-size:9.5px!important;letter-spacing:2.2px!important;padding:0 8px!important;}}
  .mq-desk{{display:none!important;}}
  .mq-mob{{display:table!important;}}
  .strip-pad{{padding-top:16px!important;padding-bottom:14px!important;}}
  .mq-label{{margin-bottom:10px!important;}}
  .mq-rule{{width:44px!important;}}
  .mq-sub{{margin-top:10px!important;}}
}}
</style></head>
<body style="margin:0;padding:0;background:{p['paper']};-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{c['preheader']}</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:{p['paper']};">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:1400px;width:100%;">

    <tr><td class="mast" style="background:{p['mastBgFlat']};background:{p['mastBg']};padding:38px 40px 34px;text-align:center;">
      <a href="{APP}" style="text-decoration:none;">
        <img class="mast-logo" src="{APP}/email/castslate-logo.png" width="54" height="54" alt="CastSlate" style="width:54px;height:54px;vertical-align:middle;border-radius:13px;border:0;"/>
        <span class="mast-word" style="vertical-align:middle;margin-left:18px;font-size:40px;font-weight:800;letter-spacing:5px;color:{p['mastInk']};">CASTSLATE</span>
      </a>
      <div class="mast-sub" style="margin-top:16px;font-size:14px;font-weight:700;letter-spacing:4.5px;text-transform:uppercase;color:{p['mastSub']};">{c['slot']}</div>
    </td></tr>
    {marquee(p)}

    <tr><td style="padding:0;line-height:0;"><img src="{c['still']}" width="1400" alt="{c['alt']}" style="display:block;width:100%;height:auto;border:0;"/></td></tr>
    <tr><td style="height:5px;line-height:5px;font-size:0;background:{p['rule']};">&nbsp;</td></tr>
    <tr><td class="row-pad" style="padding:14px 40px 0;text-align:center;font-size:10px;color:{p['stripInk']};letter-spacing:.4px;">Still: <em>{c['film']}</em> ({c['year']})</td></tr>

    <tr><td class="row-pad" style="padding:34px 40px 10px;text-align:center;">
      <div style="font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:{p['kicker']};margin-bottom:14px;">{c['kicker']}</div>
      <h1 class="hl" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:40px;font-weight:700;color:{p['ink']};letter-spacing:-.5px;line-height:1.12;">{c['headline']}</h1>
      <p style="margin:0 auto;max-width:600px;font-size:16px;line-height:1.75;color:{p['body']};">{c['lede']}</p>
      {trust(p)}
    </td></tr>

    <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="height:2px;line-height:2px;font-size:0;background:{p['rule']};">&nbsp;</td></tr>
{{{{CASTINGS_WIDE_{tag}}}}}

    <tr><td class="row-pad" style="padding:30px 40px 46px;text-align:center;border-top:1px solid {p['line']};">
      <a href="{APP}/browse-castings" style="display:inline-block;background:transparent;border:2px solid {p['cta']};color:{p['cta']};text-decoration:none;padding:13px 36px;border-radius:{p['radius']};font-size:14px;font-weight:800;">Browse all open castings</a>
    </td></tr>

    <tr><td class="prem-pad" style="background:{p['darkFlat']};background:{p['darkBg']};padding:48px 40px;text-align:center;">
      <div style="font-size:11px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:{p['darkAccent']};margin-bottom:14px;">The CastSlate guarantee</div>
      <h2 class="hl2" style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:{p['darkInk']};line-height:1.15;">Every actor gets seen.</h2>
      <p style="margin:0 auto 28px;max-width:520px;font-size:15.5px;line-height:1.7;color:{p['darkBody']};">Casting directors review profiles one at a time &mdash; no grids, no endless scrolling, no skipping. No paywall on submitting. Every single submission is reviewed.</p>
      <a href="{APP}/signup" style="display:inline-block;background:{p['darkCtaFlat']};background:{p['darkCta']};color:{p['darkCtaInk']};text-decoration:none;padding:17px 50px;border-radius:{p['radius']};font-size:16px;font-weight:800;letter-spacing:.3px;">Create your free profile &rarr;</a>
      <div style="margin-top:16px;font-size:12.5px;letter-spacing:1px;color:{p['darkBody']};">FREE TO JOIN &nbsp;&middot;&nbsp; FREE TO SUBMIT &nbsp;&middot;&nbsp; TAKES 2 MINUTES</div>
    </td></tr>

    <tr><td class="row-pad" style="background:{p['foot']};padding:34px 40px;text-align:center;">
      <div style="font-size:17px;font-weight:800;letter-spacing:2.6px;color:{p['footInk']};">CASTSLATE</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:{p['footSub']};margin-top:8px;">Get seen. Get cast.</div>
      <div style="margin-top:18px;font-size:12px;line-height:1.8;color:{p['footSub']};">You&rsquo;re getting this because you signed up for casting calls from CastSlate.<br/>
        Film still shown for editorial illustration; <em>{c['film']}</em> is not a CastSlate production and is not casting through this email.<br/>
        <a href="{{{{UNSUB_URL}}}}" style="color:{p['footLink']};">Unsubscribe</a></div>
      <div style="margin-top:14px;font-size:11.5px;color:{p['footSub']};">&copy; 2026 CastSlate &middot; <a href="mailto:team@castslate.com" style="color:{p['footSub']};text-decoration:none;">team@castslate.com</a></div>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>
"""


def main():
    castings = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else []
    frames = []
    for key in ("obsession", "backrooms"):
        t = template(key)
        open(os.path.join(ROOT, "email", f"promo-fullpage-{key}.html"), "w").write(t)
        filled = t.replace("{{CASTINGS_WIDE_" + ("NAVY" if key == "obsession" else "SAGE") + "}}", "".join(wide_row(c, PALETTES[key]) for c in castings)) \
                  .replace("{{UNSUB_URL}}", "#")
        frames.append((key, filled))
    demo = ["""<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Full-page promo demos</title>
<style>body{margin:0;background:#e9e7e2;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#222}
header{padding:22px 28px 6px}h1{font-size:20px;margin:0 0 4px}p.s{margin:0;color:#666;font-size:13px}
.tabs{display:flex;gap:8px;padding:14px 28px}.tabs button{border:1px solid #bbb;background:#fff;padding:8px 16px;border-radius:999px;font-weight:700;cursor:pointer}
.tabs button.on{background:#222;color:#fff;border-color:#222}
.pane{display:none;padding:0 28px 40px;gap:24px;align-items:flex-start}.pane.on{display:flex}
.lab{font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#777;margin:0 0 8px}
iframe{border:0;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.12)}
.desk{flex:1;min-width:0}.desk iframe{width:100%;height:2600px}.mob iframe{width:390px;height:2600px;border-radius:24px}
</style></head><body>
<header><h1>Promo campaign &mdash; full-page versions</h1><p class="s">Same structure as the morning/evening upsell. Filled with the 3 castings live right now (send-time fills these fresh). Desktop left, phone right.</p></header>
<div class="tabs"><button class="on" data-k="obsession">A &middot; Obsession (Navy Dawn)</button><button data-k="backrooms">B &middot; Backrooms (Sage &amp; Clay)</button></div>
"""]
    for i, (key, filled) in enumerate(frames):
        s = html.escape(filled, quote=True)
        demo.append(f'<div class="pane{" on" if i == 0 else ""}" id="p-{key}"><div class="desk"><div class="lab">Desktop</div><iframe srcdoc="{s}"></iframe></div><div class="mob"><div class="lab">Phone</div><iframe srcdoc="{s}"></iframe></div></div>')
    demo.append("""<script>document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='p-'+b.dataset.k));});</script></body></html>""")
    open(os.path.join(ROOT, "email", "castslate-promo-fullpage-demo.html"), "w").write("\n".join(demo))


if __name__ == "__main__":
    main()
