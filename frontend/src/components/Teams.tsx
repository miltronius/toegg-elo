import { useState } from "react";
import { createPortal } from "react-dom";
import { Player } from "../lib/supabase";
import {
  TeamStats,
  getTeamDisplayName,
  teamKeyParts,
  teamColor,
} from "../lib/teamUtils";

function TeamTooltip({
  children,
  tooltipPlayers,
  color,
}: {
  children: React.ReactNode;
  tooltipPlayers: (Player | undefined)[];
  color: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className="team-tooltip"
            style={{
              position: "fixed",
              top: pos.y,
              left: pos.x - 12,
              transform: "translate(-100%, -50%)",
              zIndex: 9999,
            }}
          >
            <div className="team-tooltip-bar" style={{ background: color }} />
            <div className="team-tooltip-players">
              {tooltipPlayers.map(
                (p, i) =>
                  p && (
                    <div key={i} className="team-tooltip-player">
                      <span>{p.name}</span>
                      <span className="team-tooltip-elo">{p.current_elo}</span>
                    </div>
                  ),
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function winRateColor(rate: number): string {
  if (rate >= 0.6) return "var(--success)";
  if (rate >= 0.4) return "var(--warning)";
  return "var(--error)";
}

const MEDALS = ["🥇", "🥈", "🥉"];

interface TeamsProps {
  teams: TeamStats[];
  players: Player[];
  onTeamClick: (team: TeamStats) => void;
}

type SortKey = "elo" | "winrate" | "matches" | "name";

const STORAGE_KEY = "teams-view";

export function Teams({ teams, players, onTeamClick }: TeamsProps) {
  const [view, setView] = useState<"table" | "card">(
    () => (localStorage.getItem(STORAGE_KEY) as "table" | "card") ?? "table",
  );
  const [sortBy, setSortBy] = useState<SortKey>("elo");
  const [sortAsc, setSortAsc] = useState(false);
  const [filterPlayerId, setFilterPlayerId] = useState<string>("");

  const setViewAndStore = (v: "table" | "card") => {
    setView(v);
    localStorage.setItem(STORAGE_KEY, v);
  };

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc((a) => !a);
    } else {
      setSortBy(key);
      setSortAsc(false);
    }
  };

  const filtered = filterPlayerId
    ? teams.filter(
        (t) =>
          t.player_id_lo === filterPlayerId ||
          t.player_id_hi === filterPlayerId,
      )
    : teams;

  // eloRank is always ELO desc — used for rank/medal assignment
  const eloRank = new Map(
    [...filtered].sort((a, b) => b.combinedElo - a.combinedElo).map((t, i) => [t.key, i]),
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name") {
      const diff = getTeamDisplayName(a, players).localeCompare(getTeamDisplayName(b, players));
      return sortAsc ? diff : -diff;
    }
    let diff = 0;
    if (sortBy === "elo") diff = b.combinedElo - a.combinedElo;
    else if (sortBy === "winrate") diff = b.winRate - a.winRate;
    else diff = b.matchesPlayed - a.matchesPlayed;
    return sortAsc ? -diff : diff;
  });

  const playerMap = new Map(players.map((p) => [p.id, p]));

  const teamPlayers = (t: TeamStats): [Player | undefined, Player | undefined] => {
    const p1 = playerMap.get(t.player_id_lo);
    const p2 = playerMap.get(t.player_id_hi);
    return (p1?.current_elo ?? 0) >= (p2?.current_elo ?? 0) ? [p1, p2] : [p2, p1];
  };

  const rivalDisplay = (rivalKey: string): { name: string; color: string; rivalTeam: TeamStats | undefined } => {
    const [lo, hi] = teamKeyParts(rivalKey);
    const rivalTeam = teams.find((t) => t.key === rivalKey);
    const name =
      rivalTeam?.nameRow?.name ??
      `${playerMap.get(lo)?.name ?? "?"} & ${playerMap.get(hi)?.name ?? "?"}`;
    const color = rivalTeam ? teamColor(rivalTeam) : "#aaa";
    return { name, color, rivalTeam };
  };

  if (teams.length === 0) {
    return (
      <div className="card">
        <div className="teams-header">
          <h2>Teams</h2>
        </div>
        <div className="empty-state">No matches recorded yet.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="teams-header">
        <h2>Teams</h2>
        <div className="teams-controls">
          <select
            className="teams-player-filter"
            value={filterPlayerId}
            onChange={(e) => setFilterPlayerId(e.target.value)}
          >
            <option value="">All players</option>
            {[...players]
              .sort((a, b) => b.current_elo - a.current_elo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.current_elo})
                </option>
              ))}
          </select>
          <div className="lb-toggle">
            <button
              className={`lb-toggle-btn ${view === "table" ? "active" : ""}`}
              onClick={() => setViewAndStore("table")}
            >
              Table
            </button>
            <button
              className={`lb-toggle-btn ${view === "card" ? "active" : ""}`}
              onClick={() => setViewAndStore("card")}
            >
              Cards
            </button>
          </div>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="empty-state">No teams found for this player.</div>
      )}
      {sorted.length > 0 && view === "table" ? (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="rank">#</th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("name")}>
                Team {sortBy === "name" && (sortAsc ? "▴" : "▾")}
              </th>
              <th
                className="elo"
                style={{ cursor: "pointer" }}
                onClick={() => handleSort("elo")}
              >
                Combined ELO {sortBy === "elo" && (sortAsc ? "▴" : "▾")}
              </th>
              <th
                className="record"
                style={{ cursor: "pointer" }}
                onClick={() => handleSort("matches")}
              >
                W – L {sortBy === "matches" && (sortAsc ? "▴" : "▾")}
              </th>
              <th
                className="winrate"
                style={{ cursor: "pointer" }}
                onClick={() => handleSort("winrate")}
              >
                Win Rate {sortBy === "winrate" && (sortAsc ? "▴" : "▾")}
              </th>
              <th>Top Rival</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((team, i) => (
              <tr
                key={team.key}
                className="clickable-row"
                onClick={() => onTeamClick(team)}
                style={{ borderLeft: `4px solid ${teamColor(team)}` }}
              >
                <td className="rank">
                  {MEDALS[eloRank.get(team.key)!] ?? `#${eloRank.get(team.key)! + 1}`}
                </td>
                <td className="name" style={{ padding: 0 }}>
                  <TeamTooltip tooltipPlayers={teamPlayers(team)} color={teamColor(team)}>
                    <div style={{ padding: "1rem" }}>
                      <div>{getTeamDisplayName(team, players)}</div>
                      {(team.nameRow?.alias_1 || team.nameRow?.alias_2) && (
                        <div className="team-aliases-inline">
                          {[team.nameRow.alias_1, team.nameRow.alias_2]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                  </TeamTooltip>
                </td>
                <td className="elo">{team.combinedElo}</td>
                <td className="record">
                  {team.wins} – {team.losses}
                </td>
                <td
                  className="winrate"
                  style={{ color: winRateColor(team.winRate) }}
                >
                  {(team.winRate * 100).toFixed(0)}%
                </td>
                <td style={{ fontSize: "0.85rem", padding: 0 }}>
                  {team.rivals[0] ? (
                    (() => {
                      const { name, color, rivalTeam } = rivalDisplay(team.rivals[0].key);
                      const rPlayers = rivalTeam ? teamPlayers(rivalTeam) : [];
                      return (
                        <TeamTooltip tooltipPlayers={rPlayers} color={color}>
                          <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "1rem" }}>
                            <span className="team-color-dot" style={{ background: color }} />
                            <span className="text-light">{name} ({team.rivals[0].matchesPlayed}×)</span>
                          </span>
                        </TeamTooltip>
                      );
                    })()
                  ) : (
                    <span style={{ padding: "1rem", display: "block" }} className="text-light">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : sorted.length > 0 ? (
        <div className="teams-grid">
          {sorted.map((team, i) => (
            <div
              key={team.key}
              className="team-card"
              onClick={() => onTeamClick(team)}
              style={{ borderLeft: `4px solid ${teamColor(team)}` }}
            >
              <TeamTooltip tooltipPlayers={teamPlayers(team)} color={teamColor(team)}>
                <div className="team-card-names">
                  {MEDALS[eloRank.get(team.key)!] && (
                    <span style={{ marginRight: "0.35rem" }}>{MEDALS[eloRank.get(team.key)!]}</span>
                  )}
                  {getTeamDisplayName(team, players)}
                </div>
                {(team.nameRow?.alias_1 || team.nameRow?.alias_2) && (
                  <div className="team-card-alias">
                    {[team.nameRow!.alias_1, team.nameRow!.alias_2]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </TeamTooltip>
              <div className="team-card-stats">
                <span className="team-combined-elo">{team.combinedElo}</span>
                <span className="team-record">
                  {team.wins} – {team.losses}
                </span>
                <span
                  className="team-winrate"
                  style={{ color: winRateColor(team.winRate) }}
                >
                  {(team.winRate * 100).toFixed(0)}%
                </span>
              </div>
              {team.rivals[0] &&
                (() => {
                  const { name, color, rivalTeam } = rivalDisplay(team.rivals[0].key);
                  const rPlayers = rivalTeam ? teamPlayers(rivalTeam) : [];
                  return (
                    <TeamTooltip tooltipPlayers={rPlayers} color={color}>
                      <div className="team-rival-tag">
                        <span className="team-color-dot" style={{ background: color }} />
                        {name} ({team.rivals[0].matchesPlayed}×)
                      </div>
                    </TeamTooltip>
                  );
                })()}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
