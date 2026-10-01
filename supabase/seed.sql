-- =====================================================================
-- Survivor 51 seed data (Global TV Fantasy Tribe rules)
-- =====================================================================

insert into public.settings (id, pool_name, season, entry_fee, etransfer_email, commissioner_name,
                             picks_deadline, first_scoring_episode, picks_per_tribe, max_tribe_size)
values (1, 'Survivor 51 Fantasy Pool', 51, 0, null, 'Mark Irwin',
        '2026-09-30 20:00:00-04', 2, 4, 6)
on conflict (id) do nothing;

insert into public.tribes (name, color, sort) values
  ('Toka', '#E8B820', 1),
  ('Savu', '#7B4BB7', 2)
on conflict (name) do nothing;

insert into public.castaways (name, tribe, sort) values
  ('An "Thien An"', 'Toka', 1), ('Brady', 'Toka', 2), ('Danny', 'Toka', 3), ('Devin', 'Toka', 4),
  ('Jelly', 'Toka', 5), ('Jenna', 'Toka', 6), ('Lewis', 'Toka', 7), ('Maggie', 'Toka', 8),
  ('Mike', 'Toka', 9), ('Patt', 'Toka', 10),
  ('Alexis', 'Savu', 1), ('Ana', 'Savu', 2), ('Carter', 'Savu', 3), ('Cristian', 'Savu', 4),
  ('Eric', 'Savu', 5), ('Kristin', 'Savu', 6), ('Linnea', 'Savu', 7), ('Ori', 'Savu', 8),
  ('Rob', 'Savu', 9), ('Sharonda', 'Savu', 10)
on conflict (name) do nothing;

-- Episodes air Wednesdays at 8 PM; points start with episode 2 (Sept 30)
insert into public.episodes (number, air_date)
select n, date '2026-09-23' + (n - 1) * 7 from generate_series(1, 13) n
on conflict (number) do nothing;

insert into public.categories (label, points, sort) values
  -- 5 points
  ('Wins a group Immunity Challenge', 5, 101),
  ('Wins a group Reward Challenge', 5, 102),
  ('Gets chosen to go on reward', 5, 103),
  ('Finds or gets a game advantage', 5, 104),
  ('Plays a hidden immunity idol on themselves at Tribal', 5, 105),
  ('Uses a game advantage at Tribal Council', 5, 106),
  ('Visually cries with tears on camera', 5, 107),
  ('Says a curse word that is bleeped', 5, 108),
  ('Says "I miss…"', 5, 109),
  ('Kisses another player still in the game', 5, 110),
  ('Heated argument / shouts at another player', 5, 111),
  ('Wardrobe malfunction / blurred nudity', 5, 112),
  ('Chooses to risk their vote', 5, 113),
  ('Finds a fake immunity idol', 5, 114),
  ('Hugs Jeff', 5, 115),
  ('Buys something with fire tokens', 5, 116),
  -- 10 points
  ('Wins an individual Reward Challenge', 10, 201),
  ('Finds a hidden immunity idol', 10, 202),
  ('Voted out holding an idol or advantage', 10, 203),
  ('Plays their Shot in the Dark', 10, 204),
  ('Torch snuffed in a blindside', 10, 205),
  ('Treated for a medical emergency', 10, 206),
  ('Chooses to forfeit the game', 10, 207),
  ('Catches seafood or wildlife', 10, 208),
  ('Tampers with or steals tribe food', 10, 209),
  ('Plays a fake immunity idol at Tribal', 10, 210),
  ('Searches through someone else''s bag', 10, 211),
  ('Voted out unanimously', 10, 212),
  ('Idol played on them by another player', 10, 213),
  ('Chosen to flip the million-dollar coin', 10, 214),
  ('Sent on a journey or to Exile Island', 10, 215),
  -- 15 points
  ('Wins an individual Immunity Challenge', 15, 301),
  ('Draws a SAFE scroll from Shot in the Dark', 15, 302),
  ('Wins a fire-making challenge', 15, 303),
  ('Gives away / plays an idol for another player', 15, 304),
  ('Creates a fake immunity idol', 15, 305),
  ('Gets another player to play their fake idol', 15, 306),
  ('Forced to leave the game (not voted out)', 15, 307),
  ('Returns to the game after elimination', 15, 308),
  ('Flips the million-dollar coin and survives', 15, 309)
on conflict (label) do nothing;

-- The commissioners. Add more with:  insert into public.admins values ('someone@example.com');
insert into public.admins (email) values ('markrirwin@hotmail.com'), ('leighjb@gmail.com')
on conflict do nothing;
