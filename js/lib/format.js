// Postgres returns "time" columns as "HH:MM:SS" - trim to "HH:MM" for display.
export function formatTime(t) {
  return t ? t.slice(0, 5) : "";
}

// A coach's profile row often has nothing but full_name set to their raw
// invite email (the Supabase dashboard invite flow doesn't ask for a name).
// Prefer an explicit display name, then first+last, then fall back to
// whatever full_name holds.
export function coachDisplayName(p) {
  if (!p) return "";
  return p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || "";
}

// Same idea for players: prefer an explicit display name (nickname, shortened
// name) over first+last, everywhere a player's name is shown.
export function playerDisplayName(p) {
  if (!p) return "";
  return p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
}

// Highest ability first (unrated players sort last), then alphabetically by
// displayed name. The number itself is never shown in the UI, only used for
// ordering.
export function byAbilityThenName(a, b) {
  const abilA = a.ability ?? -1;
  const abilB = b.ability ?? -1;
  if (abilB !== abilA) return abilB - abilA;
  return playerDisplayName(a).toLowerCase().localeCompare(playerDisplayName(b).toLowerCase());
}
