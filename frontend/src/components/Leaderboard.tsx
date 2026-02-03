import { Player } from "../lib/supabase";

interface LeaderboardProps {
  players: Player[];
  onPlayerClick: (player: Player) => void;
}

export function Leaderboard({ players, onPlayerClick }: LeaderboardProps) {
  return (
    <div className="card">
      <h2>Leaderboard</h2>
      {players.length === 0 ? (
        <p className="empty-state">
          No players yet. Create a player to get started!
        </p>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>ELO</th>
              <th>Matches</th>
              <th>W-L</th>
              <th>Winrate</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => {
              const total = player.wins + player.losses;
              const winrate =
                total > 0 ? ((player.wins / total) * 100).toFixed(1) : "0";

              return (
                <tr
                  key={player.id}
                  onClick={() => onPlayerClick(player)}
                  className="clickable-row"
                >
                  <td className="rank">#{index + 1}</td>
                  <td className="name">{player.name}</td>
                  <td className="elo">{player.current_elo}</td>
                  <td className="matches">{player.matches_played}</td>
                  <td className="record">
                    {player.wins}-{player.losses}
                  </td>
                  <td className="winrate">{winrate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
