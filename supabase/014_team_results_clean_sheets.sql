-- Adds clean_sheets (played games where we conceded nothing) to v_team_results.
--
-- Also stops excluding played games where a side's score is NULL: the live
-- scorer only writes a side's score when that side scores, so a 3-0 win has
-- their_score = NULL and was silently dropped from every team total. A
-- played game with no recorded score for a side now counts as 0 for that side.
-- New column goes last, as `create or replace view` requires.
create or replace view v_team_results as
select
  f.season_id,
  coalesce(f.team_name, '') as team_name,
  count(*) as played,
  count(*) filter (where coalesce(f.our_score, 0) > coalesce(f.their_score, 0)) as wins,
  count(*) filter (where coalesce(f.our_score, 0) = coalesce(f.their_score, 0)) as draws,
  count(*) filter (where coalesce(f.our_score, 0) < coalesce(f.their_score, 0)) as losses,
  coalesce(sum(coalesce(f.our_score, 0)), 0) as goals_for,
  coalesce(sum(coalesce(f.their_score, 0)), 0) as goals_against,
  count(*) filter (where f.home_away = 'home') as played_home,
  count(*) filter (where f.home_away = 'home' and coalesce(f.our_score, 0) > coalesce(f.their_score, 0)) as wins_home,
  count(*) filter (where f.home_away = 'home' and coalesce(f.our_score, 0) = coalesce(f.their_score, 0)) as draws_home,
  count(*) filter (where f.home_away = 'home' and coalesce(f.our_score, 0) < coalesce(f.their_score, 0)) as losses_home,
  coalesce(sum(coalesce(f.our_score, 0)) filter (where f.home_away = 'home'), 0) as goals_for_home,
  coalesce(sum(coalesce(f.their_score, 0)) filter (where f.home_away = 'home'), 0) as goals_against_home,
  count(*) filter (where f.home_away = 'away') as played_away,
  count(*) filter (where f.home_away = 'away' and coalesce(f.our_score, 0) > coalesce(f.their_score, 0)) as wins_away,
  count(*) filter (where f.home_away = 'away' and coalesce(f.our_score, 0) = coalesce(f.their_score, 0)) as draws_away,
  count(*) filter (where f.home_away = 'away' and coalesce(f.our_score, 0) < coalesce(f.their_score, 0)) as losses_away,
  coalesce(sum(coalesce(f.our_score, 0)) filter (where f.home_away = 'away'), 0) as goals_for_away,
  coalesce(sum(coalesce(f.their_score, 0)) filter (where f.home_away = 'away'), 0) as goals_against_away,
  count(*) filter (where coalesce(f.their_score, 0) = 0) as clean_sheets
from fixtures f
where f.status = 'played'
group by f.season_id, f.team_name;
