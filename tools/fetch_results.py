"""Fetch the official weekly Fantasy Tribe results from Global TV and save them for the site.

Global posts each episode's results as an image whose alt text lists every castaway's total, e.g.
  "EPISODE 2 POINTS:"  <img src=".../survivor-50-episode-2-points.jpg" alt="Aubry total points: 21; Joe total points: 11; ...">
and, at the finale, a tip naming the winner ("...if you chose Aubry as your MVP...").

For every folder given (default: every season marked "current" in seasons/seasons.csv) this reads the "Results page" URL from settings.csv and writes
  official_points.csv  episode,castaway,points
  official_meta.csv    key,value  (source, checked_at, episodes, winner)
Only the files whose content actually changed are rewritten. Standard library only.
"""
import csv, datetime, html, io, os, re, sys, urllib.request

UA = "Mozilla/5.0 (survivor-pool results fetcher; +https://github.com/leighjbgmailcom/survivor-pool)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse(page):
    """Return ({episode: {castaway: points}}, winner or None)."""
    results = {}
    last_end = 0
    for m in re.finditer(r"<img\b[^>]*>", page, re.I | re.S):
        tag = m.group(0)
        alt = re.search(r'\balt\s*=\s*"([^"]*)"', tag, re.I | re.S) or re.search(r"\balt\s*=\s*'([^']*)'", tag, re.I | re.S)
        if not alt:
            continue
        text = html.unescape(alt.group(1))
        pairs = re.findall(r"([^;:]+?)\s+total points?\s*:\s*(-?\d+)", text, re.I)
        if not pairs:
            continue
        # Prefer the "EPISODE N POINTS" heading above the image; Global's filenames are sometimes wrong
        # (Season 50's episode 8 image is named "...episode-9-points").
        ep = None
        heads = re.findall(r"EPISODE\s+(\d+)\s+POINTS", re.sub(r"<[^>]+>", " ", page[last_end: m.start()]), re.I)
        if heads:
            ep = int(heads[-1])
        else:
            src = re.search(r'\b(?:data-)?src\s*=\s*["\']([^"\']+)', tag, re.I)
            f = re.search(r"episode[-_ ]?(\d+)[-_ ]?points", src.group(1), re.I) if src else None
            if f:
                ep = int(f.group(1))
        last_end = m.end()
        if ep is None:
            print(f"  skipped an image with points but no episode number: {text[:60]}…", file=sys.stderr)
            continue
        if ep in results:
            print(f"  episode {ep} appears twice on the page; keeping the first", file=sys.stderr)
            continue
        results[ep] = {name.strip(): int(p) for name, p in pairs}
    plain = html.unescape(re.sub(r"<[^>]+>", " ", page))
    w = re.search(r"if you (?:chose|picked|selected)\s+(.+?)\s+as your MVP", plain, re.I)
    return results, (w.group(1).strip() if w else None)


def to_csv(header, rows):
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\n")
    wr.writerow(header)
    wr.writerows(rows)
    return buf.getvalue()


def write_if_changed(path, text):
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        return True
    return False


COLOR_WORDS = {"yellow": "#E8B820", "gold": "#D9A400", "orange": "#E07A1F", "red": "#C8322B", "purple": "#7B4BB7",
               "blue": "#2F6FC4", "teal": "#1F9AA0", "green": "#2B8A4E", "pink": "#D6548E", "black": "#333333",
               "white": "#9A9A9A", "brown": "#8A5A2B"}


def parse_cast(page):
    """Read the tribe table ("Toka (Yellow Tribe) | Savu (Purple Tribe)" with castaways underneath).
    Returns [(name, tribe, aliases)] and {tribe: colour} — empty if the page has no such table yet."""
    for table in re.findall(r"<table\b.*?</table>", page, re.I | re.S):
        rows = []
        for tr in re.findall(r"<tr\b.*?</tr>", table, re.I | re.S):
            cells = [html.unescape(re.sub(r"<[^>]+>", " ", c)) for c in re.findall(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", tr, re.I | re.S)]
            rows.append([re.sub(r"\s+", " ", c).strip() for c in cells])
        rows = [r for r in rows if any(r)]
        if len(rows) < 3 or not all(re.search(r"tribe", h, re.I) for h in rows[0] if h):
            continue
        tribes, colours = [], {}
        for h in rows[0]:
            name = re.sub(r"\s*\(.*\)", "", h).strip()
            tribes.append(name)
            word = re.search(r"\(\s*(\w+)", h)
            if name and word and word.group(1).lower() in COLOR_WORDS:
                colours[name] = COLOR_WORDS[word.group(1).lower()]
        cast = []
        for r in rows[1:]:
            for i, cell in enumerate(r):
                if not cell or i >= len(tribes) or not tribes[i]:
                    continue
                # An “Thien An” → name Thien An, also known as An
                q = re.search(r"[\"“”']([^\"“”']+)[\"“”']", cell)
                if q:
                    outer = re.sub(r"[\"“”'][^\"“”']+[\"“”']", "", cell).strip()
                    cast.append((q.group(1).strip(), tribes[i], outer))
                else:
                    cast.append((cell, tribes[i], ""))
        if len(cast) >= 6:
            return cast, colours
    return [], {}


def fill_cast(folder, page):
    """Save Global's cast list, and fill castaways.csv from it when the season has no cast yet."""
    cast, colours = parse_cast(page)
    if not cast:
        return
    write_if_changed(os.path.join(folder, "official_cast.csv"), to_csv(["name", "tribe", "aliases"], cast))
    path = os.path.join(folder, "castaways.csv")
    existing = list(csv.DictReader(open(path, encoding="utf-8"))) if os.path.exists(path) else []
    if any((r.get("name") or "").strip() for r in existing):
        return  # organizers already set the cast; never overwrite it
    write_if_changed(path, to_csv(["name", "tribe", "out_episode", "finish", "aliases"], [(n, t, "", "", a) for n, t, a in cast]))
    if colours:
        spath = os.path.join(folder, "settings.csv")
        rows = [r for r in csv.reader(open(spath, encoding="utf-8")) if r]
        have = {r[0].strip().lower() for r in rows}
        for t, c in colours.items():
            if f"tribe color {t}".lower() not in have:
                rows.insert(len(rows) - 1 if rows[-1][0] == "Announcement" else len(rows), [f"Tribe color {t}", c])
        write_if_changed(spath, to_csv(rows[0], rows[1:]))
    print(f"{folder}: filled in the cast from Global TV ({len(cast)} castaways, tribes {', '.join(dict.fromkeys(t for _, t, _ in cast))})")


def run(folder):
    settings = {r["setting"].strip().lower(): r["value"].strip() for r in csv.DictReader(open(os.path.join(folder, "settings.csv"), encoding="utf-8"))}
    url = settings.get("results page", "")
    if not url:
        print(f"{folder}: no 'Results page' in settings.csv, skipping")
        return
    page = fetch(url)
    fill_cast(folder, page)
    results, winner = parse(page)
    old_path = os.path.join(folder, "official_points.csv")
    if not results and os.path.exists(old_path) and len(open(old_path, encoding="utf-8").read().strip().splitlines()) > 1:
        print(f"{folder}: found no results on the page but already have some; leaving them alone (page format changed?)", file=sys.stderr)
        return
    rows = [(ep, name, pts) for ep in sorted(results) for name, pts in results[ep].items()]
    changed = write_if_changed(os.path.join(folder, "official_points.csv"), to_csv(["episode", "castaway", "points"], rows))
    meta_path = os.path.join(folder, "official_meta.csv")
    meta = [("source", url), ("episodes", " ".join(map(str, sorted(results)))), ("winner", winner or "")]
    # only bump the timestamp when the results changed, so quiet runs don't create commits
    if changed or not os.path.exists(meta_path):
        meta.append(("updated_at", datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")))
    else:
        old = {r["key"]: r["value"] for r in csv.DictReader(open(meta_path, encoding="utf-8"))}
        meta.append(("updated_at", old.get("updated_at", "")))
    write_if_changed(meta_path, to_csv(["key", "value"], meta))
    print(f"{folder}: episodes {sorted(results) or 'none yet'}{', winner ' + winner if winner else ''}{' (updated)' if changed else ' (no change)'}")


def active_seasons():
    """Folders of seasons that are still running (status 'current'), from seasons/seasons.csv."""
    rows = csv.DictReader(open(os.path.join("seasons", "seasons.csv"), encoding="utf-8"))
    return [os.path.join("seasons", r["season"].strip()) for r in rows if (r.get("status") or "").strip().lower() == "current"]


if __name__ == "__main__":
    for folder in sys.argv[1:] or active_seasons():
        try:
            run(folder)
        except Exception as e:  # one season failing shouldn't stop the other
            print(f"{folder}: FAILED {e}", file=sys.stderr)
