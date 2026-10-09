import { supabase } from "../supabase.js";

// Clean sheets per player: the number of played games with no goals conceded
// that the player was selected for. A blank their_score on a played game
// counts as 0 - the live scorer only writes a score once a side scores.
export async function playerCleanSheets(seasonId) {
  const { data, error } = await supabase
    .from("appearances")
    .select("player_id, players(first_name, last_name, display_name), fixtures!inner(season_id, status, their_score)")
    .eq("selected", true)
    .eq("fixtures.season_id", seasonId)
    .eq("fixtures.status", "played");
  if (error) throw error;
  const byPlayer = {};
  for (const a of data) {
    if ((a.fixtures.their_score ?? 0) !== 0) continue;
    (byPlayer[a.player_id] ||= { ...a.players, player_id: a.player_id, clean_sheets: 0 }).clean_sheets += 1;
  }
  return Object.values(byPlayer);
}
