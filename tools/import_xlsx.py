"""Convert Mark's season workbooks (Players_Picks_Sxx.xlsx + Cast_Points_Sxx.xlsx) into the site's CSV files.
Strips email addresses, notes and app keys so nothing private lands in the public repo.
Usage: python3 tools/import_xlsx.py Players_Picks_S51.xlsx Cast_Points_S51.xlsx data/ --season 51 ...
"""
import argparse, csv, collections, os, re, sys, warnings
import openpyxl
warnings.filterwarnings("ignore")

ap = argparse.ArgumentParser()
ap.add_argument("picks"); ap.add_argument("points"); ap.add_argument("out")
ap.add_argument("--season", required=True); ap.add_argument("--pool-name", required=True)
ap.add_argument("--deadline", required=True); ap.add_argument("--picks-per-tribe", default="4")
ap.add_argument("--max-tribe-size", default="6"); ap.add_argument("--merge-episode", default="")
ap.add_argument("--episodes", type=int, default=13); ap.add_argument("--first-air-date", default="")
ap.add_argument("--colors", default=""); ap.add_argument("--announcement", default="")
a = ap.parse_args()

def rows(f, sheet):
    return [r for r in openpyxl.load_workbook(f, data_only=True)[sheet].iter_rows(values_only=True) if any(v is not None for v in r)]
tribe = lambda t: re.sub(r"\s*\(.*\)", "", t or "").strip()
def w(name, head, data):
    with open(os.path.join(a.out, name), "w", newline="", encoding="utf-8") as f:
        x = csv.writer(f); x.writerow(head); x.writerows(data)
os.makedirs(a.out, exist_ok=True)

# castaways
cast = rows(a.points, "Cast Members")
hdr = [str(h) for h in cast[2]]; ix = {h: i for i, h in enumerate(hdr)}
castaways = []
for r in cast[3:]:
    if not r[0]: continue
    place = r[ix["Placement"]]; out = r[ix["Episode Left Game"]]
    alias = "An;Thien An" if r[0] == "Thien An" else ""
    castaways.append((r[0], tribe(r[ix["Initial Tribe"]]), out or "", place if place in (1, 2, 3) else "", alias))
w("castaways.csv", ["name", "tribe", "out_episode", "finish", "aliases"], castaways)

# scoring categories exactly as Mark names them
types = [(r[0], r[1]) for r in rows(a.points, "Point Types")[1:] if r[0] and r[0] != "No Score"]
w("scoring.csv", ["event", "points"], types)

# events (every point, including survival and finale placings, as Mark enters them)
pts = rows(a.points, "Points")[1:]
seen = collections.Counter((r[0], r[1], str(r[2]).lower()) for r in pts)
dups = [k for k, n in seen.items() if n > 1]
if dups: print("duplicate rows (kept once):", dups, file=sys.stderr)
w("events.csv", ["episode", "castaway", "event"], sorted({(r[0], r[1], r[2]) for r in pts}, key=lambda r: (r[0], r[1])))
scored = sorted({r[0] for r in pts})
post = sorted({r[0] for r in pts if str(r[2]).startswith("Survived the Week (Post")})

import datetime
eps = []
for n in range(1, a.episodes + 1):
    d = (datetime.date.fromisoformat(a.first_air_date) + datetime.timedelta(weeks=n - 1)).isoformat() if a.first_air_date else ""
    eps.append((n, d, "yes" if post and n >= post[0] else "", "yes" if n in scored else ""))
w("episodes.csv", ["episode", "air_date", "post_merge", "published"], eps)

# players and picks
players = rows(a.picks, "Players")
ph = [str(h) for h in players[5]]; pix = {h: i for i, h in enumerate(ph)}
picks = collections.defaultdict(lambda: {"picks": [], "mvp": "", "merge": "", "swap": ""})
for r in rows(a.picks, "Player Picks")[1:]:
    p = picks[r[0]]; kind = r[3]
    if kind in (1, 2): p["picks"].append(r[2])
    if kind == 2: p["mvp"] = r[2]
    if kind == 3: p["merge"] = r[2]
    if kind == 4: p["swap"] = r[2]
n = max(len(p["picks"]) for p in picks.values())
out = []
for r in players[6:]:
    name = r[0]
    if not name: continue
    paid = r[pix["Paid?"]]
    p = picks.get(name)
    if not p: print("no picks for", name, file=sys.stderr); continue
    out.append([name, "yes" if paid not in (None, "", "N", "n") else "", p["mvp"]] + p["picks"] + [""] * (n - len(p["picks"])) + [p["merge"], p["swap"]])
w("players.csv", ["player", "paid", "mvp"] + [f"pick{i}" for i in range(1, n + 1)] + ["merge_pick", "swap_out"], out)

tribes = list(dict.fromkeys(c[1] for c in castaways))
colors = dict(zip(tribes, a.colors.split(","))) if a.colors else {}
w("settings.csv", ["setting", "value"], [
    ("Pool name", a.pool_name), ("Season", a.season), ("Entry fee", "10"), ("E-transfer email", "markrirwin@hotmail.com"),
    ("Commissioner", "Mark Irwin"), ("Picks deadline", a.deadline), ("First scoring episode", "2"),
    ("Picks per tribe", a.picks_per_tribe), ("Max tribe size", a.max_tribe_size), ("Merge episode", a.merge_episode),
    ("Survival points", "entered"),
] + [(f"Tribe color {t}", c) for t, c in colors.items()] + [("Announcement", a.announcement)])
print(f"{a.out}: {len(castaways)} castaways, {len(out)} players, {len(pts)} point rows, episodes scored {scored}, post-merge from {post[:1]}")
