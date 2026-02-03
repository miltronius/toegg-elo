import { Match, Player, EloHistory } from "../lib/supabase";

interface MatchHistoryProps {
  matches: Match[];
  players: Player[];
  eloHistory: Map<string, EloHistory[]>;
}

export function MatchHistory({
  matches,
  players,
  eloHistory,
}: MatchHistoryProps) {
  const playerMap = new Map(players.map((p) => [p.id, p]));

  return (
    <div className="card">
      <h2>Match History</h2>
      {matches.length === 0 ? (
        <p className="empty-state">
          No matches recorded yet. Record a match to get started!
        </p>
      ) : (
        <div className="match-history-list">
          {matches.map((match) => {
            const teamA1 = playerMap.get(match.team_a_player_1_id);
            const teamA2 = playerMap.get(match.team_a_player_2_id);
            const teamB1 = playerMap.get(match.team_b_player_1_id);
            const teamB2 = playerMap.get(match.team_b_player_2_id);

            const teamAWon = match.winning_team === "A";

            const allPlayerIds = [
              match.team_a_player_1_id,
              match.team_a_player_2_id,
              match.team_b_player_1_id,
              match.team_b_player_2_id,
            ];

            const getEloChange = (playerId: string) => {
              const playerHistory = eloHistory.get(playerId) || [];
              const matchHistory = playerHistory.find(
                (h) => h.match_id === match.id,
              );
              return matchHistory?.elo_change || 0;
            };

            return (
              <div key={match.id} className="match-card">
                <div className="match-teams">
                  <div className={`team ${teamAWon ? "winner" : "loser"}`}>
                    <div className="team-name">Team A {teamAWon && "✓"}</div>
                    <div className="team-players">
                      <div className="player">
                        {teamA1?.name}
                        <span
                          className={`elo-change ${
                            getEloChange(match.team_a_player_1_id) > 0
                              ? "positive"
                              : "negative"
                          }`}
                        >
                          {getEloChange(match.team_a_player_1_id) > 0
                            ? "+"
                            : ""}
                          {getEloChange(match.team_a_player_1_id)}
                        </span>
                      </div>
                      <div className="player">
                        {teamA2?.name}
                        <span
                          className={`elo-change ${
                            getEloChange(match.team_a_player_2_id) > 0
                              ? "positive"
                              : "negative"
                          }`}
                        >
                          {getEloChange(match.team_a_player_2_id) > 0
                            ? "+"
                            : ""}
                          {getEloChange(match.team_a_player_2_id)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="match-divider">vs</div>

                  <div className={`team ${!teamAWon ? "winner" : "loser"}`}>
                    <div className="team-name">Team B {!teamAWon && "✓"}</div>
                    <div className="team-players">
                      <div className="player">
                        {teamB1?.name}
                        <span
                          className={`elo-change ${
                            getEloChange(match.team_b_player_1_id) > 0
                              ? "positive"
                              : "negative"
                          }`}
                        >
                          {getEloChange(match.team_b_player_1_id) > 0
                            ? "+"
                            : ""}
                          {getEloChange(match.team_b_player_1_id)}
                        </span>
                      </div>
                      <div className="player">
                        {teamB2?.name}
                        <span
                          className={`elo-change ${
                            getEloChange(match.team_b_player_2_id) > 0
                              ? "positive"
                              : "negative"
                          }`}
                        >
                          {getEloChange(match.team_b_player_2_id) > 0
                            ? "+"
                            : ""}
                          {getEloChange(match.team_b_player_2_id)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="match-time">
                  {new Date(match.created_at).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
