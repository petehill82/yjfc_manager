-- Coach-only note on a fixture's squad strength (e.g. for split-team
-- matchdays). Deliberately not exposed on v_fixture_results or anywhere
-- else results/team sheets get shared from - internal use only.
alter table fixtures
  add column if not exists team_strength text
    check (team_strength is null or team_strength in ('stronger', 'development', 'mixed'));
