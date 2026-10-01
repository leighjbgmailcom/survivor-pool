# Survivor Fantasy Pool

A leaderboard website for our office Survivor pool. Scoring follows the
[Global TV Survivor Fantasy Tribe rules](https://www.globaltv.com/survivor-51-fantasy-tribe/).

- **Live site:** https://leighjbgmailcom.github.io/survivor-pool/
- **A past season:** https://leighjbgmailcom.github.io/survivor-pool/?season=50 (or use the Season picker / Seasons tab)
- **Organizers:** https://leighjbgmailcom.github.io/survivor-pool/admin.html (passcode)

## How it works

| What | Who / how |
|---|---|
| Settings, castaways, players, picks, paid, merge picks | Organizers, on the **admin page** |
| Weekly scores | **Automatic.** A scheduled GitHub job reads Global TV's results page every Thursday evening (and once a day as a catch-up) |
| Who's out, the winner, the MVP bonus | Automatic, worked out from Global's results |

### Weekly scores (automatic)
Global posts each episode's points on Thursday evenings after 6 PM Eastern, as an image whose
description lists every castaway's total ("Aubry total points: 21; …"). The job in
`.github/workflows/fetch-results.yml` runs `tools/fetch_results.py`, which reads those totals and saves
them to that season's `official_points.csv`. Only the season marked **current** is fetched. The site picks them up within a minute or two.

- To fetch right away, open the repo's **Actions** tab → **Fetch official scores** → **Run workflow**.
- Each season, set **Results page** in the admin page's Settings to that season's Fantasy Tribe page.
- A castaway counts as out from the last episode they appear in once they drop off Global's list,
  so the site shows someone who just left as "still in" until the next week's results. To mark them
  out sooner, use **Out in ep** on the Castaways tab.
- If Global's names differ from ours (e.g. "Thien An" vs "An"), add the other spelling under
  **Other spellings** on the Castaways tab. A red box on the Standings page lists any names
  that don't match.
- Weeks Global hasn't posted can still be scored by hand in the season's `events.csv` (`episode,castaway,event`,
  using the category names in `scoring.csv`). Once Global's numbers for that episode arrive, they replace
  the hand-entered ones.

### Admin page
Anyone with the passcode can edit settings, castaways and players. Changes save straight into this
repo and show on the site in about a minute. Every change is kept in the repo's history, so mistakes
are easy to undo.

**One-time setup (repo owner):** open the admin page. It walks you through creating a GitHub key
(fine-grained token, this repo only, *Contents: Read and write*) and choosing a passcode. The key is
saved in `admin-key.json`, locked with the passcode, so it can't be used without the passcode.
This keeps honest players honest; it isn't bank-grade security. Change the passcode or replace an
expired key on the admin page's **Passcode** tab.

### Seasons
Each season lives in its own folder, `seasons/<number>/`, and `seasons/seasons.csv` lists them
(`season,name,status`; status is `current`, `finished` or `hidden`). The site opens on the current
season. Its **Seasons** tab lists every season with the pool winner, and the picker in the header
switches between them.

**New season:** on the admin page, go to **Seasons → Start a new season**. That copies the settings and
scoring categories, makes the new season current, and marks the old one finished. Then set the picks
deadline (Settings), the cast (Castaways) and the players.

**Adding an old season:** convert its two workbooks with
`python3 tools/import_xlsx.py Players_Picks_S49.xlsx Cast_Points_S49.xlsx seasons/49 --season 49 --pool-name "Survivor 49 Fantasy Pool" --deadline 2025-09-24T20:00:00-04:00`
(add `--picks-per-tribe 3` etc. if that season differed), then add `49,Survivor 49,finished` to `seasons/seasons.csv`.

---

## Setting up GitHub Pages (one time)
Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`** → Save.

## Switching to Supabase later (logins + self-serve picks)
`supabase/` holds a fuller version where players log in and enter their own picks.
1. Create a Supabase project. (The free plan allows two active projects.)
2. In the SQL editor, run `supabase/schema.sql` and then `supabase/seed.sql`.
3. **Authentication → Providers → Email:** turn off "Confirm email". Under **URL Configuration**,
   set the Site URL to the GitHub Pages address.
4. Put the project URL and publishable key in `config.js`.

## Files
- `index.html`, `style.css`, `app.js`: the public site · `csv-data.js`: loads the CSVs and does the scoring
- `admin.html`, `admin.js`: the admin page · `admin-key.json`: the passcode-locked GitHub key
- `seasons/`: one folder per season, plus `seasons.csv`
- `tools/fetch_results.py` + `.github/workflows/fetch-results.yml`: automatic weekly scores
- `tools/import_xlsx.py`: converts Mark's season workbooks into these CSVs, leaving out emails and notes
- `supabase/`: database version (logins, self-serve picks)
