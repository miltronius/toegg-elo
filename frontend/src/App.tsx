import { useState, useEffect } from "react";
import {
  getPlayers,
  getMatches,
  getEloHistory,
  Player,
  Match,
  EloHistory,
} from "./lib/supabase";
import { CreatePlayerModal, PlayerDropdown } from "./components/PlayerModal";
import { MatchForm } from "./components/MatchForm";
import { Leaderboard } from "./components/Leaderboard";
import { MatchHistory } from "./components/MatchHistory";
import { PlayerDetail } from "./components/PlayerDetail";
import "./App.css";

function App() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [eloHistory, setEloHistory] = useState<Map<string, EloHistory[]>>(
    new Map(),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "leaderboard" | "history" | "match"
  >("leaderboard");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [playersData, matchesData] = await Promise.all([
        getPlayers(),
        getMatches(),
      ]);

      setPlayers(playersData);
      setMatches(matchesData);

      // Load ELO history for all players
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

  const handlePlayerCreated = async () => {
    await loadData();
  };

  const handleMatchRecorded = async () => {
    await loadData();
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>⚽ Table Soccer ELO</h1>
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          + New Player
        </button>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === "leaderboard" ? "active" : ""}`}
          onClick={() => setActiveTab("leaderboard")}
        >
          Leaderboard
        </button>
        <button
          className={`tab ${activeTab === "match" ? "active" : ""}`}
          onClick={() => setActiveTab("match")}
        >
          Record Match
        </button>
        <button
          className={`tab ${activeTab === "history" ? "active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
      </nav>

      <main className="app-content">
        {activeTab === "leaderboard" && (
          <Leaderboard players={players} onPlayerClick={setSelectedPlayer} />
        )}
        {activeTab === "match" && (
          <MatchForm players={players} onMatchRecorded={handleMatchRecorded} />
        )}
        {activeTab === "history" && (
          <MatchHistory
            matches={matches}
            players={players}
            eloHistory={eloHistory}
            onMatchDeleted={handleMatchRecorded}
          />
        )}
      </main>

      <CreatePlayerModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onPlayerCreated={handlePlayerCreated}
      />

      {selectedPlayer && (
        <PlayerDetail
          player={selectedPlayer}
          matches={matches}
          onClose={() => setSelectedPlayer(null)}
          onPlayerUpdated={() => {
            handleMatchRecorded();
            setSelectedPlayer(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
