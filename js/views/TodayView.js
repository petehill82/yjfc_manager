import { ref, computed, onMounted } from "vue";
import { listUpcomingFixtures } from "../api/fixtures.js";
import { useLoader } from "../lib/useLoader.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Quick match-day landing page: today's fixture(s), or the next matchday if
// nothing's on today, with one tap into Live scoring. The full Fixtures list
// stays for browsing/editing the whole season - this is just "what's on now".
export default {
  name: "TodayView",
  setup() {
    const fixtures = ref([]);

    const { error: loadError, loading, run: load } = useLoader(async () => {
      fixtures.value = await listUpcomingFixtures(20);
    });

    const targetDate = computed(() => fixtures.value[0]?.match_date || null);
    const isToday = computed(() => targetDate.value === todayStr());
    const shown = computed(() => fixtures.value.filter((f) => f.match_date === targetDate.value));

    onMounted(load);
    return { loading, loadError, load, targetDate, isToday, shown };
  },
  template: `
    <main class="container">
      <h2 style="margin-bottom:0;">{{ isToday ? "Today's match" : "Next match" }}{{ shown.length > 1 ? 'es' : '' }}</h2>
      <p v-if="targetDate" style="opacity:0.7; margin-top:0.15rem;">{{ targetDate }}</p>
      <p v-if="loadError" class="tag warn">{{ loadError }} <a href="#" @click.prevent="load">Retry</a></p>

      <article v-for="f in shown" :key="f.id" :class="{ pitch: f.status === 'played' }">
        <header>
          <strong>{{ f.team_name || 'Team' }}</strong> vs {{ f.opponent }}
          <span class="tag">{{ f.home_away === 'home' ? 'Home' : 'Away' }}</span>
          <span class="tag">{{ f.status }}</span>
        </header>
        <p v-if="f.status === 'played'" class="scoreline">{{ f.our_score ?? 0 }}<span class="vs">&ndash;</span>{{ f.their_score ?? 0 }}</p>
        <p style="font-size:0.9rem; opacity:0.8;">
          <span v-if="f.kickoff">{{ f.kickoff }} &middot; </span>{{ f.venue }}
        </p>
        <p v-if="(f.coaches || []).length" style="font-size:0.85rem; opacity:0.75;">Coaches: {{ f.coaches.join(', ') }}</p>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
          <router-link :to="'/live/' + f.id"><button style="width:auto;">Live scoring</button></router-link>
          <router-link :to="'/matchday/' + f.match_date"><button class="outline" style="width:auto;">Pick team</button></router-link>
          <router-link :to="'/team-sheet/' + f.id"><button class="outline" style="width:auto;">Team sheet</button></router-link>
        </div>
      </article>

      <p v-if="!loading && !shown.length">No upcoming fixtures scheduled.</p>
      <p v-if="loading" aria-busy="true">Loading...</p>
    </main>
  `,
};
