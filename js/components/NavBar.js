import { useRouter } from "vue-router";
import { store, isAdmin } from "../store.js";
import { signOut } from "../supabase.js";

export default {
  name: "NavBar",
  setup() {
    const router = useRouter();
    async function logout() {
      await signOut();
      router.push("/login");
    }
    return { store, isAdmin, logout };
  },
  template: `
    <header class="app-header">
      <img class="badge" :src="store.clubSettings.badge_path || 'assets/badge.svg'" alt="Club badge" />
      <div style="flex:1">
        <p class="club-title">
          {{ store.clubSettings.club_name || 'Squad Manager' }}
          <small v-if="store.seasons.length">{{ store.seasons.find(s => s.id === store.currentSeasonId)?.squad_name }}</small>
        </p>
      </div>
      <nav class="top-nav">
        <router-link to="/">Dashboard</router-link>
        <router-link to="/today">Today</router-link>
        <router-link to="/fixtures">Fixtures</router-link>
        <router-link to="/availability">Availability</router-link>
        <router-link to="/results">Results</router-link>
        <router-link to="/players">Players</router-link>
        <!-- Not in use for now: <router-link to="/attendance">Attendance</router-link> -->
        <router-link v-if="isAdmin()" to="/admin">Admin</router-link>
        <router-link to="/set-password" class="no-print">Profile</router-link>
        <a href="#" @click.prevent="logout" class="no-print">Sign out</a>
      </nav>
    </header>
    <nav class="bottom-nav no-print">
      <router-link to="/">🏠<br>Home</router-link>
      <router-link to="/today">⚽<br>Today</router-link>
      <router-link to="/fixtures">📅<br>Fixtures</router-link>
      <router-link to="/availability">✅<br>Avail.</router-link>
      <router-link to="/results">🏆<br>Results</router-link>
      <router-link to="/players">👥<br>Players</router-link>
      <router-link v-if="isAdmin()" to="/admin">⚙️<br>Admin</router-link>
      <router-link to="/set-password">🔑<br>Profile</router-link>
      <a href="#" @click.prevent="logout">🚪<br>Sign out</a>
    </nav>
  `,
};
