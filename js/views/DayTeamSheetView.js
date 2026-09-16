import { ref, computed, onMounted } from "vue";
import { listFixturesOnDate } from "../api/fixtures.js";
import { listAppearancesForFixture } from "../api/appearances.js";
import { listPlayers } from "../api/players.js";
import { store } from "../store.js";
import { playerDisplayName } from "../lib/format.js";
import { useLoader } from "../lib/useLoader.js";
import { POSITIONS } from "../lib/positions.js";

// Sort key for a player's preferred positions: their earliest (most senior)
// position in POSITIONS order, e.g. a DEF/MID player sorts with defenders.
// Players with no position set sort last.
function positionRank(positions) {
  let best = POSITIONS.length;
  for (const pos of positions || []) {
    const idx = POSITIONS.indexOf(pos);
    if (idx !== -1 && idx < best) best = idx;
  }
  return best;
}

export default {
  name: "DayTeamSheetView",
  props: { date: String },
  setup(props) {
    const fixtures = ref([]);
    const players = ref([]);
    const squadByFixture = ref({}); // fixture_id -> [{ id, name, goals, assists, potm }]
    const shareStatus = ref("");
    const sharingImage = ref(false);
    const captureEl = ref(null); // wraps just the header + team cards, for the shared/downloaded image

    const { error: loadError, run: load } = useLoader(async () => {
      fixtures.value = await listFixturesOnDate(props.date);
      players.value = await listPlayers({ activeOnly: true });
      const byFixture = {};
      for (const f of fixtures.value) {
        const apps = await listAppearancesForFixture(f.id);
        byFixture[f.id] = apps
          .filter((a) => a.selected)
          .map((a) => ({
            id: a.player_id,
            name: playerDisplayName(a.players),
            positions: a.players?.preferred_positions || [],
            goals: a.goals,
            assists: a.assists,
            potm: a.potm,
          }))
          .sort((a, b) => positionRank(a.positions) - positionRank(b.positions) || a.name.localeCompare(b.name));
      }
      squadByFixture.value = byFixture;
    });

    // Active-roster players not selected for any fixture today - the
    // "did I miss anyone" check. Coach-only: deliberately left out of
    // asText() below, since that feeds the printed sheet and the Share
    // button (WhatsApp/email to parents).
    const unselectedPlayers = computed(() => {
      const selectedIds = new Set(Object.values(squadByFixture.value).flat().map((p) => p.id));
      return players.value.filter((p) => !selectedIds.has(p.id));
    });

    const clubName = computed(() => store.clubSettings.club_name);

    function asText() {
      const lines = [`${clubName.value} - Matchday ${props.date}`, ""];
      for (const f of fixtures.value) {
        const squad = squadByFixture.value[f.id] || [];
        lines.push(`${f.team_name || 'Team'} vs ${f.opponent} (${f.home_away === 'home' ? 'Home' : 'Away'}) - ${squad.length} selected`);
        lines.push(`${f.kickoff || ''}${f.venue ? ' @ ' + f.venue : ''}`.trim());
        if (f.coaches?.length) lines.push(`Coaches: ${f.coaches.join(', ')}`);
        lines.push(...squad.map((p) => p.name));
        lines.push("");
      }
      return lines.join("\n");
    }

    async function share() {
      const text = asText();
      if (navigator.share) {
        try { await navigator.share({ title: "Team sheets", text }); return; } catch { /* user cancelled */ }
      }
      await navigator.clipboard.writeText(text);
      shareStatus.value = "Copied to clipboard - paste into WhatsApp/email.";
      setTimeout(() => (shareStatus.value = ""), 4000);
    }

    // WhatsApp-friendly results report - one played fixture per block, with
    // score, scorers, assists and POTM. Only offered once something's played.
    const playedFixtures = computed(() => fixtures.value.filter((f) => f.status === "played"));

    function resultWord(us, them) {
      if (us > them) return "Won";
      if (us < them) return "Lost";
      return "Drew";
    }

    function asResultsText() {
      const lines = [`${clubName.value} - Results ${props.date}`, ""];
      for (const f of playedFixtures.value) {
        const us = f.our_score ?? 0;
        const them = f.their_score ?? 0;
        const squad = squadByFixture.value[f.id] || [];
        lines.push(`${f.team_name || 'Team'} ${resultWord(us, them)} ${us}-${them} vs ${f.opponent} (${f.home_away === 'home' ? 'Home' : 'Away'})`);
        const scorerLines = squad.filter((p) => p.goals > 0).map((p) => p.name + (p.goals > 1 ? ` x${p.goals}` : ""));
        if (scorerLines.length) lines.push(`⚽ ${scorerLines.join(", ")}`);
        const assistLines = squad.filter((p) => p.assists > 0).map((p) => p.name + (p.assists > 1 ? ` x${p.assists}` : ""));
        if (assistLines.length) lines.push(`🅰️ ${assistLines.join(", ")}`);
        const potm = squad.find((p) => p.potm);
        if (potm) lines.push(`⭐ POTM: ${potm.name}`);
        lines.push("");
      }
      return lines.join("\n");
    }

    async function shareResults() {
      const text = asResultsText();
      if (navigator.share) {
        try { await navigator.share({ title: "Results", text }); return; } catch { /* user cancelled */ }
      }
      await navigator.clipboard.writeText(text);
      shareStatus.value = "Copied to clipboard - paste into WhatsApp/email.";
      setTimeout(() => (shareStatus.value = ""), 4000);
    }

    function printSheet() { window.print(); }

    // Renders the header + team cards to a PNG and shares it as an image
    // (WhatsApp shows a proper image preview instead of a wall of text).
    // Falls back to downloading the PNG on browsers without native file
    // sharing (most desktops), so it can still be attached manually.
    async function shareImage() {
      if (!captureEl.value) return;
      sharingImage.value = true;
      shareStatus.value = "";
      try {
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(captureEl.value, { backgroundColor: "#ffffff", scale: 2 });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not generate image");
        const file = new File([blob], `team-sheet-${props.date}.png`, { type: "image/png" });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${clubName.value} - Matchday ${props.date}` });
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        shareStatus.value = "Image downloaded - attach it in WhatsApp.";
        setTimeout(() => (shareStatus.value = ""), 4000);
      } catch (e) {
        if (e?.name !== "AbortError") shareStatus.value = "Couldn't create the image: " + e.message;
      } finally {
        sharingImage.value = false;
      }
    }

    onMounted(load);
    return {
      fixtures, squadByFixture, unselectedPlayers, clubName, playedFixtures, playerDisplayName,
      share, shareResults, shareImage, sharingImage, captureEl, printSheet, shareStatus, loadError, load,
    };
  },
  template: `
    <main class="container team-sheet">
      <div class="club-header-band no-print" style="padding:0.75rem 1rem; margin-bottom:1rem;">
        <strong>{{ clubName }}</strong> matchday team sheets
      </div>
      <p v-if="loadError" class="tag warn no-print">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>

      <div ref="captureEl" style="background:#fff;">
        <header style="display:flex; align-items:center; gap:0.75rem;">
          <img src="assets/badge.svg" style="height:3rem;" alt="badge" />
          <h3 style="margin:0;">{{ clubName }} &middot; {{ date }}</h3>
        </header>

        <div class="matchday-columns">
          <article v-for="f in fixtures" :key="f.id" class="day-sheet-match" :class="{ pitch: f.status === 'played' }">
            <header>
              <strong>{{ f.team_name || 'Team' }}</strong> vs {{ f.opponent }}
              <span class="tag">{{ f.home_away === 'home' ? 'Home' : 'Away' }}</span>
              <span class="tag">{{ (squadByFixture[f.id] || []).length }} selected</span>
            </header>
            <p style="font-size:0.85rem; opacity:0.75;">
              <span v-if="f.kickoff">{{ f.kickoff }} &middot; </span>{{ f.venue }}
            </p>
            <p v-if="(f.coaches || []).length" style="font-size:0.85rem; opacity:0.75;">Coaches: {{ f.coaches.join(', ') }}</p>
            <ul class="player-list">
              <li v-for="p in (squadByFixture[f.id] || [])" :key="p.id">{{ p.name }}</li>
            </ul>
            <p v-if="!(squadByFixture[f.id] || []).length" style="font-size:0.85rem; opacity:0.7;">No squad selected yet.</p>
          </article>
        </div>
        <p v-if="!fixtures.length">No fixtures scheduled on this date.</p>
      </div>

      <article v-if="unselectedPlayers.length" class="no-print" style="border-top-color: var(--status-warn); margin-top:1rem;">
        <strong>{{ unselectedPlayers.length }} not selected for any fixture today</strong>
        <p style="margin:0.35rem 0 0;">{{ unselectedPlayers.map(playerDisplayName).join(', ') }}</p>
      </article>

      <div class="no-print" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:1rem;">
        <button style="width:auto;" @click="printSheet">Print / Save as PDF</button>
        <button class="secondary" style="width:auto;" @click="share">Share as text</button>
        <button class="secondary" style="width:auto;" :aria-busy="sharingImage" @click="shareImage">Share as image</button>
        <button v-if="playedFixtures.length" class="secondary" style="width:auto;" @click="shareResults">Share results</button>
      </div>
      <p v-if="shareStatus" class="no-print">{{ shareStatus }}</p>
    </main>
  `,
};
