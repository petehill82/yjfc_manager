import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip,
} from "chart.js";
import { store, currentSeason } from "../store.js";
import { playerSeasonStats, teamResults } from "../api/stats.js";
import { playerCleanSheets } from "../api/cleanSheets.js";
import { listUpcomingFixtures } from "../api/fixtures.js";
import StatTile from "../components/StatTile.js";
import { useLoader } from "../lib/useLoader.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

// Chart labels stay short by default (first name + last initial) since bar
// charts get cramped fast; an explicit display name overrides that instead
// of also being abbreviated - if a coach set one, it's already meant to be
// the short form.
function chartLabel(p) {
  return p.display_name || `${p.first_name} ${p.last_name[0]}.`;
}

// Colors: club orange for "us/home", categorical blue for the paired series -
// both drawn from the dataviz skill's validated 3-slot order (blue, orange, aqua).
const ORANGE = "#eb6834";
const BLUE = "#2a78d6";
const AQUA = "#1baf7a";
const INK_SECONDARY = "#52514e";
const GRID = "#e1e0d9";
const GOOD = "#0ca30c";
const CRITICAL = "#d03b3b";
const NEUTRAL = "#898781";

// A function, not a shared object: every chart needs its OWN scales/plugins
// objects. Chart.js writes internal bookkeeping onto the config objects you
// hand it, so if two charts shared the same nested `scales` object (which a
// shallow `{ ...BASE_OPTS, indexAxis: "y" }` spread does NOT copy), building
// one chart could corrupt another's axis orientation - which is exactly the
// bug this replaced (charts silently swapping between horizontal/vertical
// bars depending on what else had been built before them).
function baseOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: INK_SECONDARY } },
      y: { grid: { color: GRID, drawTicks: false }, ticks: { color: INK_SECONDARY }, beginAtZero: true },
    },
    plugins: {
      legend: { labels: { color: INK_SECONDARY, boxWidth: 12 } },
      tooltip: { enabled: true },
    },
  };
}

export default {
  name: "DashboardView",
  components: { StatTile },
  setup() {
    const players = ref([]);
    const cleanSheets = ref([]);
    const teams = ref([]);
    const upcoming = ref([]);
    const charts = {};
    const leaderboardCanvas = ref(null);
    const matchesCanvas = ref(null);
    const potmCanvas = ref(null);
    const cleanSheetsCanvas = ref(null);
    const homeAwayCanvas = ref(null);

    const totals = computed(() => {
      const t = teams.value.reduce((acc, r) => {
        acc.played += r.played; acc.wins += r.wins; acc.draws += r.draws; acc.losses += r.losses;
        acc.gf += r.goals_for; acc.ga += r.goals_against; acc.cs += r.clean_sheets ?? 0;
        return acc;
      }, { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, cs: 0 });
      return t;
    });

    function destroyCharts() {
      for (const c of Object.values(charts)) c?.destroy();
    }

    // Each chart built in isolation - one throwing (e.g. Chart.js's "canvas
    // already in use" if a stale instance wasn't cleaned up) shouldn't be
    // able to silently take the rest down with it, and if it does happen
    // we'll get an exact, named error instead of just "some bars missing".
    function safeBuild(name, fn) {
      try {
        fn();
      } catch (e) {
        console.error(`Dashboard chart "${name}" failed to build:`, e);
      }
    }

    function buildLeaderboard() {
      const top = [...players.value]
        .sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists))
        .slice(0, 8);
      charts.leaderboard?.destroy();
      charts.leaderboard = new Chart(leaderboardCanvas.value, {
        type: "bar",
        data: {
          labels: top.map((p) => chartLabel(p)),
          datasets: [
            { label: "Goals", data: top.map((p) => p.goals), backgroundColor: ORANGE, borderRadius: 4, borderSkipped: false, barThickness: 18, categoryPercentage: 0.7, barPercentage: 0.9 },
            { label: "Assists", data: top.map((p) => p.assists), backgroundColor: BLUE, borderRadius: 4, borderSkipped: false, barThickness: 18, categoryPercentage: 0.7, barPercentage: 0.9 },
          ],
        },
        options: { ...baseOpts(), indexAxis: "y" },
      });
    }

    function buildMatchesPlayed() {
      const sorted = [...players.value].sort((a, b) => b.apps - a.apps);
      charts.matches?.destroy();
      const opts = baseOpts();
      charts.matches = new Chart(matchesCanvas.value, {
        type: "bar",
        data: {
          labels: sorted.map((p) => chartLabel(p)),
          datasets: [{ label: "Matches played", data: sorted.map((p) => p.apps), backgroundColor: ORANGE, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 }],
        },
        options: { ...opts, indexAxis: "y", plugins: { ...opts.plugins, legend: { display: false } } },
      });
    }

    function buildPotm() {
      const sorted = [...players.value].sort((a, b) => b.potm_count - a.potm_count);
      charts.potm?.destroy();
      const opts = baseOpts();
      charts.potm = new Chart(potmCanvas.value, {
        type: "bar",
        data: {
          labels: sorted.map((p) => chartLabel(p)),
          datasets: [{ label: "POTM awards", data: sorted.map((p) => p.potm_count), backgroundColor: BLUE, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 }],
        },
        options: {
          ...opts,
          indexAxis: "y",
          plugins: { ...opts.plugins, legend: { display: false } },
          scales: { ...opts.scales, x: { ...opts.scales.x, ticks: { ...opts.scales.x.ticks, stepSize: 1 } } },
        },
      });
    }

    function buildCleanSheets() {
      const keepers = [...cleanSheets.value].sort((a, b) => b.clean_sheets - a.clean_sheets);
      charts.cleanSheets?.destroy();
      charts.cleanSheets = null;
      if (!keepers.length) return;
      const opts = baseOpts();
      charts.cleanSheets = new Chart(cleanSheetsCanvas.value, {
        type: "bar",
        data: {
          labels: keepers.map((p) => chartLabel(p)),
          datasets: [{ label: "Clean sheets", data: keepers.map((p) => p.clean_sheets), backgroundColor: AQUA, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 }],
        },
        options: {
          ...opts,
          indexAxis: "y",
          plugins: { ...opts.plugins, legend: { display: false } },
          scales: { ...opts.scales, x: { ...opts.scales.x, ticks: { ...opts.scales.x.ticks, stepSize: 1 } } },
        },
      });
    }

    function buildHomeAway() {
      const t = teams.value.reduce((acc, r) => {
        acc.wh += r.wins_home; acc.dh += r.draws_home; acc.lh += r.losses_home;
        acc.wa += r.wins_away; acc.da += r.draws_away; acc.la += r.losses_away;
        return acc;
      }, { wh: 0, dh: 0, lh: 0, wa: 0, da: 0, la: 0 });
      charts.homeAway?.destroy();
      charts.homeAway = new Chart(homeAwayCanvas.value, {
        type: "bar",
        data: {
          labels: ["Wins", "Draws", "Losses"],
          datasets: [
            { label: "Home", data: [t.wh, t.dh, t.lh], backgroundColor: ORANGE, borderRadius: 4, borderSkipped: false, barThickness: 24, categoryPercentage: 0.6, barPercentage: 0.9 },
            { label: "Away", data: [t.wa, t.da, t.la], backgroundColor: BLUE, borderRadius: 4, borderSkipped: false, barThickness: 24, categoryPercentage: 0.6, barPercentage: 0.9 },
          ],
        },
        options: baseOpts(),
      });
    }

    // Sequential, not parallel (Promise.all/allSettled) - firing several
    // Supabase requests at the exact same instant, right as the page loads
    // and the auth session is still settling, risks one of them going out
    // without a fully-attached auth token. RLS then just returns zero rows
    // for that one query rather than an error, which looks identical to
    // "no data yet" - silent and confusing. One at a time avoids the race.
    const { error: loadError, run: load } = useLoader(async () => {
      const seasonId = store.currentSeasonId;
      if (!seasonId) return;
      players.value = await playerSeasonStats(seasonId);
      teams.value = await teamResults(seasonId);
      cleanSheets.value = await playerCleanSheets(seasonId);
      upcoming.value = await listUpcomingFixtures(5);
      await nextTick();
      safeBuild("leaderboard", buildLeaderboard);
      safeBuild("matchesPlayed", buildMatchesPlayed);
      safeBuild("potm", buildPotm);
      safeBuild("cleanSheets", buildCleanSheets);
      safeBuild("homeAway", buildHomeAway);
    });

    watch(() => store.currentSeasonId, load);
    onMounted(load);
    onBeforeUnmount(destroyCharts);

    return { players, cleanSheets, teams, upcoming, totals, loadError, load, leaderboardCanvas, matchesCanvas, potmCanvas, cleanSheetsCanvas, homeAwayCanvas, store, currentSeason, GOOD, CRITICAL, NEUTRAL };
  },
  template: `
    <main class="container">
      <h2>Dashboard</h2>
      <p v-if="loadError" class="tag warn">
        {{ loadError }} <a href="#" @click.prevent="load">Retry</a>
      </p>
      <label v-if="store.seasons.length > 1">Season
        <select v-model="store.currentSeasonId">
          <option v-for="s in store.seasons" :key="s.id" :value="s.id">{{ s.name }} - {{ s.squad_name }}</option>
        </select>
      </label>

      <div class="stat-grid">
        <StatTile label="Played" :value="totals.played" />
        <StatTile label="Wins" :value="totals.wins" />
        <StatTile label="Draws" :value="totals.draws" />
        <StatTile label="Losses" :value="totals.losses" />
        <StatTile label="Goals for" :value="totals.gf" />
        <StatTile label="Goals against" :value="totals.ga" />
        <StatTile label="Clean sheets" :value="totals.cs" />
      </div>
      <p style="font-size:0.85rem;">
        <span class="tag" :style="{ background: '#dcfce7', color: GOOD }">&#9679; Wins</span>
        <span class="tag" :style="{ background: '#f4f4f2', color: NEUTRAL }">&#9679; Draws</span>
        <span class="tag" :style="{ background: '#fee2e2', color: CRITICAL }">&#9679; Losses</span>
      </p>

      <h3>Matches played</h3>
      <div :style="{ height: Math.max(220, players.length * 22) + 'px' }"><canvas ref="matchesCanvas"></canvas></div>

      <h3>Player of the Match</h3>
      <div :style="{ height: Math.max(220, players.length * 22) + 'px' }"><canvas ref="potmCanvas"></canvas></div>
      <p v-if="!players.some(p => p.potm_count > 0)" style="opacity:0.7;">No POTM awarded yet this season.</p>

      <h3>Clean sheets</h3>
      <div :style="{ height: Math.max(120, cleanSheets.length * 30 + 60) + 'px' }"><canvas ref="cleanSheetsCanvas"></canvas></div>
      <p v-if="!cleanSheets.length" style="opacity:0.7;">No clean sheets yet this season.</p>

      <h3>Goals &amp; assists (top 8)</h3>
      <div style="height:280px;"><canvas ref="leaderboardCanvas"></canvas></div>

      <h3>Home vs away results</h3>
      <div style="height:260px;"><canvas ref="homeAwayCanvas"></canvas></div>

      <h3>Upcoming fixtures</h3>
      <ul>
        <li v-for="f in upcoming" :key="f.id">
          {{ f.match_date }} vs {{ f.opponent }} <span class="tag">{{ f.home_away }}</span>
        </li>
      </ul>
      <p v-if="!upcoming.length">No upcoming fixtures scheduled.</p>
    </main>
  `,
};
