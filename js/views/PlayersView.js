import { ref, computed, watch, onMounted } from "vue";
import { listPlayers, createPlayer, setPlayerActive } from "../api/players.js";
import { playerSeasonStats } from "../api/stats.js";
import { playerCleanSheets } from "../api/cleanSheets.js";
import { store, isAdmin, currentSeason } from "../store.js";
import { playerDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";
import { POSITIONS } from "../lib/positions.js";

const BLANK_PLAYER = { first_name: "", last_name: "", display_name: "", squad_number: null, ability: null, year_of_birth: null, preferred_positions: [] };
const BLANK_STATS = { apps: 0, goals: 0, assists: 0, potm_count: 0, clean_sheets: 0 };

export default {
  name: "PlayersView",
  setup() {
    const players = ref([]);
    const statsByPlayer = ref({});
    const search = ref("");
    const showArchived = ref(false);
    const showAdd = ref(false);
    const newPlayer = ref({ ...BLANK_PLAYER });
    const error = ref("");

    const { error: loadError, run: load } = useLoader(async () => {
      players.value = await listPlayers({ activeOnly: !showArchived.value });
      if (store.currentSeasonId) {
        const stats = await playerSeasonStats(store.currentSeasonId);
        const cleanSheets = Object.fromEntries((await playerCleanSheets(store.currentSeasonId)).map((c) => [c.player_id, c.clean_sheets]));
        statsByPlayer.value = Object.fromEntries(stats.map((s) => [s.player_id, { ...s, clean_sheets: cleanSheets[s.player_id] || 0 }]));
      } else {
        statsByPlayer.value = {};
      }
    });

    function statsFor(pid) {
      return statsByPlayer.value[pid] || BLANK_STATS;
    }

    // Click a column header to sort by it; click again to reverse.
    const sortKey = ref("squad_number");
    const sortDir = ref(1);

    function sortBy(key) {
      if (sortKey.value === key) sortDir.value = -sortDir.value;
      else { sortKey.value = key; sortDir.value = 1; }
    }

    function sortIndicator(key) {
      if (sortKey.value !== key) return "";
      return sortDir.value === 1 ? " ▲" : " ▼";
    }

    function sortValue(p, key) {
      if (key === "name") return playerDisplayName(p).toLowerCase();
      if (key === "squad_number") return p.squad_number ?? Infinity;
      return statsFor(p.id)[key] ?? 0;
    }

    const filtered = computed(() => {
      const q = search.value.trim().toLowerCase();
      let list = players.value;
      if (q) {
        list = list.filter((p) =>
          `${p.first_name} ${p.last_name} ${p.display_name ?? ""} ${p.squad_number ?? ""}`.toLowerCase().includes(q)
        );
      }
      return [...list].sort((a, b) => {
        const av = sortValue(a, sortKey.value);
        const bv = sortValue(b, sortKey.value);
        if (av < bv) return -sortDir.value;
        if (av > bv) return sortDir.value;
        return 0;
      });
    });

    async function addPlayer() {
      error.value = "";
      try {
        const payload = {
          ...newPlayer.value,
          squad_number: newPlayer.value.squad_number ? Number(newPlayer.value.squad_number) : null,
          ability: newPlayer.value.ability ? Number(newPlayer.value.ability) : null,
          year_of_birth: newPlayer.value.year_of_birth ? Number(newPlayer.value.year_of_birth) : null,
        };
        await createPlayer(payload);
        newPlayer.value = { ...BLANK_PLAYER };
        showAdd.value = false;
        await load();
      } catch (e) {
        error.value = e.message;
      }
    }

    async function toggleArchive(p) {
      await setPlayerActive(p.id, !p.active);
      await load();
    }

    watch(() => store.currentSeasonId, load);
    onMounted(load);
    return {
      players, filtered, search, showArchived, showAdd, newPlayer, error, loadError, isAdmin, POSITIONS,
      playerDisplayName, statsFor, sortBy, sortIndicator, store, currentSeason, addPlayer, toggleArchive, load,
    };
  },
  template: `
    <main class="container">
      <h2>Squad</h2>
      <p v-if="loadError" class="tag warn">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>
      <label v-if="store.seasons.length > 1">Season
        <select v-model="store.currentSeasonId">
          <option v-for="s in store.seasons" :key="s.id" :value="s.id">{{ s.name }} - {{ s.squad_name }}</option>
        </select>
      </label>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <input v-model="search" placeholder="Search name or number" style="flex:1; min-width:180px;" />
        <label style="display:flex; align-items:center; gap:0.3rem; white-space:nowrap;">
          <input type="checkbox" v-model="showArchived" @change="load" /> Show archived
        </label>
        <button v-if="isAdmin()" @click="showAdd = !showAdd">{{ showAdd ? 'Cancel' : '+ Add player' }}</button>
      </div>

      <article v-if="showAdd">
        <form @submit.prevent="addPlayer">
          <div class="stat-grid">
            <input v-model="newPlayer.first_name" placeholder="First name" required />
            <input v-model="newPlayer.last_name" placeholder="Last name" required />
            <input v-model="newPlayer.display_name" placeholder="Display name (optional)" />
            <input v-model="newPlayer.squad_number" type="number" placeholder="Squad no." />
            <input v-model="newPlayer.ability" type="number" min="1" max="10" placeholder="Ability (1-10)" />
            <input v-model="newPlayer.year_of_birth" type="number" placeholder="Year of birth" />
            <select v-model="newPlayer.preferred_positions" multiple size="5" title="Positions (ctrl/cmd-click for multiple)">
              <option v-for="pos in POSITIONS" :key="pos" :value="pos">{{ pos }}</option>
            </select>
          </div>
          <p v-if="error" style="color:#b91c1c;">{{ error }}</p>
          <button type="submit">Save player</button>
        </form>
      </article>

      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th style="cursor:pointer;" @click="sortBy('squad_number')">#{{ sortIndicator('squad_number') }}</th>
              <th style="cursor:pointer;" @click="sortBy('name')">Player{{ sortIndicator('name') }}</th>
              <th>Positions</th>
              <th style="cursor:pointer;" @click="sortBy('apps')">Played{{ sortIndicator('apps') }}</th>
              <th style="cursor:pointer;" @click="sortBy('goals')">Goals{{ sortIndicator('goals') }}</th>
              <th style="cursor:pointer;" @click="sortBy('assists')">Assists{{ sortIndicator('assists') }}</th>
              <th style="cursor:pointer;" @click="sortBy('potm_count')">POTM{{ sortIndicator('potm_count') }}</th>
              <th style="cursor:pointer;" @click="sortBy('clean_sheets')" >Clean sheets{{ sortIndicator('clean_sheets') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in filtered" :key="p.id">
              <td><span class="num">{{ p.squad_number ?? '-' }}</span></td>
              <td>
                <router-link :to="'/players/' + p.id">{{ playerDisplayName(p) }}</router-link>
                <span v-if="!p.active" class="tag warn">Archived</span>
              </td>
              <td style="font-size:0.85rem; opacity:0.75;">{{ (p.preferred_positions || []).join(', ') }}</td>
              <td>{{ statsFor(p.id).apps }}</td>
              <td>{{ statsFor(p.id).goals }}</td>
              <td>{{ statsFor(p.id).assists }}</td>
              <td>{{ statsFor(p.id).potm_count }}</td>
              <td>{{ statsFor(p.id).clean_sheets }}</td>
              <td>
                <button v-if="isAdmin()" class="secondary outline" style="width:auto;" @click="toggleArchive(p)">
                  {{ p.active ? 'Archive' : 'Restore' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!filtered.length">No players found.</p>
    </main>
  `,
};
