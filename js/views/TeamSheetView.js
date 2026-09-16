import { ref, computed, onMounted } from "vue";
import { getFixture } from "../api/fixtures.js";
import { listAppearancesForFixture } from "../api/appearances.js";
import { store } from "../store.js";
import { playerDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";

export default {
  name: "TeamSheetView",
  props: { id: String },
  setup(props) {
    const fixture = ref(null);
    const appearances = ref([]);
    const shareStatus = ref("");

    function playerName(a) {
      return playerDisplayName(a.players);
    }

    const { error: loadError, run: load } = useLoader(async () => {
      fixture.value = await getFixture(props.id);
      const apps = await listAppearancesForFixture(props.id);
      appearances.value = apps
        .filter((a) => a.selected)
        .sort((a, b) => playerName(a).localeCompare(playerName(b)));
    });

    function asText() {
      const f = fixture.value;
      const squad = store.seasons.find((s) => s.id === f.season_id)?.squad_name || "";
      const lines = [
        `${squad} vs ${f.opponent}${f.team_name ? " (" + f.team_name + ")" : ""}`,
        `${f.match_date} ${f.kickoff || ""} - ${f.home_away === "home" ? "Home" : "Away"}${f.venue ? " @ " + f.venue : ""}`,
        ...(f.coaches?.length ? [`Coaches: ${f.coaches.join(", ")}`] : []),
        "",
        "Squad:",
        ...appearances.value.map((a) => playerName(a)),
      ];
      return lines.join("\n");
    }

    async function share() {
      const text = asText();
      if (navigator.share) {
        try { await navigator.share({ title: "Team sheet", text }); return; } catch { /* user cancelled */ }
      }
      await navigator.clipboard.writeText(text);
      shareStatus.value = "Copied to clipboard - paste into WhatsApp/email.";
      setTimeout(() => (shareStatus.value = ""), 4000);
    }

    function printSheet() { window.print(); }

    onMounted(load);
    return { fixture, appearances, playerName, share, printSheet, shareStatus, store, loadError, load };
  },
  template: `
    <main class="container" v-if="loadError && !fixture">
      <p class="tag warn">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>
    </main>
    <main class="container team-sheet" v-else-if="fixture">
      <div class="club-header-band no-print" style="padding:0.75rem 1rem; margin-bottom:1rem;">
        <strong>{{ store.clubSettings.club_name }}</strong> team sheet
      </div>
      <header style="display:flex; align-items:center; gap:0.75rem;">
        <img src="assets/badge.svg" style="height:3rem;" alt="badge" />
        <div>
          <h3 style="margin:0;">{{ store.seasons.find(s => s.id === fixture.season_id)?.squad_name }} vs {{ fixture.opponent }}
            <span v-if="fixture.team_name">({{ fixture.team_name }})</span></h3>
          <p style="margin:0;">{{ fixture.match_date }} {{ fixture.kickoff }} &middot; {{ fixture.home_away === 'home' ? 'Home' : 'Away' }}
             <span v-if="fixture.venue">&middot; {{ fixture.venue }}</span></p>
          <p v-if="(fixture.coaches || []).length" style="margin:0;">Coaches: {{ fixture.coaches.join(', ') }}</p>
        </div>
      </header>

      <h4>Squad</h4>
      <ul class="player-list">
        <li v-for="a in appearances" :key="a.player_id">{{ playerName(a) }}</li>
      </ul>
      <p v-if="!appearances.length">No squad selected yet.</p>

      <div class="no-print" style="display:flex; gap:0.5rem; margin-top:1rem;">
        <button @click="printSheet">Print / Save as PDF</button>
        <button class="secondary" @click="share">Share</button>
      </div>
      <p v-if="shareStatus" class="no-print">{{ shareStatus }}</p>
    </main>
  `,
};
