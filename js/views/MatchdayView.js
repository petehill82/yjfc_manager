import { ref, reactive, computed, onMounted } from "vue";
import { listFixturesOnDate } from "../api/fixtures.js";
import { listPlayers } from "../api/players.js";
import { listAvailabilityForDate } from "../api/availability.js";
import { listAppearancesForFixture, upsertAppearance } from "../api/appearances.js";
import PlayerPicker from "../components/PlayerPicker.js";
import { playerDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";

export default {
  name: "MatchdayView",
  components: { PlayerPicker },
  props: { date: String },
  setup(props) {
    const fixtures = ref([]);
    const players = ref([]);
    const availability = ref({});
    const rowsByFixture = reactive({}); // fixture_id -> { player_id -> row }
    const saving = ref(false);
    const savedAt = ref("");

    const { error: loadError, run: load } = useLoader(async () => {
      fixtures.value = await listFixturesOnDate(props.date);
      players.value = await listPlayers({ activeOnly: true });

      const avail = await listAvailabilityForDate(props.date);
      const availMap = {};
      for (const a of avail) availMap[a.player_id] = a.status;
      availability.value = availMap;

      for (const f of fixtures.value) {
        const apps = await listAppearancesForFixture(f.id);
        const map = {};
        for (const a of apps) map[a.player_id] = a;
        rowsByFixture[f.id] = map;
      }
    });

    // Players selected on another of today's fixtures - shown as a helpful
    // "also playing for X" note (and a lighter name) on every fixture's list,
    // not just the ones they're ticked on, so a coach can see at a glance
    // who's already spoken for elsewhere. Playing twice is allowed - but not
    // at the same kick off time, so each entry also flags a real clash
    // (both fixtures have a kick off time set, and it's the same one).
    const otherMatchesByFixture = computed(() => {
      const label = (f) => f.team_name || f.opponent;
      const matchesByPlayer = {};
      for (const f of fixtures.value) {
        const rows = rowsByFixture[f.id] || {};
        for (const [pid, row] of Object.entries(rows)) {
          if (row.selected) (matchesByPlayer[pid] ||= []).push(f);
        }
      }
      const result = {};
      for (const f of fixtures.value) {
        const others = {};
        for (const p of players.value) {
          const rest = (matchesByPlayer[p.id] || []).filter((other) => other.id !== f.id);
          if (rest.length) {
            others[p.id] = rest.map((other) => ({
              label: label(other),
              kickoff: other.kickoff,
              conflict: !!(f.kickoff && other.kickoff && f.kickoff === other.kickoff),
            }));
          }
        }
        result[f.id] = others;
      }
      return result;
    });

    // Active-roster players not ticked as selected on any of today's fixtures -
    // the "did I miss anyone" check.
    const unselectedPlayers = computed(() => {
      return players.value.filter((p) => !fixtures.value.some((f) => (rowsByFixture[f.id] || {})[p.id]?.selected));
    });

    async function onChange(fixtureId, playerId, patch) {
      const current = rowsByFixture[fixtureId][playerId] || { fixture_id: fixtureId, player_id: playerId };
      const updated = { ...current, ...patch, fixture_id: fixtureId, player_id: playerId };
      rowsByFixture[fixtureId][playerId] = updated;
      saving.value = true;
      try {
        // `current` may carry the joined `players` object once a row has
        // been loaded from the DB (listAppearancesForFixture embeds it) -
        // strip it before upserting, since it isn't a real appearances column
        // and silently fails the whole write (Supabase upsert rejects it).
        const { players, ...row } = updated;
        await upsertAppearance(row);
        savedAt.value = new Date().toLocaleTimeString();
      } finally {
        saving.value = false;
      }
    }

    onMounted(load);
    return { fixtures, players, availability, rowsByFixture, otherMatchesByFixture, unselectedPlayers, playerDisplayName, saving, savedAt, onChange, loadError, load };
  },
  template: `
    <main class="container">
      <h2>Matchday: {{ date }}</h2>
      <p v-if="loadError" class="tag warn">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>
      <p style="font-size:0.85rem; opacity:0.7;">
        Changes save automatically. <span v-if="saving">Saving...</span>
        <span v-else-if="savedAt">Saved {{ savedAt }}</span>
      </p>
      <router-link :to="'/team-sheet-day/' + date"><button class="outline" style="width:auto;">Team sheet for the day</button></router-link>

      <article v-if="unselectedPlayers.length" style="border-top-color: var(--status-warn); margin-top:1rem;">
        <strong>{{ unselectedPlayers.length }} not selected for any fixture today</strong>
        <p style="margin:0.35rem 0 0;">{{ unselectedPlayers.map(playerDisplayName).join(', ') }}</p>
      </article>
      <p v-else-if="fixtures.length" style="opacity:0.7; margin-top:1rem;">Everyone in the squad is selected for at least one fixture today.</p>

      <div class="matchday-columns" style="margin-top:1rem;">
        <article v-for="f in fixtures" :key="f.id">
          <header><strong>{{ f.team_name || 'Team' }}</strong> vs {{ f.opponent }} <span class="tag">{{ f.home_away }}</span></header>
          <p v-if="f.kickoff" style="font-size:0.85rem; opacity:0.75; margin:0.25rem 0;">Kick off: {{ f.kickoff }}</p>
          <p v-if="(f.coaches || []).length" style="font-size:0.85rem; opacity:0.75; margin:0.25rem 0;">Coaches: {{ f.coaches.join(', ') }}</p>
          <PlayerPicker
            :players="players"
            :rows="rowsByFixture[f.id] || {}"
            :availability="availability"
            :other-matches="otherMatchesByFixture[f.id] || {}"
            @change="(pid, patch) => onChange(f.id, pid, patch)"
          />
        </article>
      </div>
      <p v-if="!fixtures.length">No fixtures scheduled on this date.</p>
    </main>
  `,
};
