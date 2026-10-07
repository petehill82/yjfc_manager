import { ref, watch, onMounted } from "vue";
import { store, currentSeason } from "../store.js";
import { listResults } from "../api/results.js";
import { listAppearancesForFixture } from "../api/appearances.js";
import { playerDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";

function outcome(r) {
  const us = r.our_score ?? 0;
  const them = r.their_score ?? 0;
  if (us > them) return "W";
  if (us < them) return "L";
  return "D";
}

export default {
  name: "ResultsView",
  setup() {
    const results = ref([]);

    const { error: loadError, run: load } = useLoader(async () => {
      const seasonId = store.currentSeasonId;
      if (!seasonId) return;
      results.value = await listResults(seasonId);
    });

    watch(() => store.currentSeasonId, load);
    onMounted(load);

    // Tap a result card to expand its scorers/assists inline, fetched lazily
    // (only the appearances for that one fixture) and cached so re-tapping
    // an already-viewed match doesn't re-fetch.
    const expandedId = ref(null);
    const detailsByFixture = ref({});
    const detailsLoading = ref(null);
    const detailsError = ref("");

    async function toggleDetails(fixtureId) {
      if (expandedId.value === fixtureId) { expandedId.value = null; return; }
      expandedId.value = fixtureId;
      if (detailsByFixture.value[fixtureId]) return;
      detailsLoading.value = fixtureId;
      detailsError.value = "";
      try {
        const apps = await listAppearancesForFixture(fixtureId);
        detailsByFixture.value[fixtureId] = apps.filter((a) => a.selected);
      } catch (e) {
        detailsError.value = "Couldn't load match details.";
      } finally {
        detailsLoading.value = null;
      }
    }

    function scorersFor(fixtureId) {
      return (detailsByFixture.value[fixtureId] || [])
        .filter((a) => a.goals > 0)
        .map((a) => playerDisplayName(a.players) + (a.goals > 1 ? ` x${a.goals}` : ""));
    }
    function assistsFor(fixtureId) {
      return (detailsByFixture.value[fixtureId] || [])
        .filter((a) => a.assists > 0)
        .map((a) => playerDisplayName(a.players) + (a.assists > 1 ? ` x${a.assists}` : ""));
    }

    return {
      results, store, currentSeason, outcome, playerDisplayName, loadError, load,
      expandedId, detailsLoading, detailsError, toggleDetails, scorersFor, assistsFor,
    };
  },
  template: `
    <main class="container">
      <h2>Results</h2>
      <p v-if="loadError" class="tag warn">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>
      <label v-if="store.seasons.length > 1">Season
        <select v-model="store.currentSeasonId">
          <option v-for="s in store.seasons" :key="s.id" :value="s.id">{{ s.name }} - {{ s.squad_name }}</option>
        </select>
      </label>

      <div style="overflow-x:auto; margin-top:1rem;">
        <table class="results-table">
          <thead>
            <tr>
              <th class="col-date">Date</th>
              <th class="col-opponent">Opponent</th>
              <th class="col-score">Score</th>
              <th class="col-potm">POTM</th>
              <th class="col-result">Result</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in results" :key="r.fixture_id">
              <tr class="results-row" :class="{ expanded: expandedId === r.fixture_id }" @click="toggleDetails(r.fixture_id)">
                <td class="col-date">{{ r.match_date }}</td>
                <td class="col-opponent">
                  {{ r.home_away === 'home' ? '' : '@ ' }}{{ r.opponent }}
                  <small v-if="r.team_name">({{ r.team_name }})</small>
                </td>
                <td class="col-score"><span class="scoreline compact">{{ r.our_score ?? 0 }}<span class="vs">&ndash;</span>{{ r.their_score ?? 0 }}</span></td>
                <td class="col-potm">
                  <router-link v-if="r.potm_player_id" :to="'/players/' + r.potm_player_id" @click.stop>
                    {{ playerDisplayName({ first_name: r.potm_first_name, last_name: r.potm_last_name, display_name: r.potm_display_name }) }}
                  </router-link>
                  <span v-else>&ndash;</span>
                </td>
                <td class="col-result">
                  <span v-if="outcome(r) === 'W'" class="tag ok">W</span>
                  <span v-else-if="outcome(r) === 'L'" class="tag warn">L</span>
                  <span v-else class="tag">D</span>
                </td>
              </tr>
              <tr v-if="expandedId === r.fixture_id" class="results-detail-row">
                <td colspan="5">
                  <p v-if="detailsLoading === r.fixture_id" aria-busy="true">Loading...</p>
                  <p v-else-if="detailsError" class="tag warn">{{ detailsError }}</p>
                  <template v-else>
                    <p v-if="scorersFor(r.fixture_id).length" style="margin:0.25rem 0; font-size:0.9rem;"><strong>&#9917; Scorers:</strong> {{ scorersFor(r.fixture_id).join(', ') }}</p>
                    <p v-if="assistsFor(r.fixture_id).length" style="margin:0.25rem 0; font-size:0.9rem;"><strong>&#127939; Assists:</strong> {{ assistsFor(r.fixture_id).join(', ') }}</p>
                    <p v-if="!scorersFor(r.fixture_id).length && !assistsFor(r.fixture_id).length" style="opacity:0.7; margin:0.25rem 0; font-size:0.9rem;">
                      No goals or assists recorded for this match.
                    </p>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="!results.length">No results recorded yet this season.</p>
    </main>
  `,
};
