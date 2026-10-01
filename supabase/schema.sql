-- =====================================================================
-- Survivor Fantasy Pool — Supabase schema
-- Scoring follows the Global TV "Survivor 51 Fantasy Tribe" rules.
-- Run once in the Supabase SQL editor (or via a migration).
-- =====================================================================

-- ---------- Core tables ----------------------------------------------

create table if not exists public.settings (
  id                    int primary key default 1 check (id = 1),
  pool_name             text        not null default 'Survivor Fantasy Pool',
  season                int         not null default 51,
  entry_fee             numeric     not null default 10,
  etransfer_email       text,
  commissioner_name     text,
  picks_deadline        timestamptz not null,
  first_scoring_episode int         not null default 2,
  picks_per_tribe       int         not null default 4,
  max_tribe_size        int         not null default 6,
  merge_episode         int,                      -- last episode BEFORE merge picks start counting
  merge_window_open     boolean     not null default false,
  announcement          text
);

create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

create table if not exists public.tribes (
  name  text primary key,
  color text not null default '#888888',
  sort  int  not null default 0
);

create table if not exists public.castaways (
  id                 serial primary key,
  name               text not null unique,
  tribe              text not null references public.tribes(name) on update cascade,
  eliminated_episode int,                         -- episode they left the game (null = still in)
  finish_place       int check (finish_place between 1 and 3), -- 1 = Sole Survivor
  sort               int not null default 0
);

create table if not exists public.episodes (
  number         int primary key,
  air_date       date,
  title          text,
  is_post_merge  boolean not null default false,  -- survival worth 3 pts instead of 1
  is_scored      boolean not null default false   -- published: counts toward standings
);

create table if not exists public.categories (
  id     serial primary key,
  label  text not null unique,
  points int  not null,
  sort   int  not null default 0
);

-- One row = "castaway did <category> in <episode>" (max once per category per week)
create table if not exists public.events (
  episode     int not null references public.episodes(number) on delete cascade,
  castaway_id int not null references public.castaways(id)    on delete cascade,
  category_id int not null references public.categories(id)   on delete cascade,
  primary key (episode, castaway_id, category_id)
);

-- A player's entry in the pool (matched to their login by email)
create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique check (email = lower(email)),
  display_name text not null,
  paid         boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.picks (
  id            serial primary key,
  entry_id      uuid not null references public.entries(id) on delete cascade,
  castaway_id   int  not null references public.castaways(id) on delete cascade,
  is_mvp        boolean not null default false,
  kind          text not null default 'original' check (kind in ('original','merge')),
  start_episode int  not null,          -- first episode this pick scores
  end_episode   int,                    -- last episode it scores (null = still on tribe)
  created_at    timestamptz not null default now(),
  unique (entry_id, castaway_id)
);
create index if not exists picks_entry_idx on public.picks(entry_id);
create unique index if not exists one_mvp_per_entry on public.picks(entry_id) where is_mvp;

-- ---------- Helpers ---------------------------------------------------

create or replace function public.jwt_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.email = public.jwt_email())
$$;

create or replace function public.picks_locked() returns boolean
language sql stable security definer set search_path = public as $$
  select now() >= (select picks_deadline from public.settings where id = 1)
$$;

-- ---------- Scoring ---------------------------------------------------

-- Points each castaway earned in each published episode
create or replace function public.castaway_episode_points()
returns table (castaway_id int, episode int, survival int, bonus int, points int)
language sql stable security definer set search_path = public as $$
  with s as (select first_scoring_episode f from public.settings where id = 1)
  select c.id,
         e.number,
         case when c.eliminated_episode is null or c.eliminated_episode > e.number
              then case when e.is_post_merge then 3 else 1 end
              else 0 end as survival,
         coalesce((select sum(cat.points)::int
                     from public.events ev join public.categories cat on cat.id = ev.category_id
                    where ev.castaway_id = c.id and ev.episode = e.number), 0) as bonus,
         0
    from public.castaways c
    cross join public.episodes e
    cross join s
   where e.is_scored
     and e.number >= s.f
     and (c.eliminated_episode is null or c.eliminated_episode >= e.number)
$$;

-- Per-pick totals (weekly points while the pick is on the tribe + finale bonuses)
create or replace function public._pick_scores()
returns table (entry_id uuid, castaway_id int, weekly int, finale int, mvp_bonus int)
language sql stable security definer set search_path = public as $$
  with cep as (select castaway_id, episode, survival + bonus as pts from public.castaway_episode_points())
  select p.entry_id,
         p.castaway_id,
         coalesce((select sum(cep.pts)::int from cep
                    where cep.castaway_id = p.castaway_id
                      and cep.episode >= p.start_episode
                      and (p.end_episode is null or cep.episode <= p.end_episode)), 0),
         case when p.end_episode is null then
              case c.finish_place when 1 then 30 when 2 then 20 when 3 then 10 else 0 end
              else 0 end,
         case when p.is_mvp and c.finish_place = 1 then 30 else 0 end
    from public.picks p join public.castaways c on c.id = p.castaway_id
$$;

create or replace function public.leaderboard()
returns table (entry_id uuid, display_name text, paid boolean, total int,
               last_episode int, last_episode_points int, still_in int, mvp text)
language sql stable security definer set search_path = public as $$
  with last_ep as (select max(number) n from public.episodes where is_scored),
       cep as (select castaway_id, episode, survival + bonus pts from public.castaway_episode_points())
  select en.id,
         en.display_name,
         en.paid,
         coalesce((select sum(weekly + finale + mvp_bonus)::int from public._pick_scores() ps where ps.entry_id = en.id), 0),
         (select n from last_ep),
         coalesce((select sum(cep.pts)::int
                     from public.picks p join cep on cep.castaway_id = p.castaway_id
                    where p.entry_id = en.id
                      and cep.episode = (select n from last_ep)
                      and cep.episode >= p.start_episode
                      and (p.end_episode is null or cep.episode <= p.end_episode)), 0),
         (select count(*)::int from public.picks p join public.castaways c on c.id = p.castaway_id
           where p.entry_id = en.id and p.end_episode is null and c.eliminated_episode is null),
         (select c.name from public.picks p join public.castaways c on c.id = p.castaway_id
           where p.entry_id = en.id and p.is_mvp)
    from public.entries en
   where auth.role() = 'authenticated'
     and exists (select 1 from public.picks p where p.entry_id = en.id)
   order by 4 desc, 2
$$;

-- Weekly points per entry (for the week-by-week grid)
create or replace function public.entry_weekly_points()
returns table (entry_id uuid, episode int, points int)
language sql stable security definer set search_path = public as $$
  with cep as (select castaway_id, episode, survival + bonus pts from public.castaway_episode_points())
  select p.entry_id, cep.episode, sum(cep.pts)::int
    from public.picks p join cep on cep.castaway_id = p.castaway_id
   where cep.episode >= p.start_episode
     and (p.end_episode is null or cep.episode <= p.end_episode)
     and auth.role() = 'authenticated'
   group by 1, 2
$$;

-- Everyone's picks with points (hidden from other players until the deadline)
create or replace function public.all_picks()
returns table (entry_id uuid, display_name text, castaway_id int, castaway text, tribe text,
               is_mvp boolean, kind text, start_episode int, end_episode int,
               eliminated_episode int, points int)
language sql stable security definer set search_path = public as $$
  select en.id, en.display_name, c.id, c.name, c.tribe, p.is_mvp, p.kind,
         p.start_episode, p.end_episode, c.eliminated_episode,
         ps.weekly + ps.finale + ps.mvp_bonus
    from public.picks p
    join public.entries en  on en.id = p.entry_id
    join public.castaways c on c.id = p.castaway_id
    join public._pick_scores() ps on ps.entry_id = p.entry_id and ps.castaway_id = p.castaway_id
   where auth.role() = 'authenticated'
     and (public.picks_locked() or public.is_admin() or en.email = public.jwt_email())
   order by en.display_name, p.kind, c.tribe, c.name
$$;

-- ---------- Player actions -------------------------------------------

create or replace function public.my_entry()
returns setof public.entries
language sql stable security definer set search_path = public as $$
  select * from public.entries where email = public.jwt_email() and public.jwt_email() <> ''
$$;

-- internal: validate and store original picks for an entry
create or replace function public._set_picks(p_entry uuid, p_castaways int[], p_mvp int)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.settings;
  t record;
  n int;
begin
  select * into s from public.settings where id = 1;
  if p_castaways is null or array_length(p_castaways, 1) is null then
    raise exception 'Pick your castaways first.';
  end if;
  if (select count(distinct x) from unnest(p_castaways) x) <> array_length(p_castaways, 1) then
    raise exception 'Each castaway can only be picked once.';
  end if;
  if (select count(*) from public.castaways where id = any(p_castaways)) <> array_length(p_castaways, 1) then
    raise exception 'Unknown castaway in picks.';
  end if;
  for t in select name from public.tribes loop
    select count(*) into n from public.castaways where id = any(p_castaways) and tribe = t.name;
    if n <> s.picks_per_tribe then
      raise exception 'Pick exactly % castaways from %. You picked %.', s.picks_per_tribe, t.name, n;
    end if;
  end loop;
  if p_mvp is null or not (p_mvp = any(p_castaways)) then
    raise exception 'Your MVP must be one of your picks.';
  end if;
  if exists (select 1 from public.picks where entry_id = p_entry and kind = 'merge') then
    raise exception 'Merge picks already made; original picks can no longer change.';
  end if;

  delete from public.picks where entry_id = p_entry;
  insert into public.picks (entry_id, castaway_id, is_mvp, kind, start_episode)
  select p_entry, x, x = p_mvp, 'original', s.first_scoring_episode from unnest(p_castaways) x;
end $$;

create or replace function public.submit_picks(p_display_name text, p_castaways int[], p_mvp int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.jwt_email();
  v_entry uuid;
begin
  if v_email = '' then raise exception 'Please sign in first.'; end if;
  if public.picks_locked() and not public.is_admin() then
    raise exception 'Picks are locked — the deadline has passed. Contact the commissioner.';
  end if;
  if coalesce(trim(p_display_name), '') = '' then raise exception 'Enter a display name.'; end if;

  insert into public.entries (email, display_name) values (v_email, trim(p_display_name))
  on conflict (email) do update set display_name = excluded.display_name
  returning id into v_entry;

  perform public._set_picks(v_entry, p_castaways, p_mvp);
  return v_entry;
end $$;

create or replace function public.set_display_name(p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_display_name), '') = '' then raise exception 'Enter a display name.'; end if;
  update public.entries set display_name = trim(p_display_name) where email = public.jwt_email();
end $$;

-- Merge bonus: add one castaway (if you've lost players) or swap one (if all are still in).
-- Calling again while the window is open replaces your previous choice.
create or replace function public._merge_move(p_entry uuid, p_add int, p_drop int)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.settings;
  alive int;
begin
  select * into s from public.settings where id = 1;
  if s.merge_episode is null then raise exception 'The merge has not been set yet.'; end if;

  -- undo any previous merge move
  delete from public.picks where entry_id = p_entry and kind = 'merge';
  update public.picks set end_episode = null
   where entry_id = p_entry and kind = 'original' and end_episode = s.merge_episode;

  if p_add is null then return; end if;  -- just clearing

  if exists (select 1 from public.picks where entry_id = p_entry and castaway_id = p_add) then
    raise exception 'That castaway is already on your tribe.';
  end if;
  if exists (select 1 from public.castaways where id = p_add and eliminated_episode is not null) then
    raise exception 'That castaway is out of the game.';
  end if;

  select count(*) into alive
    from public.picks p join public.castaways c on c.id = p.castaway_id
   where p.entry_id = p_entry and c.eliminated_episode is null;

  if alive >= s.max_tribe_size then
    if p_drop is null then
      raise exception 'All % of your picks are still in — choose one to swap out.', s.max_tribe_size;
    end if;
    update public.picks set end_episode = s.merge_episode
     where entry_id = p_entry and castaway_id = p_drop and kind = 'original';
    if not found then raise exception 'The castaway to swap out is not on your tribe.'; end if;
  elsif p_drop is not null then
    raise exception 'You have room on your tribe — no swap needed.';
  end if;

  insert into public.picks (entry_id, castaway_id, is_mvp, kind, start_episode)
  values (p_entry, p_add, false, 'merge', s.merge_episode + 1);
end $$;

create or replace function public.submit_merge_pick(p_add int, p_drop int default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  if not (select merge_window_open from public.settings where id = 1) and not public.is_admin() then
    raise exception 'The merge pick window is not open.';
  end if;
  select id into v_entry from public.entries where email = public.jwt_email();
  if v_entry is null then raise exception 'You don''t have an entry in this pool.'; end if;
  perform public._merge_move(v_entry, p_add, p_drop);
end $$;

-- ---------- Admin actions --------------------------------------------

create or replace function public.admin_set_picks(p_email text, p_display_name text, p_castaways int[], p_mvp int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  insert into public.entries (email, display_name) values (lower(trim(p_email)), trim(p_display_name))
  on conflict (email) do update set display_name = excluded.display_name
  returning id into v_entry;
  perform public._set_picks(v_entry, p_castaways, p_mvp);
  return v_entry;
end $$;

create or replace function public.admin_merge_pick(p_entry uuid, p_add int, p_drop int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  perform public._merge_move(p_entry, p_add, p_drop);
end $$;

-- ---------- Row level security ---------------------------------------

alter table public.settings   enable row level security;
alter table public.admins     enable row level security;
alter table public.tribes     enable row level security;
alter table public.castaways  enable row level security;
alter table public.episodes   enable row level security;
alter table public.categories enable row level security;
alter table public.events     enable row level security;
alter table public.entries    enable row level security;
alter table public.picks      enable row level security;

-- reference data: any signed-in user can read; admins can change
do $$
declare t text;
begin
  foreach t in array array['settings','tribes','castaways','episodes','categories'] loop
    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format('create policy "read %1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "admin write %1$s" on public.%1$I', t);
    execute format('create policy "admin write %1$s" on public.%1$I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

drop policy if exists "read events" on public.events;
create policy "read events" on public.events for select to authenticated
  using (exists (select 1 from public.episodes e where e.number = episode and e.is_scored) or (select public.is_admin()));
drop policy if exists "admin write events" on public.events;
create policy "admin write events" on public.events for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "admins read admins" on public.admins;
create policy "admins read admins" on public.admins for select to authenticated using ((select public.is_admin()));
drop policy if exists "admins write admins" on public.admins;
create policy "admins write admins" on public.admins for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "own or admin entries" on public.entries;
create policy "own or admin entries" on public.entries for select to authenticated
  using (email = (select public.jwt_email()) or (select public.is_admin()));
drop policy if exists "admin write entries" on public.entries;
create policy "admin write entries" on public.entries for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read picks" on public.picks;
create policy "read picks" on public.picks for select to authenticated
  using ((select public.picks_locked()) or (select public.is_admin())
         or entry_id in (select id from public.entries where email = (select public.jwt_email())));
drop policy if exists "admin write picks" on public.picks;
create policy "admin write picks" on public.picks for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Only signed-in users may call the functions
do $$
declare f text;
begin
  foreach f in array array[
    'castaway_episode_points()', '_pick_scores()', 'leaderboard()', 'entry_weekly_points()', 'all_picks()',
    'my_entry()', '_set_picks(uuid,int[],int)', 'submit_picks(text,int[],int)', 'set_display_name(text)',
    '_merge_move(uuid,int,int)', 'submit_merge_pick(int,int)', 'admin_set_picks(text,text,int[],int)',
    'admin_merge_pick(uuid,int,int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helpers are not callable from the website at all
  revoke execute on function public._set_picks(uuid,int[],int) from authenticated;
  revoke execute on function public._merge_move(uuid,int,int) from authenticated;
end $$;
