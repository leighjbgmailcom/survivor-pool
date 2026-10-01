# Survivor Fantasy Pool

A leaderboard website for our office Survivor pool. Scoring follows the
[Global TV Survivor Fantasy Tribe rules](https://www.globaltv.com/survivor-51-fantasy-tribe/).

**Live site:** `https://<owner>.github.io/<repo>/`
**Demo (last season, Survivor 50):** add `?demo` to the address.

The site works in two modes:

| | Spreadsheet mode (now) | Supabase mode (later) |
|---|---|---|
| Where data lives | CSV files in `data/` | Supabase database |
| Who enters picks | Commissioner, in `players.csv` | Each player, after logging in |
| Who enters scores | Commissioner, in `events.csv` etc. | Commissioner, on an Admin page |
| Logins | None (the site is public, read-only) | Email + password |

---

## Running the pool in spreadsheet mode

Every file in `data/` can be edited right on GitHub: open the file, click the ✏️ pencil,
make the change, and click **Commit changes**. The site updates within a minute or two.
(You can also download a CSV, edit it in Excel, and upload it again. Keep the first row as is.)

Names don't need exact capitals or punctuation, but they must match a name (or alias) in
`castaways.csv`. If something doesn't match, a red **Spreadsheet check** box on the
Standings page says which line to fix.

### `players.csv`: one row per player
| column | what to put |
|---|---|
| `player` | Name as it should appear on the leaderboard. **Don't put email addresses here, because the repo is public.** |
| `paid` | `yes` once their $10 e-transfer arrives |
| `mvp` | Their MVP (must be one of their picks) |
| `pick1` … `pick8` | Four Toka and four Savu castaways, in any order |
| `merge_pick` | After the merge: their one bonus castaway |
| `swap_out` | Only when all 8 of their picks were still in at the merge: the castaway they drop |

### Each week after the episode
1. **`events.csv`**: add one row per point, exactly like the *Points* sheet in your Cast Points
   workbook: `episode,castaway,event`. That includes a `Survived the Week (Pre-Merge)` row (or
   `Post-Merge` after the merge) for everyone still in. The `event` text must match a row in
   `scoring.csv`, which uses the same category names as your workbook. You can copy the first
   three columns of your Points sheet straight in.
2. **`castaways.csv`**: put the episode number in `out_episode` for anyone voted out or who left.
3. **`episodes.csv`**: put `yes` in `published` for that episode. Nothing counts until you do,
   so you can enter everything first and publish when you're ready.

(If you'd rather the site add survival points and finale placings automatically, set
`Survival points` to `auto` in `settings.csv` and leave those rows out of `events.csv`.)

### At the merge
- In `settings.csv`, set `Merge episode` to the episode in which the tribes merged.
- In `episodes.csv`, put `yes` in `post_merge` for every episode **after** the merge.
- Fill in `merge_pick` / `swap_out` in `players.csv` as people send them in. The new pick
  scores from the episode after the merge. Swapped-out players keep the points they earned.

### Finale
Add the `First Place Winner`, `Second Place Winner` and `Third Place Winner` rows to `events.csv`,
and set `finish` to `1`, `2` or `3` in `castaways.csv`. The 30-point MVP bonus is added
automatically for everyone whose MVP finished first.

### `settings.csv`
Pool name, entry fee, e-transfer email, picks deadline, first scoring episode, picks per tribe,
max tribe size, merge episode, tribe colours, and an optional `Announcement` banner shown at the
top of the site.

---

## Setting up GitHub Pages (one time)
Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`** → Save.

## Switching to Supabase later (logins + self-serve picks)
1. Create a Supabase project. (The free plan allows two active projects.)
2. In the SQL editor, run `supabase/schema.sql` and then `supabase/seed.sql`. Edit the
   `admins` emails at the bottom of the seed first. Re-enter existing players on the Admin page.
3. **Authentication → Providers → Email**: turn **off** "Confirm email". Supabase's built-in
   mailer only sends a few emails an hour, which isn't enough for 25 sign-ups. Under
   **URL Configuration**, set the Site URL to the GitHub Pages address.
4. Put the project URL and publishable key in `config.js`. The site switches to Supabase mode automatically.

In Supabase mode, players see each other's picks only after the deadline. Picks lock at the
deadline, merge picks are only accepted while the commissioner has the merge window open, and
only admins can enter scores.

## Files
- `index.html`, `style.css`, `app.js`: the site
- `csv-data.js`: spreadsheet-mode loader and scorer
- `config.js`: Supabase settings (placeholder = spreadsheet mode)
- `data/`: the current season · `demo/`: Survivor 50, as a finished example
- `tools/import_xlsx.py`: converts Mark's season workbooks into these CSVs, leaving out emails and notes
- `supabase/`: database schema, security rules and seed data for Supabase mode
