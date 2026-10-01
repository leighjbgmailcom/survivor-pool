# Survivor Fantasy Pool

A leaderboard website for our office Survivor pool. Scoring follows the
[Global TV Survivor Fantasy Tribe rules](https://www.globaltv.com/survivor-51-fantasy-tribe/).

- **Live site:** https://leighjbgmailcom.github.io/survivor-pool/
- **Demo (last season, Survivor 50):** https://leighjbgmailcom.github.io/survivor-pool/?demo
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
them to `data/official_points.csv`. The site picks them up within a minute or two.

- To fetch right away, open the repo's **Actions** tab → **Fetch official scores** → **Run workflow**.
- Each season, set **Results page** in the admin page's Settings to that season's Fantasy Tribe page.
- A castaway counts as out from the last episode they appear in once they drop off Global's list,
  so the site shows someone who just left as "still in" until the next week's results. To mark them
  out sooner, use **Out in ep** on the Castaways tab.
- If Global's names differ from ours (e.g. "Thien An" vs "An"), add the other spelling under
  **Other spellings** on the Castaways tab. A red box on the Standings page lists any names
  that don't match.
- Weeks Global hasn't posted can still be scored by hand in `data/events.csv` (`episode,castaway,event`,
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

### New season
1. **Settings:** season, pool name, deadline, picks per tribe, max tribe size, Results page; clear Merge episode.
2. **Castaways:** replace the list with the new cast and tribes.
3. **Players:** delete last season's players (or edit them) and add the new picks.
4. In the repo, empty `data/official_points.csv` and `data/events.csv`, keeping the first line of each.

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
- `data/`: the current season · `demo/`: Survivor 50, as a finished example
- `tools/fetch_results.py` + `.github/workflows/fetch-results.yml`: automatic weekly scores
- `tools/import_xlsx.py`: converts Mark's season workbooks into these CSVs, leaving out emails and notes
- `supabase/`: database version (logins, self-serve picks)
