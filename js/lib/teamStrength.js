// Coach-only note on a fixture's squad strength (e.g. for split-team
// matchdays). Shown in fixture management, the matchday picker and the day
// sheet screen - but deliberately left out of anything that gets shared or
// printed (see the "no-print capture-exclude" usage wherever it's rendered).
export const STRENGTH_LABELS = { stronger: "Stronger", development: "Development", mixed: "Mixed" };

export function strengthLabel(v) {
  return STRENGTH_LABELS[v] || "";
}
