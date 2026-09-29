import { ref, reactive, computed, onMounted, nextTick } from "vue";
import { listFixtures, createFixture, createFixturesBulk, updateFixture, deleteFixture, setFixtureCoaches } from "../api/fixtures.js";
import { listCoaches } from "../api/profiles.js";
import { store, isAdmin, currentSeason } from "../store.js";
import { parseDelimited, normalizeDate, normalizeTime, normalizeHomeAway } from "../lib/csv.js";
import { coachDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";
import { strengthLabel } from "../lib/teamStrength.js";

const BLANK = { match_date: "", kickoff: "", team_name: "", opponent: "", home_away: "home", venue: "", competition: "", format: "", status: "scheduled", our_score: null, their_score: null, coach_ids: [], team_strength: "" };

export default {
  name: "FixturesView",
  setup() {
    const fixtures = ref([]);
    const allCoaches = ref([]);
    const showForm = ref(false);
    const formEl = ref(null); // the top-of-page add/duplicate form, scrolled into view below
    const draft = ref({ ...BLANK });
    const editingId = ref(null);
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

    function startAdd() { draft.value = { ...BLANK }; editingId.value = null; showForm.value = true; showImport.value = false; }

    // Editing happens inline on the fixture's own card (see template), not in
    // the top-of-page form - so there's nothing to scroll back up for.
    function startEdit(f) { draft.value = { ...f, coach_ids: [...(f.coach_ids || [])], team_strength: f.team_strength || "" }; editingId.value = f.id; showForm.value = false; showImport.value = false; }
    function cancelEdit() { editingId.value = null; error.value = ""; }

    // Clone a fixture as another of our teams playing the same opponent/date -
    // the quick path for "this one fixture is actually N matches for us".
    // Clicked from a fixture card that's often well down the page, but the
    // form itself lives at the top - scroll to it, or opening it looks like
    // nothing happened.
    function duplicateAsNewTeam(f) {
      const { id, created_at, coaches, coach_ids, ...rest } = f;
      draft.value = { ...rest, coach_ids: [...(coach_ids || [])], team_name: "", our_score: null, their_score: null, status: "scheduled", team_strength: rest.team_strength || "" };
      editingId.value = null;
      showForm.value = true;
      showImport.value = false;
      nextTick(() => formEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

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
        const saved = editingId.value ? await updateFixture(editingId.value, payload) : await createFixture(payload);
        await setFixtureCoaches(saved.id, coach_ids || []);
        showForm.value = false;
        editingId.value = null;
        await load();
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
      editingId.value = null;
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
      showForm, formEl, draft, editingId, error, isAdmin, strengthLabel,
      startAdd, startEdit, cancelEdit, duplicateAsNewTeam, save, remove,
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

      <article v-if="showForm" ref="formEl">
        <form @submit.prevent="save">
          <div class="form-grid">
            <label>Date <input v-model="draft.match_date" type="date" required /></label>
            <label>Kickoff <input v-model="draft.kickoff" type="time" /></label>
            <label>Our team label <input v-model="draft.team_name" placeholder="e.g. Orange (optional)" /></label>
            <label>Squad strength <small>(coach-only, never shared)</small>
              <select v-model="draft.team_strength">
                <option value="">Not set</option>
                <option value="stronger">Stronger</option>
                <option value="development">Development</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            <label>Opponent <input v-model="draft.opponent" required /></label>
            <label>Home/Away
              <select v-model="draft.home_away"><option value="home">Home</option><option value="away">Away</option></select>
            </label>
            <label>Venue <input v-model="draft.venue" /></label>
            <label>Format <input v-model="draft.format" placeholder="e.g. 9v9" /></label>
            <label>Competition <input v-model="draft.competition" /></label>
            <label>Status
              <select v-model="draft.status">
                <option value="scheduled">Scheduled</option>
                <option value="played">Played</option>
                <option value="postponed">Postponed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label>Our score <input v-model="draft.our_score" type="number" min="0" /></label>
            <label>Their score <input v-model="draft.their_score" type="number" min="0" /></label>
          </div>
          <fieldset>
            <legend>Coaches</legend>
            <label v-for="c in allCoaches" :key="c.id" style="display:flex; align-items:center; gap:0.4rem; font-weight:normal;">
              <input type="checkbox" :value="c.id" v-model="draft.coach_ids" /> {{ coachDisplayName(c) }}
            </label>
            <p v-if="!allCoaches.length" style="opacity:0.7; font-size:0.85rem;">No registered coaches yet - invite them from the Supabase dashboard and they'll show up here.</p>
          </fieldset>
          <p v-if="error" style="color:#b91c1c;">{{ error }}</p>
          <button type="submit">Save fixture</button>
          <button type="button" class="secondary" @click="showForm = false">Cancel</button>
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

      <section v-for="[date, fx] in displayedGroups" :key="date">
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <h4 style="margin:0;">{{ date }}</h4>
          <router-link :to="'/team-sheet-day/' + date"><button class="outline" style="width:auto; padding:0.2rem 0.75rem;">Day sheet</button></router-link>
        </div>
        <div class="matchday-columns">
          <article v-for="f in fx" :key="f.id" :class="{ pitch: f.status === 'played' }">
            <form v-if="editingId === f.id" @submit.prevent="save">
              <div class="form-grid">
                <label>Date <input v-model="draft.match_date" type="date" required /></label>
                <label>Kickoff <input v-model="draft.kickoff" type="time" /></label>
                <label>Our team label <input v-model="draft.team_name" placeholder="e.g. Orange (optional)" /></label>
                <label>Squad strength <small>(coach-only, never shared)</small>
                  <select v-model="draft.team_strength">
                    <option value="">Not set</option>
                    <option value="stronger">Stronger</option>
                    <option value="development">Development</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </label>
                <label>Opponent <input v-model="draft.opponent" required /></label>
                <label>Home/Away
                  <select v-model="draft.home_away"><option value="home">Home</option><option value="away">Away</option></select>
                </label>
                <label>Venue <input v-model="draft.venue" /></label>
                <label>Format <input v-model="draft.format" placeholder="e.g. 9v9" /></label>
                <label>Competition <input v-model="draft.competition" /></label>
                <label>Status
                  <select v-model="draft.status">
                    <option value="scheduled">Scheduled</option>
                    <option value="played">Played</option>
                    <option value="postponed">Postponed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label>Our score <input v-model="draft.our_score" type="number" min="0" /></label>
                <label>Their score <input v-model="draft.their_score" type="number" min="0" /></label>
              </div>
              <fieldset>
                <legend>Coaches</legend>
                <label v-for="c in allCoaches" :key="c.id" style="display:flex; align-items:center; gap:0.4rem; font-weight:normal;">
                  <input type="checkbox" :value="c.id" v-model="draft.coach_ids" /> {{ coachDisplayName(c) }}
                </label>
                <p v-if="!allCoaches.length" style="opacity:0.7; font-size:0.85rem;">No registered coaches yet - invite them from the Supabase dashboard and they'll show up here.</p>
              </fieldset>
              <p v-if="error" style="color:#b91c1c;">{{ error }}</p>
              <button type="submit" style="width:auto;">Save fixture</button>
              <button type="button" class="secondary" style="width:auto;" @click="cancelEdit">Cancel</button>
            </form>
            <template v-else>
              <header>
                <strong>{{ f.team_name || 'Team' }}</strong> vs {{ f.opponent }}
                <span class="tag">{{ f.home_away }}</span>
                <span class="tag">{{ f.status }}</span>
                <span v-if="f.team_strength" class="tag" title="Coach-only note, never shared">{{ strengthLabel(f.team_strength) }}</span>
              </header>
              <p v-if="f.status === 'played'" class="scoreline">{{ f.our_score }}<span class="vs">&ndash;</span>{{ f.their_score }}</p>
              <p style="font-size:0.85rem; opacity:0.75;">{{ f.venue }} <span v-if="f.kickoff">&middot; {{ f.kickoff }}</span></p>
              <p v-if="(f.coaches || []).length" style="font-size:0.85rem; opacity:0.75;">Coaches: {{ f.coaches.join(', ') }}</p>
              <footer style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                <router-link :to="'/matchday/' + f.match_date"><button class="outline" style="width:auto;">Pick team</button></router-link>
                <router-link :to="'/team-sheet/' + f.id"><button class="outline" style="width:auto;">Team sheet</button></router-link>
                <router-link :to="'/live/' + f.id"><button class="outline" style="width:auto;">Live</button></router-link>
                <router-link :to="'/match-stats/' + f.id"><button class="outline" style="width:auto;">Stats</button></router-link>
                <button class="secondary" style="width:auto;" @click="startEdit(f)">Edit</button>
                <button class="secondary outline" style="width:auto;" @click="duplicateAsNewTeam(f)">+ Add team</button>
                <button v-if="isAdmin()" class="secondary outline" style="width:auto;" @click="remove(f)">Delete</button>
              </footer>
            </template>
          </article>
        </div>
      </section>
      <p v-if="!fixtures.length">No fixtures yet for this season.</p>
      <button v-if="pastGroups.length" class="outline" style="width:auto; margin-top:1rem;" @click="showPast = !showPast">
        {{ showPast ? 'Hide' : 'Show' }} past fixtures ({{ pastFixtureCount }})
      </button>
    </main>
  `,
};
