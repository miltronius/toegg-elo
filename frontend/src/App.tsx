import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPlayers,
  getMatches,
  getAllEloHistory,
  getTeamNames,
  getAllPlayerAchievements,
  getActiveSeason,
  getSeasons,
  getAllPlayerSeasonStats,
  deleteMatch,
  Player,
  Match,
  EloHistory,
  TeamNameRow,
  Season,
  PlayerSeasonStats,
} from "./lib/supabase";
import type { PlayerAchievementRow } from "./lib/achievements";
import { useAuth } from "./contexts/AuthContext";
import { useTheme } from "./contexts/ThemeContext";
import { useToast } from "./contexts/ToastContext";
import { useRealtimeSync } from "./hooks/useRealtimeSync";
import { AuthScreen } from "./components/AuthScreen";
import { CreatePlayerModal } from "./components/PlayerModal";
import { MatchForm } from "./components/MatchForm";
import { Leaderboard } from "./components/Leaderboard";
import { MatchHistory } from "./components/MatchHistory";
import { PlayerDetail } from "./components/PlayerDetail";
import { UserManagement } from "./components/UserManagement";
import { Teams } from "./components/Teams";
import { TeamDetail } from "./components/TeamDetail";
import { Achievements } from "./components/Achievements";
import { Timeline } from "./components/Timeline";
import { SeasonDialog } from "./components/SeasonDialog";
import { ThemeToggle } from "./components/ThemeToggle";
import { Win95Shell } from "./components/Win95Shell";
import { computeTeamStats, TeamStats } from "./lib/teamUtils";
import { AppSkeleton } from "./components/AppSkeleton";
import "./App.css";

interface AppData {
  players: Player[];
  matches: Match[];
  eloHistory: Map<string, EloHistory[]>;
  teamNames: TeamNameRow[];
  allAchievementRows: PlayerAchievementRow[];
  activeSeason: Season | null;
  seasons: Season[];
  allPlayerSeasonStats: PlayerSeasonStats[];
}

// Single parallel fetch for everything the dashboard needs. Replaces the old
// per-player elo_history loop (N sequential round-trips) with one
// getAllEloHistory() call grouped client-side, and derives season stats from
// the all-seasons batch instead of a second filtered query.
async function fetchAppData(): Promise<AppData> {
  const [
    players,
    matches,
    teamNames,
    allAchievementRows,
    activeSeason,
    seasons,
    allPlayerSeasonStats,
    allHistory,
  ] = await Promise.all([
    getPlayers(),
    getMatches(),
    getTeamNames(),
    getAllPlayerAchievements(),
    getActiveSeason(),
    getSeasons(),
    getAllPlayerSeasonStats(),
    getAllEloHistory(),
  ]);

  // Group the flat history by player. Pre-seed every known player so each has
  // an entry (matching the old loop), and ignore orphaned rows for unknown
  // players. getAllEloHistory() returns ascending; reverse each group to the
  // descending order the per-player query previously returned.
  const eloHistory = new Map<string, EloHistory[]>();
  for (const p of players) eloHistory.set(p.id, []);
  for (const entry of allHistory) {
    const list = eloHistory.get(entry.player_id);
    if (list) list.push(entry);
  }
  for (const list of eloHistory.values()) list.reverse();

  return {
    players,
    matches,
    eloHistory,
    teamNames,
    allAchievementRows,
    activeSeason,
    seasons,
    allPlayerSeasonStats,
  };
}

// Stable empty fallbacks so prop identity doesn't churn before data loads.
const EMPTY_PLAYERS: Player[] = [];
const EMPTY_MATCHES: Match[] = [];
const EMPTY_TEAM_NAMES: TeamNameRow[] = [];
const EMPTY_ACHIEVEMENTS: PlayerAchievementRow[] = [];
const EMPTY_SEASONS: Season[] = [];
const EMPTY_SEASON_STATS: PlayerSeasonStats[] = [];
const EMPTY_ELO_HISTORY = new Map<string, EloHistory[]>();

function App() {
  const { user, role, loading: authLoading, signOut } = useAuth();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // Single cached query for all dashboard data. Keyed by user/role because the
  // get_players RPC returns role-dependent names, so logging in/out refetches.
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["appData", user?.id ?? null, role],
    queryFn: fetchAppData,
    enabled: !authLoading,
  });

  // Flash a colorful moving border under the header for 2s whenever data is
  // (re)loaded, so the user gets a clear "it really updated" signal.
  const [updatePulse, setUpdatePulse] = useState(false);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseUpdate = () => {
    setUpdatePulse(true);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setUpdatePulse(false), 2000);
  };
  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
  }, []);

  // Background refresh after a mutation — keeps the current UI on screen. The
  // self-vs-remote stamp lives in the data layer (markLocalMutation), set at the
  // start of each mutation so realtime echoes of our own writes don't toast us.
  const refresh = () => {
    pulseUpdate();
    return queryClient.invalidateQueries({ queryKey: ["appData"] });
  };

  // Push changes from other users: refetch the cache, toast, and flash the
  // update border on remote edits.
  useRealtimeSync({
    queryClient,
    onRemoteChange: () => {
      showToast("Data updated by another user");
      pulseUpdate();
    },
  });

  const players = data?.players ?? EMPTY_PLAYERS;
  const matches = data?.matches ?? EMPTY_MATCHES;
  const eloHistory = data?.eloHistory ?? EMPTY_ELO_HISTORY;
  const teamNames = data?.teamNames ?? EMPTY_TEAM_NAMES;
  const allAchievementRows = data?.allAchievementRows ?? EMPTY_ACHIEVEMENTS;
  const activeSeason = data?.activeSeason ?? null;
  const seasons = data?.seasons ?? EMPTY_SEASONS;
  const allPlayerSeasonStats = data?.allPlayerSeasonStats ?? EMPTY_SEASON_STATS;

  // `undefined` means "no explicit choice yet" → fall back to the active
  // season. A user choice (including `null` = all seasons) overrides it. This
  // derives the default during render instead of via an effect.
  const [selectedSeason, setSelectedSeason] = useState<Season | null | undefined>(undefined);
  const [selectedTeam, setSelectedTeam] = useState<TeamStats | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerDetailInitialTab, setPlayerDetailInitialTab] = useState<"stats" | "achievements">("stats");
  const [activeTab, setActiveTab] = useState<
    "leaderboard" | "history" | "match" | "users" | "teams" | "achievements" | "timeline"
  >("leaderboard");

  const canEdit = role === "user" || role === "admin";
  const isAdmin = role === "admin";
  const canSeeFullHistory = role === "user" || role === "admin";
  const visibleMatches = canSeeFullHistory ? matches : matches.slice(0, 5);

  const effectiveSeason = selectedSeason === undefined ? activeSeason : selectedSeason;

  // Always reflect the freshest player data (e.g. after an inline edit) by
  // deriving the open player from the loaded list rather than holding a copy.
  const selectedPlayer = selectedPlayerId
    ? (players.find((p) => p.id === selectedPlayerId) ?? null)
    : null;

  // Close auth modal on successful login; switch to timeline on first login.
  // This synchronizes UI state with the external auth system on login/logout.
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing UI to external auth state
      setAuthOpen(false);
      setActiveTab((prev) => prev === "leaderboard" ? "timeline" : prev);
    } else {
      setActiveTab((prev) => prev === "timeline" ? "leaderboard" : prev);
    }
  }, [user]);

  const allEloHistory = useMemo(
    () => Array.from(eloHistory.values()).flat(),
    [eloHistory],
  );

  // Season-normalized stats for the selected season, derived from the
  // all-seasons batch (no extra round-trip). Falls back to the active season
  // when "all seasons" is selected, matching the previous behavior.
  const playerSeasonStats = useMemo(() => {
    const targetId = (effectiveSeason ?? activeSeason)?.id;
    return targetId
      ? allPlayerSeasonStats.filter((s) => s.season_id === targetId)
      : EMPTY_SEASON_STATS;
  }, [allPlayerSeasonStats, effectiveSeason, activeSeason]);

  const handleSeasonSelect = (season: Season | null) => setSelectedSeason(season);

  const teams = useMemo(
    () => computeTeamStats(matches, players, teamNames),
    [matches, players, teamNames],
  );

  if (authLoading || isLoading) {
    return <AppSkeleton />;
  }

  const tabCls = (tab: typeof activeTab) =>
    `px-6 py-4 border-none bg-transparent cursor-pointer text-[0.95rem] font-medium border-b-[3px] transition-all whitespace-nowrap ${
      activeTab === tab
        ? "text-primary border-b-primary"
        : "text-text-light border-b-transparent hover:text-text hover:border-b-primary"
    }`;

  const appContent = (
    <div className="min-h-screen flex flex-col">
      {isFetching && !isLoading && (
        <div className="app-refetch-bar" role="progressbar" aria-label="Refreshing data" />
      )}
      <header className="bg-white border-b border-border px-8 py-6 flex justify-between items-center shadow-sm flex-wrap gap-3">
        <h1 className="text-[1.875rem] font-bold">TöggElo⚽</h1>
        <SeasonDialog
          activeSeason={activeSeason}
          isAdmin={isAdmin}
          onSeasonChanged={refresh}
          seasons={seasons}
          matches={matches}
          history={allEloHistory}
          players={players}
          achievements={allAchievementRows}
        />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {canEdit && (
            <button className="btn-primary" onClick={() => setModalOpen(true)}>
              + New Player
            </button>
          )}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-bg-light border border-border text-text-light uppercase tracking-wide">{role}</span>
                <button className="btn-secondary" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <button className="btn-secondary" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>
      <div
        className={`data-update-pulse${updatePulse ? " active" : ""}`}
        aria-hidden="true"
      />
      <nav className="flex gap-1 bg-white border-b border-border px-6 overflow-x-auto">
        {user && (
          <button className={tabCls("timeline")} onClick={() => setActiveTab("timeline")}>
            Timeline
          </button>
        )}
        <button className={tabCls("leaderboard")} onClick={() => setActiveTab("leaderboard")}>
          Leaderboard
        </button>
        {user && (
          <button className={tabCls("teams")} onClick={() => setActiveTab("teams")}>
            Teams
          </button>
        )}
        {canEdit && (
          <button className={tabCls("match")} onClick={() => setActiveTab("match")}>
            Record Match
          </button>
        )}
        <button className={tabCls("history")} onClick={() => setActiveTab("history")}>
          History
        </button>
        {canEdit && (
          <button className={tabCls("achievements")} onClick={() => setActiveTab("achievements")}>
            🏅 Achievements
          </button>
        )}
        {isAdmin && (
          <button className={tabCls("users")} onClick={() => setActiveTab("users")}>
            Admin
          </button>
        )}
      </nav>
      <main className="flex-1 p-8 max-w-300 mx-auto w-full">
        {activeTab === "leaderboard" && (
          <Leaderboard
            players={players}
            history={allEloHistory}
            seasons={seasons}
            selectedSeason={effectiveSeason}
            onSeasonSelect={handleSeasonSelect}
            playerSeasonStats={playerSeasonStats}
            onPlayerClick={
              canEdit
                ? (player) => {
                    setPlayerDetailInitialTab("stats");
                    setSelectedPlayerId(player.id);
                  }
                : undefined
            }
          />
        )}
        {activeTab === "match" && canEdit && (
          <MatchForm
            players={players}
            onMatchRecorded={() => {
              refresh();
              setActiveTab("timeline");
            }}
            playerSeasonStats={playerSeasonStats}
          />
        )}
        {activeTab === "history" && (
          <MatchHistory
            matches={visibleMatches}
            players={players}
            eloHistory={eloHistory}
            seasons={seasons}
            playerSeasonStats={allPlayerSeasonStats}
            isAdmin={isAdmin}
            onDeleteMatch={async (matchId) => {
              await deleteMatch(matchId);
              await refresh();
            }}
          />
        )}
        {activeTab === "timeline" && (
          <Timeline
            players={players}
            matches={matches}
            eloHistory={eloHistory}
            allAchievementRows={allAchievementRows}
            seasons={seasons}
          />
        )}
        {activeTab === "teams" && (
          <Teams
            matches={matches}
            players={players}
            teamNames={teamNames}
            seasons={seasons}
            selectedSeason={effectiveSeason}
            onSeasonSelect={handleSeasonSelect}
            onTeamClick={setSelectedTeam}
            playerSeasonStats={playerSeasonStats}
          />
        )}
        {activeTab === "achievements" && canEdit && (
          <Achievements
            players={players}
            matches={matches}
            allAchievementRows={allAchievementRows}
            eloHistory={allEloHistory}
            onSelectPlayer={
              canEdit
                ? (player) => {
                    setPlayerDetailInitialTab("achievements");
                    setSelectedPlayerId(player.id);
                  }
                : () => {}
            }
          />
        )}
        {activeTab === "users" && isAdmin && (
          <UserManagement onRecomputed={refresh} />
        )}
      </main>
      {canEdit && (
        <CreatePlayerModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onPlayerCreated={refresh}
          players={players}
        />
      )}
      {selectedPlayer && canEdit && (
        <PlayerDetail
          player={selectedPlayer}
          players={players}
          matches={matches}
          allAchievementRows={allAchievementRows}
          eloHistory={allEloHistory}
          seasons={seasons}
          selectedSeason={effectiveSeason}
          onSeasonSelect={handleSeasonSelect}
          playerSeasonStats={playerSeasonStats}
          initialTab={playerDetailInitialTab}
          onClose={() => setSelectedPlayerId(null)}
          onPlayerUpdated={() => {
            refresh();
            setSelectedPlayerId(null);
          }}
          onPlayerRefresh={refresh}
          onNavigate={(p) => setSelectedPlayerId(p.id)}
        />
      )}
      {selectedTeam && (
        <TeamDetail
          team={selectedTeam}
          players={players}
          allTeams={teams}
          canEdit={canEdit}
          onClose={() => setSelectedTeam(null)}
          onNamesUpdated={() => {
            refresh();
            setSelectedTeam(null);
          }}
        />
      )}
      {authOpen && <AuthScreen onClose={() => setAuthOpen(false)} />}
    </div>
  );

  return theme === "win95" ? <Win95Shell>{appContent}</Win95Shell> : appContent;
}

export default App;
