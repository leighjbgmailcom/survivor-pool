"""Fetch the official weekly Fantasy Tribe results from Global TV and save them for the site.

Global posts each episode's results as an image whose alt text lists every castaway's total, e.g.
  "EPISODE 2 POINTS:"  <img src=".../survivor-50-episode-2-points.jpg" alt="Aubry total points: 21; Joe total points: 11; ...">
and, at the finale, a tip naming the winner ("...if you chose Aubry as your MVP...").

For every folder given (default: data and demo) this reads the "Results page" URL from settings.csv and writes
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
    for m in re.finditer(r"<img\b[^>]*>", page, re.I | re.S):
        tag = m.group(0)
        alt = re.search(r'\balt\s*=\s*"([^"]*)"', tag, re.I | re.S) or re.search(r"\balt\s*=\s*'([^']*)'", tag, re.I | re.S)
        if not alt:
            continue
        text = html.unescape(alt.group(1))
        pairs = re.findall(r"([^;:]+?)\s+total points?\s*:\s*(-?\d+)", text, re.I)
        if not pairs:
            continue
        ep = None
        src = re.search(r'\b(?:data-)?src\s*=\s*["\']([^"\']+)', tag, re.I)
        if src:
            f = re.search(r"episode[-_ ]?(\d+)[-_ ]?points", src.group(1), re.I)
            if f:
                ep = int(f.group(1))
        if ep is None:  # fall back to the nearest "EPISODE N POINTS" heading above the image
            heads = re.findall(r"EPISODE\s+(\d+)\s+POINTS", re.sub(r"<[^>]+>", " ", page[: m.start()]), re.I)
            if heads:
                ep = int(heads[-1])
        if ep is None:
            print(f"  skipped an image with points but no episode number: {text[:60]}…", file=sys.stderr)
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


def run(folder):
    settings = {r["setting"].strip().lower(): r["value"].strip() for r in csv.DictReader(open(os.path.join(folder, "settings.csv"), encoding="utf-8"))}
    url = settings.get("results page", "")
    if not url:
        print(f"{folder}: no 'Results page' in settings.csv, skipping")
        return
    results, winner = parse(fetch(url))
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


if __name__ == "__main__":
    for folder in sys.argv[1:] or ["data", "demo"]:
        try:
            run(folder)
        except Exception as e:  # one season failing shouldn't stop the other
            print(f"{folder}: FAILED {e}", file=sys.stderr)
