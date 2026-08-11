#!/usr/bin/env python3
"""Render the rotating-hero emails day by day, plus the seed SQL for the pool.

Reads the JSON emitted by hero_curate.py, attaches the hand-written captions,
and produces:
  * email/castslate-hero-rotation-demo.html -- what the next few days look like
  * supabase/migrations/email_hero_seed.sql -- the pool itself

Captions are hand-written per still. They are the line that makes the email feel
authored rather than generated, so they do not get produced at runtime.
"""
import json, sys, os, html

CAPTIONS = {
  "Sinners": "Some rooms change what walks out of them. Three New York projects are casting this week.",
  "Weapons": "Everyone in town saw it. Nobody can describe it. Today's roles are below.",
  "Wicked": "Every ensemble you've ever loved started as a room full of people nobody had cast yet.",
  "Dune Part Two": "The desert doesn't audition you twice. Neither does a casting director's inbox.",
  "The Substance": "The industry's favourite horror is being replaced. Here's work that wants you as you are.",
  "Anora": "The best performances of the year came from faces nobody knew in January.",
  "Conclave": "A room of people deciding. On the other side of the door, someone waiting to hear.",
  "Twisters": "Chasing the thing everyone else runs from is the entire job description.",
  "Nosferatu": "A hundred and four years on, it still works — shadow, silence, and one unbearable face.",
  "Metropolis": "They built the future out of extras. Thousands of them, uncredited, unforgettable.",
  "Sherlock Jr.": "Keaton did his own stunts because nobody else would. Start where you can.",
  "Night of the Living Dead": "Shot for $114,000 by people with no permission. That's still how most films start.",
  "Carnival of Souls": "One organ, one lake, one actress. You don't need a budget to be remembered.",
  "His Girl Friday": "Nobody has talked that fast since. Ninety takes of pure nerve.",
  "The General": "The most expensive shot of the silent era. Done once, in a single take.",
  "Detour": "Six days, one road, no money. Noir was built by people improvising.",
  "F1": "Ninety seconds of finished footage, six weeks of shooting. Screen time is earned.",
  "Superman": "Someone has to play the person everyone has already pictured. Might as well be you.",
  "Thunderbolts": "The ensemble is where careers start. Every one of them was an unknown once.",
  "A Complete Unknown": "Nobody knew his name in 1961 either.",
  "Gladiator II": "Thousands of extras. One of them is in every frame you remember.",
  "Challengers": "Three people, one court, nowhere to hide. That is what a good audition feels like.",
  "The Wild Robot": "Your voice is a credit too. Some of today's roles never face a camera.",
  "Nickel Boys": "Shot almost entirely in first person. The camera was somebody's eyes.",
  "Wicked For Good": "Standing at the back of the number is how most leads started.",
  "Jurassic World Rebirth": "Reacting convincingly to nothing at all is a real skill. It pays, too.",
  "The Cabinet of Dr. Caligari": "The set was painted crooked on purpose. People are still copying it.",
  "Safety Last!": "He really did hang off the clock. Always ask what the role actually requires.",
  "The Phantom of the Opera": "Chaney designed his own makeup and refused to show it before the premiere.",
  "D.O.A.": "A man walks into a police station to report his own murder. Openings matter.",
  "Charade": "It fell into the public domain by accident, and everyone has watched it since.",
  "The Kid": "Chaplin auditioned hundreds of children. Jackie Coogan was four.",
}

# Already on the site as /logos/*.svg (the AGD_STUDIOS strip). Shown small and
# muted under the roles. NOTE: these are SVG, which Gmail strips -- they must be
# converted to PNG before this goes into a real send.
STUDIOS = [
    ("Warner Bros. Pictures", "https://www.castslate.com/logos/warner.svg", 22),
    ("Universal Pictures", "https://www.castslate.com/logos/universal.svg", 17),
    ("Walt Disney Studios", "https://www.castslate.com/logos/disney.svg", 11),
]

SLOTS = [
    ("Daily digest",   "07:00", "Today's new casting calls"),
    ("Noon upsell",    "12:00", "You're missing roles that fit you"),
    ("Evening upsell", "18:00", "Tonight's roles close soon"),
]

ROLES = [
    ("The Seventh Landing", "Independent Film &bull; New York, NY", "Lead $300/day &middot; Supporting $225/day"),
    ("The Bed Was Not In the Script", "Off-Off-Broadway &bull; AEA", "Paid stipend + industry night"),
    ("Hydrating Lip Balm Campaign", "Commercial &bull; Non-Union", "$1,000 flat, 8&ndash;10 hours"),
]


def esc(s):
    return html.escape(s, quote=False)


def render_email(row, slot_label, headline):
    """One email preview, themed to its own still."""
    dark = row["style"] == "latenight"
    accent = row["accent"]
    if dark:
        bg, panel, ink, muted, rule = "#0d0d10", "#17171d", "#ffffff", "#a9a4b6", "#26262f"
        cta_bg, cta_fg = accent, "#101014"
    else:
        bg, panel, ink, muted, rule = "#efece4", "#ffffff", "#101014", "#5c564a", "#ddd6c8"
        cta_bg, cta_fg = "#101014", "#ffffff"

    # Deliberately not "Trusted by" -- that wording claims a business
    # relationship with these studios. Keep it to what is verifiable.
    studio_label = "Casting for film, TV and stage"
    filt = "" if dark else "filter:grayscale(1);opacity:.42;"
    studios = "".join(
        f'<img src="{u}" alt="{esc(n)}" height="{h}" '
        f'style="display:inline-block;vertical-align:middle;margin:0 9px;height:{h}px;'
        f'{"filter:brightness(0) invert(1);opacity:.38;" if dark else filt}border:none;"/>'
        for n, u, h in STUDIOS)

    roles = "".join(
        f'<tr><td style="padding:9px 0;border-bottom:1px solid {rule};">'
        f'<div style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:{ink};">{esc(t)}</div>'
        f'<div style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:{muted};margin-top:2px;">{m}</div>'
        f'<div style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:{accent};margin-top:2px;font-weight:700;">{p}</div>'
        f"</td></tr>" for t, m, p in ROLES)

    return f'''
<table width="440" cellpadding="0" cellspacing="0" role="presentation" style="background:{bg};width:440px;max-width:100%;">
  <tr><td style="padding:16px 20px 10px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:900;letter-spacing:-.7px;color:{ink};">CASTSLATE</td>
      <td style="text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:8.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:{muted};">{esc(slot_label)}</td>
    </tr></table>
  </td></tr>
  <!-- Full frame, never cropped. A fixed height with object-fit:cover was
       slicing the top and bottom off the stills and decapitating faces, which
       is exactly what you notice first. TMDB backdrops are all 16:9, so letting
       the image keep its own aspect ratio costs nothing and guarantees whatever
       the cinematographer framed is what lands in the inbox. -->
  <tr><td style="padding:0;line-height:0;"><img src="{row['url']}" width="440" alt="{esc(row['title'])}" style="display:block;width:100%;height:auto;border:none;"/></td></tr>
  <tr><td style="height:3px;background:{accent};line-height:0;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:14px 20px 0;">
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:8.5px;color:{muted};letter-spacing:.4px;margin-bottom:9px;">Still: <em>{esc(row['title'])}</em>{(' (' + str(row['year']) + ')') if row.get('year') else ''}</div>
    <div style="font-family:Georgia,serif;font-size:19px;line-height:1.3;font-weight:700;color:{ink};letter-spacing:-.3px;">{esc(CAPTIONS.get(row['title'], ''))}</div>
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:{muted};margin-top:10px;">{esc(headline)}</div>
  </td></tr>
  <tr><td style="padding:12px 20px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:{panel};">
      <tr><td style="padding:4px 14px 8px;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation">{roles}</table></td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:14px 20px 4px;text-align:center;">
    <a href="#" style="display:inline-block;background:{cta_bg};color:{cta_fg};text-decoration:none;padding:11px 26px;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;">Browse All Castings</a>
  </td></tr>
  <tr><td style="padding:14px 20px 18px;text-align:center;border-top:1px solid {rule};">
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:{muted};margin-bottom:9px;">{esc(studio_label)}</div>
    {studios}
  </td></tr>
</table>'''


def main():
    rows = []
    for path in sys.argv[1:]:
        raw = open(path).read()
        rows += json.loads(raw[:raw.index("\n\n-- SQL")])
    rows = [r for r in rows if not r.get("error")]
    # Interleave light and dark so consecutive sends never look like each other.
    light = [r for r in rows if r["style"] == "marquee"]
    dark = [r for r in rows if r["style"] == "latenight"]
    rows, i = [], 0
    while light or dark:
        if dark: rows.append(dark.pop(0))
        if light: rows.append(light.pop(0))

    days, i = [], 0
    for d in range(1, len(rows) // 3 + 1):
        slots = []
        for label, time, headline in SLOTS:
            slots.append((label, time, headline, rows[i % len(rows)]))
            i += 1
        days.append((d, slots))

    cards = ""
    for d, slots in days:
        inner = "".join(
            f'<div class="slot"><div class="slot-h"><b>{esc(l)}</b><span>{t}</span>'
            f'<em>{esc(r["title"])} &middot; {r["style"]} &middot; {r["accent"]}</em></div>'
            f'{render_email(r, l, hd)}</div>' for l, t, hd, r in slots)
        cards += f'<section><h2>Day {d}</h2><div class="row">{inner}</div></section>'

    # Served as a plain file, so it needs its own charset or the em-dashes and
    # curly quotes in the captions come out as mojibake.
    page = f'''<meta charset="utf-8">
<title>CastSlate — Rotating hero, next {len(days)} days</title>
<style>
 body{{margin:0;background:#e9e9ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;}}
 .wrap{{max-width:1500px;margin:0 auto;padding:30px 18px 60px;}}
 h1{{font-size:25px;margin:0 0 6px;letter-spacing:-.5px;}}
 .lede{{color:#555;font-size:14px;line-height:1.7;max-width:820px;margin:0 0 24px;}}
 section{{margin-bottom:34px;}}
 h2{{font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:#666;margin:0 0 12px;padding-bottom:7px;border-bottom:2px solid #d3d3d8;}}
 .row{{display:flex;gap:18px;flex-wrap:wrap;}}
 .slot{{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.10);}}
 .slot-h{{padding:9px 13px;font-size:11.5px;border-bottom:1px solid #e6e6ea;display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;}}
 .slot-h span{{color:#888;}} .slot-h em{{color:#8a8a95;font-style:normal;margin-left:auto;font-size:10.5px;}}
</style>
<div class="wrap">
<h1>Rotating film-still hero — the next {len(days)} days</h1>
<p class="lede">Every send pulls the least-recently-used still, so nothing repeats until the whole pool has been shown. Each row carries its own look: the mean luminance of the picture chooses the light or dark template, and the accent colour is sampled from the image itself — so the email is themed to whatever it happens to be showing. Captions are written per still, never generated at send time. Pool is {len(rows)} images; at three sends a day nothing repeats for {len(rows)//3} days, then the rotation recycles oldest-first.</p>
{cards}
</div>'''
    out = os.path.join(os.path.dirname(__file__), "..", "email", "castslate-hero-rotation-demo.html")
    open(out, "w").write(page)
    print("wrote", os.path.normpath(out))

    seed = os.path.join(os.path.dirname(__file__), "..", "supabase", "migrations", "email_hero_seed.sql")
    with open(seed, "w") as f:
        f.write("-- Seed pool for the rotating email hero. Captions hand-written per still.\n")
        f.write("insert into public.email_hero_images (source,title,year,image_url,caption,style,accent,credit) values\n")
        vals = []
        for r in rows:
            src = "public_domain" if r.get("year") and int(r["year"]) < 1930 else "tmdb"
            cap = CAPTIONS.get(r["title"], "").replace("'", "''")
            yr = r["year"] or "null"
            vals.append(f"  ('{src}','{r['title'].replace(chr(39), chr(39)*2)}',{yr},'{r['url']}','{cap}','{r['style']}','{r['accent']}','Still: {r['title'].replace(chr(39), chr(39)*2)}')")
        f.write(",\n".join(vals) + "\non conflict do nothing;\n")
    print("wrote", os.path.normpath(seed))


if __name__ == "__main__":
    main()
