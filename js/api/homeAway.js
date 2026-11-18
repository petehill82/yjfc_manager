import { supabase } from "../supabase.js";

// Matches played per player, split home/away: selected appearances in played
// fixtures only, so games merely picked for in advance (future, postponed or
// cancelled) don't count.
export async function playerHomeAway(seasonId) {
  const { data, error } = await supabase
    .from("appearances")
    .select("player_id, players(first_name, last_name, display_name), fixtures!inner(season_id, status, home_away)")
    .eq("selected", true)
    .eq("fixtures.season_id", seasonId)
    .eq("fixtures.status", "played");
  if (error) throw error;
  const byPlayer = {};
  for (const a of data) {
    const p = (byPlayer[a.player_id] ||= { ...a.players, player_id: a.player_id, home: 0, away: 0 });
    if (a.fixtures.home_away === "home") p.home += 1;
    else p.away += 1;
  }
  return Object.values(byPlayer);
}
