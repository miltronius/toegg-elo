import { useState, useEffect, useMemo } from "react";
import {
  getPlayers,
  getMatches,
  getEloHistory,
  getTeamNames,
  Player,
  Match,
  EloHistory,
  TeamNameRow,
} from "./lib/supabase";
import { useAuth } from "./contexts/AuthContext";
import { AuthScreen } from "./components/AuthScreen";
import { CreatePlayerModal } from "./components/PlayerModal";
import { MatchForm } from "./components/MatchForm";
import { Leaderboard } from "./components/Leaderboard";
import { MatchHistory } from "./components/MatchHistory";
import { PlayerDetail } from "./components/PlayerDetail";
import { UserManagement } from "./components/UserManagement";
import { Teams } from "./components/Teams";
import { TeamDetail } from "./components/TeamDetail";
import { computeTeamStats, TeamStats } from "./lib/teamUtils";
import "./App.css";

function App() {
  const { user, role, loading: authLoading, signOut } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [eloHistory, setEloHistory] = useState<Map<string, EloHistory[]>>(
    new Map(),
  );
  const [teamNames, setTeamNames] = useState<TeamNameRow[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamStats | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "leaderboard" | "history" | "match" | "users" | "teams"
  >("leaderboard");

  const canEdit = role === "user" || role === "admin";
  const isAdmin = role === "admin";

  useEffect(() => {
    loadData();
  }, []);

  // Close auth modal on successful login
  useEffect(() => {
    if (user) setAuthOpen(false);
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [playersData, matchesData, teamNamesData] = await Promise.all([
        getPlayers(),
        getMatches(),
        getTeamNames(),
      ]);
      setPlayers(playersData);
      setMatches(matchesData);
      setTeamNames(teamNamesData);
      const historyMap = new Map<string, EloHistory[]>();
      for (const player of playersData) {
        const history = await getEloHistory(player.id);
        historyMap.set(player.id, history);
      }
      setEloHistory(historyMap);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const allEloHistory: EloHistory[] = Array.from(eloHistory.values()).flat();
  const teams = useMemo(
    () => computeTeamStats(matches, players, teamNames),
    [matches, players, teamNames],
  );

  if (authLoading || loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>TöggElo⚽</h1>
        <div className="header-right">
          {canEdit && (
            <button className="btn-primary" onClick={() => setModalOpen(true)}>
              + New Player
            </button>
          )}
          <div className="user-menu">
            {user ? (
              <>
                <span className="user-role-badge">{role}</span>
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
      <nav className="tabs">
        <button
          className={`tab ${activeTab === "leaderboard" ? "active" : ""}`}
          onClick={() => setActiveTab("leaderboard")}
        >
          Leaderboard
        </button>
        {user && (
          <button
            className={`tab ${activeTab === "teams" ? "active" : ""}`}
            onClick={() => setActiveTab("teams")}
          >
            Teams
          </button>
        )}
        {canEdit && (
          <button
            className={`tab ${activeTab === "match" ? "active" : ""}`}
            onClick={() => setActiveTab("match")}
          >
            Record Match
          </button>
        )}
        <button
          className={`tab ${activeTab === "history" ? "active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
        {isAdmin && (
          <button
            className={`tab ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Users
          </button>
        )}
      </nav>
      <main className="app-content">
        {activeTab === "leaderboard" && (
          <Leaderboard
            players={players}
            history={allEloHistory}
            onPlayerClick={canEdit ? setSelectedPlayer : undefined}
          />
        )}
        {activeTab === "match" && canEdit && (
          <MatchForm players={players} onMatchRecorded={loadData} />
        )}
        {activeTab === "history" && (
          <MatchHistory
            matches={matches}
            players={players}
            eloHistory={eloHistory}
            onMatchDeleted={loadData}
          />
        )}
        {activeTab === "teams" && (
          <Teams
            teams={teams}
            players={players}
            onTeamClick={setSelectedTeam}
          />
        )}
        {activeTab === "users" && isAdmin && <UserManagement />}
      </main>
      {canEdit && (
        <CreatePlayerModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onPlayerCreated={loadData}
        />
      )}
      {selectedPlayer && canEdit && (
        <PlayerDetail
          player={selectedPlayer}
          players={players}
          matches={matches}
          onClose={() => setSelectedPlayer(null)}
          onPlayerUpdated={() => {
            loadData();
            setSelectedPlayer(null);
          }}
          onNavigate={setSelectedPlayer}
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
            loadData();
            setSelectedTeam(null);
          }}
        />
      )}
      {authOpen && <AuthScreen onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

export default App;
