import { coachDisplayName } from "../lib/format.js";

// Compact editor for one fixture, used for both "add fixture" and the
// per-day editor. Edits the passed-in draft object in place. The fields that
// change most (time, team, opponent, home/away, venue, strength) are always
// visible; the rest sit under "More details" so the form stays short.
export default {
  name: "FixtureEditor",
  props: {
    draft: { type: Object, required: true },
    allCoaches: { type: Array, default: () => [] },
    showDate: { type: Boolean, default: false },
    removable: { type: Boolean, default: false },
    openDetails: { type: Boolean, default: false },
  },
  emits: ["remove"],
  methods: { coachDisplayName },
  template: `
    <div class="fx-editor">
      <div class="fx-edit-grid">
        <label v-if="showDate">Date <input v-model="draft.match_date" type="date" required /></label>
        <label>Kick off <input v-model="draft.kickoff" type="time" /></label>
        <label>Team <input v-model="draft.team_name" placeholder="e.g. Orange" /></label>
        <label class="fx-wide">Opponent <input v-model="draft.opponent" required /></label>
        <label>Home/Away
          <select v-model="draft.home_away"><option value="home">Home</option><option value="away">Away</option></select>
        </label>
        <label>Venue <input v-model="draft.venue" /></label>
        <label title="Coach-only, never shared">Strength
          <select v-model="draft.team_strength">
            <option value="">Not set</option>
            <option value="stronger">Stronger</option>
            <option value="development">Development</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
      </div>
      <details :open="openDetails" class="fx-more">
        <summary>More details (status, score, format, coaches)</summary>
        <div class="fx-edit-grid">
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
          <label>Format <input v-model="draft.format" placeholder="e.g. 9v9" /></label>
          <label>Competition <input v-model="draft.competition" /></label>
        </div>
        <div class="fx-coaches">
          <strong>Coaches</strong>
          <label v-for="c in allCoaches" :key="c.id">
            <input type="checkbox" :value="c.id" v-model="draft.coach_ids" /> {{ coachDisplayName(c) }}
          </label>
          <span v-if="!allCoaches.length" style="opacity:0.7; font-size:0.85rem;">No registered coaches yet.</span>
        </div>
      </details>
      <button v-if="removable" type="button" class="secondary outline fx-remove" @click="$emit('remove')">Remove this team</button>
    </div>
  `,
};
