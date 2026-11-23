import { ref, reactive, computed, watch, onMounted, nextTick } from "vue";
import { listFixtures, createFixture, createFixturesBulk, updateFixture, deleteFixture, setFixtureCoaches } from "../api/fixtures.js";
import { listCoaches } from "../api/profiles.js";
import { store, isAdmin, currentSeason } from "../store.js";
import { parseDelimited, normalizeDate, normalizeTime, normalizeHomeAway } from "../lib/csv.js";
import { coachDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";
import { strengthLabel } from "../lib/teamStrength.js";
import FixtureEditor from "../components/FixtureEditor.js";

const BLANK = { match_date: "", kickoff: "", team_name: "", opponent: "", home_away: "home", venue: "", competition: "", format: "", status: "scheduled", our_score: null, their_score: null, coach_ids: [], team_strength: "" };

export default {
  name: "FixturesView",
  components: { FixtureEditor },
  setup() {
    const fixtures = ref([]);
    const allCoaches = ref([]);
    const showForm = ref(false);
    const draft = ref({ ...BLANK });
    const error = ref("");

    const { error: loadError, run: load } = useLoader(async () => {
      fixtures.value = await listFixtures({ seasonId: store.currentSeasonId });
      allCoaches.value = await listCoaches();
    });

    const grouped = computed(() => {
      const byDate = {};
      for (const f of fixtures.value) {
        (byDate[f.match_date] ||= []).push(f);
      }
      return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
    });

    // Past dates are collapsed by default - otherwise a season's worth of
    // played fixtures pushes today's/upcoming ones further down the page
    // every week. Upcoming stays sorted soonest-first; past (once expanded)
    // shows most recent first, since that's what you're most likely after.
    const today = new Date().toISOString().slice(0, 10);
    const showPast = ref(false);
    const upcomingGroups = computed(() => grouped.value.filter(([date]) => date >= today));
    const pastGroups = computed(() => grouped.value.filter(([date]) => date < today).reverse());
    const pastFixtureCount = computed(() => pastGroups.value.reduce((n, [, fx]) => n + fx.length, 0));
    const displayedGroups = computed(() => showPast.value ? [...upcomingGroups.value, ...pastGroups.value] : upcomingGroups.value);

    // ---------------- Collapsible days ----------------
    // One day open at a time (accordion). Defaults to the next upcoming day
    // once the fixtures first load; the user's own open/close choice wins
    // after that.
    const openDate = ref(null);
    let openDateTouched = false;
    watch(upcomingGroups, (groups) => {
      if (!openDateTouched && openDate.value === null && groups.length) openDate.value = groups[0][0];
    }, { immediate: true });

    function isOpen(date) { return openDate.value === date; }
    function toggleDay(date) {
      openDateTouched = true;
      openDate.value = openDate.value === date ? null : date;
    }

    function dayLabel(date) {
      const d = new Date(date + "T00:00:00");
      return isNaN(d) ? date : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
    function daySummary(fx) {
      const opponents = [...new Set(fx.map((f) => f.opponent))];
      const times = fx.map((f) => f.kickoff).filter(Boolean).sort();
      return opponents.join(" / ") + (times.length ? ` · ${times[0]}` : "");
    }

    function scrollToDay(date) {
      nextTick(() => document.getElementById("fx-day-" + date)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

    function startAdd() { draft.value = { ...BLANK }; cancelDayEdit(); showForm.value = true; showImport.value = false; }

    // ---------------- Edit a whole day ----------------
    // The day's cards swap for compact editor rows in the same spot, with one
    // Save for the lot - and the day is scrolled to the top so the page never
    // ends up somewhere else after opening/saving.
    const editingDate = ref(null);
    const dayDate = ref("");      // the date every row in the day is saved with
    const dayDrafts = ref([]);
    const dayError = ref("");
    const daySaving = ref(false);

    function toDraft(f) {
      return {
        id: f.id, kickoff: f.kickoff || "", team_name: f.team_name || "", opponent: f.opponent || "",
        home_away: f.home_away || "home", venue: f.venue || "", format: f.format || "", competition: f.competition || "",
        status: f.status || "scheduled", our_score: f.our_score ?? "", their_score: f.their_score ?? "",
        team_strength: f.team_strength || "", coach_ids: [...(f.coach_ids || [])],
      };
    }
    // Compare the editable fields only, so unchanged fixtures aren't re-saved.
    function snapshot(d) {
      const { _orig, _open, ...fields } = d;
      return JSON.stringify(fields);
    }

    function startDayEdit(date, fx, focusId = null, addTeam = false) {
      showForm.value = false;
      showImport.value = false;
      dayError.value = "";
      dayDate.value = date;
      dayDrafts.value = fx.map((f) => {
        const d = toDraft(f);
        return { ...d, _orig: snapshot(d), _open: f.id === focusId };
      });
      editingDate.value = date;
      openDate.value = date;
      openDateTouched = true;
      if (addTeam) addTeamToDay();
      scrollToDay(date);
    }
    function cancelDayEdit() {
      const date = editingDate.value;
      editingDate.value = null;
      dayDrafts.value = [];
      dayError.value = "";
      if (date) scrollToDay(date);
    }

    // Another of our teams playing the same opponent that day - copies the
    // last row's opponent/venue/time so only the team label needs changing.
    function addTeamToDay() {
      const last = dayDrafts.value[dayDrafts.value.length - 1];
      const base = last ? { ...last, coach_ids: [...last.coach_ids] } : { ...BLANK, team_strength: "" };
      dayDrafts.value.push({
        ...toDraft({ ...base, id: null }),
        id: null, team_name: "", our_score: "", their_score: "", status: "scheduled", _orig: null, _open: false,
      });
    }
    function removeDraftRow(i) { dayDrafts.value.splice(i, 1); }

    async function saveDay() {
      dayError.value = "";
      daySaving.value = true;
      try {
        for (const d of dayDrafts.value) {
          const dateChanged = dayDate.value !== editingDate.value;
          if (d.id && !dateChanged && snapshot(d) === d._orig) continue;
          const payload = {
            match_date: dayDate.value,
            season_id: store.currentSeasonId,
            kickoff: d.kickoff === "" ? null : d.kickoff,
            team_name: d.team_name,
            opponent: d.opponent,
            home_away: d.home_away,
            venue: d.venue,
            format: d.format,
            competition: d.competition,
            status: d.status,
            our_score: d.our_score === "" || d.our_score == null ? null : Number(d.our_score),
            their_score: d.their_score === "" || d.their_score == null ? null : Number(d.their_score),
            team_strength: d.team_strength === "" ? null : d.team_strength,
          };
          const saved = d.id ? await updateFixture(d.id, payload) : await createFixture(payload);
          await setFixtureCoaches(saved.id, d.coach_ids || []);
        }
        const date = dayDate.value;
        editingDate.value = null;
        dayDrafts.value = [];
        await load();
        openDate.value = date;
        scrollToDay(date);
      } catch (e) {
        dayError.value = e.message;
      } finally {
        daySaving.value = false;
      }
    }

    // Top-of-page "+ Add fixture" form (creates a new fixture only).
    async function save() {
      error.value = "";
      try {
        const { coach_ids, coaches, ...fixtureFields } = draft.value;
        const payload = {
          ...fixtureFields,
          season_id: store.currentSeasonId,
          kickoff: draft.value.kickoff === "" ? null : draft.value.kickoff,
          our_score: draft.value.our_score === "" ? null : draft.value.our_score,
          their_score: draft.value.their_score === "" ? null : draft.value.their_score,
          team_strength: draft.value.team_strength === "" ? null : draft.value.team_strength,
        };
        const saved = await createFixture(payload);
        await setFixtureCoaches(saved.id, coach_ids || []);
        showForm.value = false;
        await load();
        openDate.value = saved.match_date;
        openDateTouched = true;
        scrollToDay(saved.match_date);
      } catch (e) { error.value = e.message; }
    }

    async function remove(f) {
      if (!confirm(`Delete fixture vs ${f.opponent} on ${f.match_date}?`)) return;
      await deleteFixture(f.id);
      await load();
    }

    // ---------------- Import ----------------
    const showImport = ref(false);
    const importText = ref("");
    const importHeaders = ref([]);
    const parsedRows = ref([]);
    const mapping = reactive({ match_date: "", kickoff: "", venue: "", competition: "", format: "", opponent: "", home_away: "", home_team: "", away_team: "" });
    const useHomeAwayColumns = ref(false);
    const ourNameInFile = ref("");
    const teamCount = ref(1);
    const teamLabels = ref("");
    const importError = ref("");
    const importing = ref(false);

    function openImport() {
      showForm.value = false;
      cancelDayEdit();
      showImport.value = true;
      // Don't prefill with the placeholder "My Club" default - that's not a
      // real name and would silently fail to match anything in the file.
      const guess = currentSeason()?.squad_name || store.clubSettings.club_name || "";
      ourNameInFile.value = guess && guess !== "My Club" ? guess : "";
    }

    function resetImport() {
      importText.value = "";
      importHeaders.value = [];
      parsedRows.value = [];
      importError.value = "";
      teamCount.value = 1;
      teamLabels.value = "";
    }

    function cancelImport() { showImport.value = false; resetImport(); }

    function onFile(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { importText.value = String(reader.result || ""); parseImport(); };
      reader.readAsText(file);
    }

    function autoGuessMapping() {
      const find = (...names) => importHeaders.value.find((h) => names.includes(h.trim().toLowerCase()));
      mapping.match_date = find("date", "match date", "fixture date", "when") || "";
      mapping.kickoff = find("kickoff", "time", "kick off", "ko") || "";
      mapping.venue = find("venue", "ground", "location") || "";
      mapping.competition = find("competition", "league") || "";
      mapping.format = find("format") || "";
      mapping.opponent = find("opponent", "opposition") || "";
      mapping.home_away = find("home/away", "h/a", "venue type") || "";
      mapping.home_team = find("home team", "home") || "";
      mapping.away_team = find("away team", "away") || "";
      useHomeAwayColumns.value = !mapping.opponent && !!(mapping.home_team && mapping.away_team);
    }

    function parseImport() {
      importError.value = "";
      const { headers, rows } = parseDelimited(importText.value);
      if (!headers.length) {
        importError.value = "Couldn't find any columns - make sure you pasted the header row too.";
        return;
      }
      importHeaders.value = headers;
      parsedRows.value = rows;
      autoGuessMapping();
    }

    // Rows successfully mapped into fixtures - possibly several per imported
    // row, one for each of our teams entered for that fixture. Team labels
    // are assigned by running letter A, B, C... continuing across the whole
    // day rather than restarting for each opponent.
    const importResult = computed(() => {
      if (!parsedRows.value.length) return { fixtures: [], unmatched: 0 };
      const count = Math.max(1, Math.min(8, teamCount.value || 1));
      const out = [];
      let unmatched = 0;
      for (const r of parsedRows.value) {
        const get = (field) => {
          const col = mapping[field];
          if (!col) return "";
          const idx = importHeaders.value.indexOf(col);
          return idx >= 0 ? (r[idx] || "").trim() : "";
        };
        const match_date = normalizeDate(get("match_date"));
        const kickoff = normalizeTime(get("kickoff"));
        const venue = get("venue");
        const competition = get("competition");
        const format = get("format");
        let opponent = "";
        let home_away = "home";
        if (useHomeAwayColumns.value) {
          const homeTeam = get("home_team");
          const awayTeam = get("away_team");
          const us = ourNameInFile.value.trim().toLowerCase();
          if (us && homeTeam.toLowerCase().includes(us)) { home_away = "home"; opponent = awayTeam; }
          else if (us && awayTeam.toLowerCase().includes(us)) { home_away = "away"; opponent = homeTeam; }
          else { unmatched++; continue; } // couldn't tell which side is us - don't guess
        } else {
          opponent = get("opponent");
          home_away = normalizeHomeAway(get("home_away"));
        }
        if (!match_date || !opponent) continue; // skip rows we couldn't make sense of
        for (let i = 0; i < count; i++) {
          out.push({
            match_date, kickoff: kickoff || null, opponent, home_away,
            venue: venue || null, competition: competition || null, format: format || null,
            status: "scheduled", our_score: null, their_score: null,
          });
        }
      }
      const labels = teamLabels.value.split(",").map((s) => s.trim()).filter(Boolean);
      const seenPerDate = {};
      for (const f of out) {
        const n = seenPerDate[f.match_date] || 0;
        // Positional, no wraparound: label n (0-indexed) of the day. If custom
        // labels run out, fall back to letters rather than repeating from the
        // start - so a day never comes out as A,B,A,B.
        f.team_name = (n < labels.length && labels[n]) ? labels[n] : `Team ${String.fromCharCode(65 + n)}`;
        seenPerDate[f.match_date] = n + 1;
      }
      return { fixtures: out, unmatched };
    });

    const previewFixtures = computed(() => importResult.value.fixtures);
    const unmatchedSideCount = computed(() => importResult.value.unmatched);

    const skippedRowCount = computed(() => {
      if (!parsedRows.value.length) return 0;
      const count = Math.max(1, Math.min(8, teamCount.value || 1));
      return parsedRows.value.length - unmatchedSideCount.value - previewFixtures.value.length / count;
    });

    async function runImport() {
      importError.value = "";
      importing.value = true;
      try {
        const payload = previewFixtures.value.map((f) => ({ ...f, season_id: store.currentSeasonId }));
        await createFixturesBulk(payload);
        showImport.value = false;
        resetImport();
        await load();
      } catch (e) {
        importError.value = e.message;
      } finally {
        importing.value = false;
      }
    }

    onMounted(load);
    return {
      fixtures, allCoaches, coachDisplayName, loadError, load, grouped, displayedGroups, showPast, pastGroups, pastFixtureCount,
      showForm, draft, error, isAdmin, strengthLabel,
      startAdd, save, remove,
      isOpen, toggleDay, dayLabel, daySummary, editingDate, dayDate, dayDrafts, dayError, daySaving,
      startDayEdit, cancelDayEdit, addTeamToDay, removeDraftRow, saveDay,
      showImport, importText, importHeaders, parsedRows, mapping, useHomeAwayColumns,
      ourNameInFile, teamCount, teamLabels, importError, importing, previewFixtures, skippedRowCount, unmatchedSideCount,
      openImport, cancelImport, onFile, parseImport, runImport,
    };
  },
  template: `
    <main class="container">
      <h2>Fixtures</h2>
      <p v-if="loadError" class="tag warn">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button @click="startAdd" style="width:auto;">+ Add fixture</button>
        <button class="outline" @click="openImport" style="width:auto;">+ Import from file</button>
      </div>

      <article v-if="showForm">
        <h4 style="margin-top:0;">New fixture</h4>
        <form @submit.prevent="save">
          <FixtureEditor :draft="draft" :all-coaches="allCoaches" show-date />
          <p v-if="error" style="color:#b91c1c;">{{ error }}</p>
          <button type="submit" style="width:auto;">Save fixture</button>
          <button type="button" class="secondary" style="width:auto;" @click="showForm = false">Cancel</button>
        </form>
      </article>

      <article v-if="showImport">
        <h3>Import fixtures</h3>
        <p style="font-size:0.85rem; opacity:0.75;">
          Paste fixtures copied from a spreadsheet or your league website, or choose a CSV file.
          Ad-hoc games don't need this - use "+ Add fixture" for those.
        </p>
        <input type="file" accept=".csv,text/csv,text/plain" @change="onFile" />
        <textarea v-model="importText" rows="6" placeholder="Date,Opponent,Venue,Home/Away&#10;20/09/2026,Rivals FC,Memorial Park,Home"></textarea>
        <button type="button" style="width:auto;" @click="parseImport">Read fixtures</button>

        <div v-if="importHeaders.length">
          <h4>Match columns</h4>
          <div class="stat-grid">
            <label>Date <select v-model="mapping.match_date"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Kickoff <select v-model="mapping.kickoff"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Venue <select v-model="mapping.venue"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Competition <select v-model="mapping.competition"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Format <select v-model="mapping.format"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
          </div>

          <label style="display:flex; gap:0.5rem; align-items:center; margin-top:0.5rem;">
            <input type="checkbox" v-model="useHomeAwayColumns" /> File has separate Home team / Away team columns
          </label>

          <div v-if="!useHomeAwayColumns" class="stat-grid">
            <label>Opponent column <select v-model="mapping.opponent"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Home/Away column <select v-model="mapping.home_away"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
          </div>
          <div v-else class="stat-grid">
            <label>Home team column <select v-model="mapping.home_team"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Away team column <select v-model="mapping.away_team"><option value="">-</option><option v-for="h in importHeaders" :key="h">{{ h }}</option></select></label>
            <label>Our club/team name in file
              <input v-model="ourNameInFile" placeholder="e.g. Yatton Junior FC" />
            </label>
          </div>
          <p v-if="useHomeAwayColumns" style="font-size:0.8rem; opacity:0.7;">
            Whichever side (Home/Away) contains this text is treated as us, so the opponent and
            home/away are worked out automatically. The team label itself (below) is assigned per
            day, not from the file - e.g. "Yatton Junior FC U10 Athletic" and
            "Yatton Junior FC U10 Rangers" both just become whichever match letter they fall on.
          </p>

          <h4>How many of our teams play each fixture?</h4>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <input type="number" min="1" max="8" v-model.number="teamCount" style="width:5rem;" />
            <input v-model="teamLabels" placeholder="Team labels, comma separated e.g. Orange, Black" style="flex:1; min-width:220px;" />
          </div>
          <p style="font-size:0.8rem; opacity:0.7;">
            Each row becomes {{ teamCount }} match{{ teamCount === 1 ? '' : 'es' }}. Labels run
            continuously through the day and never repeat - e.g. two fixtures on one date, each
            split into 2, come out as A, B, then C, D. Leave the labels box blank to get those
            letters automatically. If you list your own (e.g. "Orange, Black") they're used in that
            order for the day's matches; once the list runs out, later matches fall back to letters.
          </p>

          <h4>Preview ({{ previewFixtures.length }} match{{ previewFixtures.length === 1 ? '' : 'es' }} from {{ parsedRows.length }} row{{ parsedRows.length === 1 ? '' : 's' }})</h4>
          <p v-if="unmatchedSideCount > 0" class="tag warn">
            {{ unmatchedSideCount }} row(s) skipped - couldn't tell which side is us. Check "Our club/team name in file" matches how your club is spelled in the file (e.g. "Yatton" or "Yatton Junior FC").
          </p>
          <p v-if="skippedRowCount > 0" class="tag warn">{{ skippedRowCount }} row(s) skipped - missing date or opponent, check your column mapping</p>
          <div style="overflow-x:auto; max-height:280px; overflow-y:auto;">
            <table>
              <thead><tr><th>Date</th><th>Team</th><th>Opponent</th><th>H/A</th><th>Venue</th></tr></thead>
              <tbody>
                <tr v-for="(f, i) in previewFixtures" :key="i">
                  <td>{{ f.match_date }}</td><td>{{ f.team_name || '-' }}</td><td>{{ f.opponent }}</td><td>{{ f.home_away }}</td><td>{{ f.venue }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="importError" style="color:#b91c1c;">{{ importError }}</p>
          <button type="button" :aria-busy="importing" :disabled="!previewFixtures.length || importing" @click="runImport">
            Import {{ previewFixtures.length }} fixture{{ previewFixtures.length === 1 ? '' : 's' }}
          </button>
          <button type="button" class="secondary" @click="cancelImport">Cancel</button>
        </div>
      </article>

      <section v-for="[date, fx] in displayedGroups" :key="date" :id="'fx-day-' + date" class="fx-day">
        <div class="fx-day-head" role="button" tabindex="0" :aria-expanded="isOpen(date)"
             @click="toggleDay(date)" @keydown.enter.prevent="toggleDay(date)" @keydown.space.prevent="toggleDay(date)">
          <span class="fx-chevron">{{ isOpen(date) ? '▾' : '▸' }}</span>
          <h4>{{ dayLabel(date) }}</h4>
          <span class="tag">{{ fx.length }} game{{ fx.length === 1 ? '' : 's' }}</span>
          <span class="fx-day-summary">{{ daySummary(fx) }}</span>
          <span class="fx-day-actions" @click.stop>
            <router-link :to="'/team-sheet-day/' + date"><button class="outline">Day sheet</button></router-link>
            <button v-if="editingDate !== date" class="secondary" @click="startDayEdit(date, fx)">Edit day</button>
          </span>
        </div>

        <div v-if="isOpen(date)" class="fx-day-body">
          <form v-if="editingDate === date" @submit.prevent="saveDay">
            <div class="fx-edit-grid" style="margin-bottom:0.5rem;">
              <label>Date for all games on this day <input v-model="dayDate" type="date" required /></label>
            </div>
            <FixtureEditor v-for="(d, i) in dayDrafts" :key="d.id || ('new' + i)"
                           :draft="d" :all-coaches="allCoaches" :open-details="d._open"
                           :removable="!d.id" @remove="removeDraftRow(i)" />
            <p v-if="dayError" style="color:#b91c1c;">{{ dayError }}</p>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.75rem;">
              <button type="submit" style="width:auto;" :aria-busy="daySaving" :disabled="daySaving">Save day</button>
              <button type="button" class="outline" style="width:auto;" @click="addTeamToDay">+ Add team</button>
              <button type="button" class="secondary" style="width:auto;" @click="cancelDayEdit">Cancel</button>
            </div>
          </form>

          <div v-else class="matchday-columns">
          <article v-for="f in fx" :key="f.id" :class="{ pitch: f.status === 'played' }">
              <header>
                <strong>{{ f.team_name || 'Team' }}</strong> vs {{ f.opponent }}
                <span class="tag">{{ f.home_away }}</span>
                <span class="tag">{{ f.status }}</span>
                <span v-if="f.team_strength" class="tag" title="Coach-only note, never shared">{{ strengthLabel(f.team_strength) }}</span>
              </header>
              <p v-if="f.status === 'played'" class="scoreline">{{ f.our_score ?? 0 }}<span class="vs">&ndash;</span>{{ f.their_score ?? 0 }}</p>
              <p style="font-size:0.85rem; opacity:0.75;">{{ f.venue }} <span v-if="f.kickoff">&middot; {{ f.kickoff }}</span></p>
              <p v-if="(f.coaches || []).length" style="font-size:0.85rem; opacity:0.75;">Coaches: {{ f.coaches.join(', ') }}</p>
              <footer style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                <router-link :to="'/matchday/' + f.match_date"><button class="outline" style="width:auto;">Pick team</button></router-link>
                <router-link :to="'/team-sheet/' + f.id"><button class="outline" style="width:auto;">Team sheet</button></router-link>
                <router-link :to="'/live/' + f.id"><button class="outline" style="width:auto;">Live</button></router-link>
                <router-link :to="'/match-stats/' + f.id"><button class="outline" style="width:auto;">Stats</button></router-link>
                <button class="secondary" style="width:auto;" @click="startDayEdit(date, fx, f.id)">Edit</button>
                <button class="secondary outline" style="width:auto;" @click="startDayEdit(date, fx, null, true)">+ Add team</button>
                <button v-if="isAdmin()" class="secondary outline" style="width:auto;" @click="remove(f)">Delete</button>
              </footer>
          </article>
          </div>
        </div>
      </section>
      <p v-if="!fixtures.length">No fixtures yet for this season.</p>
      <button v-if="pastGroups.length" class="outline" style="width:auto; margin-top:1rem;" @click="showPast = !showPast">
        {{ showPast ? 'Hide' : 'Show' }} past fixtures ({{ pastFixtureCount }})
      </button>
    </main>
  `,
};
