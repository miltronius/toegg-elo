import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Match, Player, PlayerSeasonStats, Season, TeamNameRow } from "../lib/supabase";
import {
  TeamStats,
  getTeamDisplayName,
  teamKeyParts,
  teamColor,
  computeTeamStats,
} from "../lib/teamUtils";
import { colors } from "../lib/colors";

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
  if (rate >= 0.6) return colors.success;
  if (rate >= 0.4) return colors.warning;
  return colors.error;
}

const MEDALS = ["🥇", "🥈", "🥉"];

interface TeamsProps {
  matches: Match[];
  players: Player[];
  teamNames: TeamNameRow[];
  seasons: Season[];
  selectedSeason: Season | null;
  onSeasonSelect: (season: Season | null) => void;
  onTeamClick: (team: TeamStats) => void;
  playerSeasonStats?: PlayerSeasonStats[];
}

type SortKey = "rank" | "elo" | "winrate" | "matches" | "name";

const STORAGE_KEY = "teams-view";

export function Teams({ matches, players, teamNames, seasons, selectedSeason, onSeasonSelect, onTeamClick, playerSeasonStats }: TeamsProps) {
  const [view, setView] = useState<"table" | "card">(
    () => (localStorage.getItem(STORAGE_KEY) as "table" | "card") ?? "table",
  );
  const [sortBy, setSortBy] = useState<SortKey>("rank");
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

  const effectivePlayers = useMemo(() => {
    if (!selectedSeason || !playerSeasonStats?.length) return players;
    const statsMap = new Map(
      playerSeasonStats
        .filter((s) => s.season_id === selectedSeason.id)
        .map((s) => [s.player_id, s]),
    );
    return players.map((p) => {
      const s = statsMap.get(p.id);
      return s ? { ...p, current_elo: s.current_season_elo } : p;
    });
  }, [players, selectedSeason, playerSeasonStats]);

  const filteredMatches = useMemo(
    () => selectedSeason ? matches.filter((m) => m.season_id === selectedSeason.id) : matches,
    [matches, selectedSeason],
  );

  const teams = useMemo(
    () => computeTeamStats(filteredMatches, effectivePlayers, teamNames),
    [filteredMatches, effectivePlayers, teamNames],
  );

  const eligible = teams.filter((t: TeamStats) => t.matchesPlayed >= 2);

  const filtered = eligible.filter(
    (t) =>
      !filterPlayerId ||
      t.player_id_lo === filterPlayerId ||
      t.player_id_hi === filterPlayerId,
  );

  const globalRankMap = new Map(
    [...eligible]
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
      .map((t, i) => [t.key, i]),
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name") {
      const diff = getTeamDisplayName(a, players).localeCompare(
        getTeamDisplayName(b, players),
      );
      return sortAsc ? diff : -diff;
    }
    let diff = 0;
    if (sortBy === "rank") diff = globalRankMap.get(a.key)! - globalRankMap.get(b.key)!;
    else if (sortBy === "elo") diff = b.combinedElo - a.combinedElo;
    else if (sortBy === "winrate") diff = b.winRate - a.winRate;
    else diff = b.matchesPlayed - a.matchesPlayed;
    return sortAsc ? -diff : diff;
  });

  const playerMap = useMemo(
    () => new Map(effectivePlayers.map((p) => [p.id, p])),
    [effectivePlayers],
  );

  const teamPlayers = (
    t: TeamStats,
  ): [Player | undefined, Player | undefined] => {
    const p1 = playerMap.get(t.player_id_lo);
    const p2 = playerMap.get(t.player_id_hi);
    return (p1?.current_elo ?? 0) >= (p2?.current_elo ?? 0)
      ? [p1, p2]
      : [p2, p1];
  };

  const rivalDisplay = (
    rivalKey: string,
  ): { name: string; color: string; rivalTeam: TeamStats | undefined } => {
    const [lo, hi] = teamKeyParts(rivalKey);
    const rivalTeam = teams.find((t) => t.key === rivalKey);
    const name =
      rivalTeam?.nameRow?.name ??
      `${playerMap.get(lo)?.name ?? "?"} & ${playerMap.get(hi)?.name ?? "?"}`;
    const color = rivalTeam ? teamColor(rivalTeam) : "#aaa";
    return { name, color, rivalTeam };
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2.5 mb-4">
        <h2 className="m-0">Teams</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="season-select"
            value={selectedSeason?.id ?? ""}
            onChange={(e) => {
              const s = seasons.find((s) => s.id === e.target.value) ?? null;
              onSeasonSelect(s);
            }}
          >
            <option value="">All-Time</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                S{s.number} · {s.name}
              </option>
            ))}
          </select>
          <select
            className="px-2.5 py-1.5 border border-border rounded-lg bg-bg-light text-[0.8rem] font-semibold text-text cursor-pointer font-[inherit]"
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

      <p className="text-[0.78rem] text-text-light -mt-2 mb-3">Only teams with ≥ 2 matches are shown.</p>

      {sorted.length === 0 && (
        <div className="text-center py-12 px-4 text-text-light text-[0.95rem]">
          {teams.length === 0
            ? "No matches recorded yet."
            : "No teams found for this player."}
        </div>
      )}
      {sorted.length > 0 && view === "table" ? (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="rank" style={{ cursor: "pointer" }} onClick={() => handleSort("rank")}>
                # {sortBy === "rank" && (sortAsc ? "▴" : "▾")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("name")}>
                Team {sortBy === "name" && (sortAsc ? "▴" : "▾")}
              </th>
              <th className="elo" style={{ cursor: "pointer" }} onClick={() => handleSort("elo")}>
                Combined ELO {sortBy === "elo" && (sortAsc ? "▴" : "▾")}
              </th>
              <th className="record" style={{ cursor: "pointer" }} onClick={() => handleSort("matches")}>
                W – L {sortBy === "matches" && (sortAsc ? "▴" : "▾")}
              </th>
              <th className="winrate" style={{ cursor: "pointer" }} onClick={() => handleSort("winrate")}>
                Win Rate {sortBy === "winrate" && (sortAsc ? "▴" : "▾")}
              </th>
              <th>Top Rival</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((team) => {
              const rankIdx = globalRankMap.get(team.key)!;
              const totalTeams = eligible.length;
              const band = totalTeams >= 10 ? 5 : totalTeams >= 6 ? 2 : 1;
              const rank = rankIdx + 1;
              const rowClass =
                rank <= band ? "row-top" : rank > totalTeams - band ? "row-bottom" : "";
              return (
              <tr
                key={team.key}
                className={`clickable-row${rowClass ? ` ${rowClass}` : ""}`}
                onClick={() => onTeamClick(team)}
                style={{ borderLeft: `4px solid ${teamColor(team)}` }}
              >
                <td className="rank">
                  {MEDALS[globalRankMap.get(team.key)!] ??
                    `#${globalRankMap.get(team.key)! + 1}`}
                </td>
                <td className="name" style={{ padding: 0 }}>
                  <TeamTooltip
                    tooltipPlayers={teamPlayers(team)}
                    color={teamColor(team)}
                  >
                    <div style={{ padding: "1rem" }}>
                      <div>{getTeamDisplayName(team, players)}</div>
                      {(team.nameRow?.alias_1 || team.nameRow?.alias_2) && (
                        <div className="text-[0.75rem] text-text-light mt-0.5">
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
                <td className="winrate" style={{ color: winRateColor(team.winRate) }}>
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
                            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                            <span className="text-text-light">
                              {name} ({team.rivals[0].matchesPlayed}×)
                            </span>
                          </span>
                        </TeamTooltip>
                      );
                    })()
                  ) : (
                    <span style={{ padding: "1rem", display: "block" }} className="text-text-light">—</span>
                  )}
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      ) : sorted.length > 0 ? (
        <div className="grid gap-4 mt-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] max-[480px]:grid-cols-[1fr]">
          {sorted.map((team) => (
            <div
              key={team.key}
              className="bg-bg border border-border rounded-lg p-5 cursor-pointer transition-[box-shadow,border-color] hover:shadow-lg hover:border-primary"
              onClick={() => onTeamClick(team)}
              style={{ borderLeft: `4px solid ${teamColor(team)}` }}
            >
              <TeamTooltip tooltipPlayers={teamPlayers(team)} color={teamColor(team)}>
                <div className="font-bold text-base text-text mb-0.5">
                  {MEDALS[globalRankMap.get(team.key)!] && (
                    <span style={{ marginRight: "0.35rem" }}>
                      {MEDALS[globalRankMap.get(team.key)!]}
                    </span>
                  )}
                  {getTeamDisplayName(team, players)}
                </div>
                {(team.nameRow?.alias_1 || team.nameRow?.alias_2) && (
                  <div className="text-[0.75rem] text-text-light mb-3">
                    {[team.nameRow!.alias_1, team.nameRow!.alias_2].filter(Boolean).join(" · ")}
                  </div>
                )}
              </TeamTooltip>
              <div className="flex gap-4 items-baseline flex-wrap mt-2">
                <span className="text-[1.375rem] font-bold text-primary">{team.combinedElo}</span>
                <span className="text-[0.85rem] text-text-light">{team.wins} – {team.losses}</span>
                <span className="text-[0.85rem] font-semibold" style={{ color: winRateColor(team.winRate) }}>
                  {(team.winRate * 100).toFixed(0)}%
                </span>
              </div>
              {team.rivals[0] &&
                (() => {
                  const { name, color, rivalTeam } = rivalDisplay(team.rivals[0].key);
                  const rPlayers = rivalTeam ? teamPlayers(rivalTeam) : [];
                  return (
                    <TeamTooltip tooltipPlayers={rPlayers} color={color}>
                      <div className="flex items-center gap-1.5 mt-3 text-[0.75rem] text-text-light border-t border-border-light pt-2">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
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
