#!/usr/bin/env python3
"""Curate rotating email hero stills.

Given film titles, finds the TMDB entry, picks a usable widescreen backdrop, and
derives the look of the email from the picture itself:

  * mean luminance decides the template variant -- dark stills get the
    'latenight' (dark cinema) treatment, bright ones get 'marquee' (cream/ink
    editorial). This reproduces the choices made by hand for the Backrooms and
    Obsession sends.
  * the most saturated colour that is still usable as ink/foil becomes `accent`.

Emits SQL INSERTs for public.email_hero_images. Captions are written by hand --
they are the one part worth not automating.

    python3 tools/hero_curate.py "Sinners" "Nosferatu:1922"
"""
import colorsys, io, json, re, sys, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}
TMDB = "https://www.themoviedb.org"


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def find_movie(title, year=None):
    """Resolve a title to a TMDB movie id by scraping the public search page.

    The year matters more than it looks: searching "Nosferatu" returns the 2024
    remake, not the 1922 original, and public-domain status hangs entirely on
    which one you got. When a year is given, only accept a result whose release
    date matches it.
    """
    html = get(f"{TMDB}/search/movie?query={urllib.parse.quote(title)}").decode("utf8", "ignore")
    hits = re.findall(r'href="/movie/(\d+)-([a-z0-9-]+)"', html)
    if not hits:
        return None
    if not year:
        return hits[0]
    seen = set()
    for mid, slug in hits:
        if mid in seen:
            continue
        seen.add(mid)
        try:
            page = get(f"{TMDB}/movie/{mid}-{slug}").decode("utf8", "ignore")
        except Exception:
            continue
        if re.search(r'release_date[^0-9]{0,20}' + re.escape(str(year)), page) or \
           re.search(r'\(\s*' + re.escape(str(year)) + r'\s*\)', page):
            return mid, slug
    return None


def backdrops(mid, slug, limit=6):
    html = get(f"{TMDB}/movie/{mid}-{slug}/images/backdrops").decode("utf8", "ignore")
    paths, seen = [], set()
    for p in re.findall(r"image\.tmdb\.org/t/p/[a-z0-9_]+/([A-Za-z0-9]+\.jpg)", html):
        if p not in seen:
            seen.add(p)
            paths.append(p)
        if len(paths) >= limit:
            break
    return paths


def analyse(jpeg_bytes):
    from PIL import Image
    im = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    w, h = im.size
    im.thumbnail((160, 160))
    px = list(im.getdata())
    luma = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px) / len(px)

    q = im.quantize(colors=8, method=Image.MEDIANCUT).convert("RGB")
    cols = sorted(q.getcolors(), key=lambda c: -c[0])
    total = sum(c[0] for c in cols)

    best, score_best = None, -1.0
    for cnt, (r, g, b) in cols:
        hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        # favour saturated mid-tones that actually read as an accent, but keep
        # some weight on how much of the frame the colour occupies
        score = ss * (1 - abs(ll - 0.55) * 1.4) * (cnt / total) ** 0.25
        if score > score_best:
            score_best, best = score, (hh, ll, ss)
    hh, ll, ss = best
    ll = min(max(ll, 0.52), 0.72)   # lift so it is legible on both backgrounds
    ss = min(max(ss, 0.45), 0.95)
    r, g, b = colorsys.hls_to_rgb(hh, ll, ss)
    accent = "#%02X%02X%02X" % (int(r * 255), int(g * 255), int(b * 255))
    return {
        "luma": round(luma, 1),
        "style": "latenight" if luma < 110 else "marquee",
        "accent": accent,
        "ratio": round(w / h, 2),
        "size": (w, h),
    }


def sql_escape(s):
    return s.replace("'", "''")


def curate(spec):
    title, _, year = spec.partition(":")
    year = year.strip() or None
    found = find_movie(title, year)
    if not found:
        return {"title": title, "error": "not found on TMDB"}
    mid, slug = found
    for path in backdrops(mid, slug):
        url = f"https://image.tmdb.org/t/p/w1280/{path}"
        try:
            data = get(url)
        except Exception as e:
            continue
        a = analyse(data)
        if a["ratio"] < 1.6:      # skip near-square art, it crops badly in email
            continue
        return {"title": title, "year": year or None, "tmdb": mid, "url": url, **a}
    return {"title": title, "error": "no usable widescreen backdrop"}


if __name__ == "__main__":
    rows = [curate(s) for s in sys.argv[1:]]
    print(json.dumps(rows, indent=2))
    print("\n-- SQL (fill in the captions by hand)\n")
    for r in rows:
        if r.get("error"):
            print(f"-- SKIPPED {r['title']}: {r['error']}")
            continue
        print(
            "insert into public.email_hero_images "
            "(source,title,year,image_url,caption,style,accent,credit) values\n"
            f"  ('tmdb','{sql_escape(r['title'])}',{r['year'] or 'null'},'{r['url']}',"
            f"'TODO caption','{r['style']}','{r['accent']}',"
            f"'Still: {sql_escape(r['title'])}');"
        )
