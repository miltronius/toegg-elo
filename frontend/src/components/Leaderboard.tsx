import { useState, useRef, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Player, EloHistory, Season, PlayerSeasonStats } from "../lib/supabase";

interface LeaderboardProps {
  players: Player[];
  history: EloHistory[];
  seasons?: Season[];
  selectedSeason?: Season | null;
  onSeasonSelect?: (season: Season | null) => void;
  playerSeasonStats?: PlayerSeasonStats[];
  onPlayerClick?: (player: Player) => void;
}

interface Snapshot {
  player_id: string;
  elo: number;
  rank: number;
  match_index: number;
}

const playerColor = (i: number, total: number) =>
  `hsl(${Math.round((i / Math.max(total, 1)) * 360)}, 85%, 60%)`;

function buildSnapshots(players: Player[], history: EloHistory[]): Snapshot[] {
  if (!history.length) return [];
  const sorted = [...history].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const matchOrder: string[] = [];
  const byMatch: Record<string, EloHistory[]> = {};
  for (const h of sorted) {
    if (!byMatch[h.match_id]) {
      byMatch[h.match_id] = [];
      matchOrder.push(h.match_id);
    }
    byMatch[h.match_id].push(h);
  }
  const currentElo: Record<string, number> = {};
  const firstSeen: Record<string, boolean> = {};
  for (const h of sorted) {
    if (!firstSeen[h.player_id]) {
      currentElo[h.player_id] = h.elo_before;
      firstSeen[h.player_id] = true;
    }
  }
  players.forEach((p) => {
    if (currentElo[p.id] === undefined) currentElo[p.id] = p.current_elo;
  });

  const snapshots: Snapshot[] = [];
  matchOrder.forEach((matchId, matchIdx) => {
    for (const h of byMatch[matchId]) currentElo[h.player_id] = h.elo_after;
    const ranked = [...players]
      .map((p) => ({ id: p.id, elo: currentElo[p.id] ?? p.current_elo }))
      .sort((a, b) => b.elo - a.elo);
    ranked.forEach(({ id, elo }, i) =>
      snapshots.push({
        player_id: id,
        elo,
        rank: i + 1,
        match_index: matchIdx,
      }),
    );
  });
  return snapshots;
}

function buildPath(
  playerId: string,
  matchIndices: number[],
  snapshots: Snapshot[],
  xScale: (m: number) => number,
  yScale: (r: number) => number,
): string {
  const pts = matchIndices
    .map((m) =>
      snapshots.find((s) => s.player_id === playerId && s.match_index === m),
    )
    .filter(Boolean) as Snapshot[];
  if (pts.length < 2) return "";
  return pts
    .map((pt, i) => {
      const x = xScale(pt.match_index),
        y = yScale(pt.rank);
      if (i === 0) return `M ${x} ${y}`;
      const prev = pts[i - 1];
      const cx = (xScale(prev.match_index) + x) / 2;
      return `C ${cx} ${yScale(prev.rank)}, ${cx} ${y}, ${x} ${y}`;
    })
    .join(" ");
}

function buildEloProgressionData(
  players: Player[],
  history: EloHistory[],
): Record<string, number | string>[] {
  if (!history.length) return [];
  const sorted = [...history].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const matchOrder: string[] = [];
  const byMatch: Record<string, EloHistory[]> = {};
  for (const h of sorted) {
    if (!byMatch[h.match_id]) {
      byMatch[h.match_id] = [];
      matchOrder.push(h.match_id);
    }
    byMatch[h.match_id].push(h);
  }
  const currentElo: Record<string, number> = {};
  const firstSeen: Record<string, boolean> = {};
  for (const h of sorted) {
    if (!firstSeen[h.player_id]) {
      currentElo[h.player_id] = h.elo_before;
      firstSeen[h.player_id] = true;
    }
  }
  players.forEach((p) => {
    if (currentElo[p.id] === undefined) currentElo[p.id] = p.current_elo;
  });

  const startPoint: Record<string, number | string> = { label: "Start" };
  players.forEach((p) => {
    startPoint[p.name] = currentElo[p.id] ?? p.current_elo;
  });
  const data: Record<string, number | string>[] = [startPoint];

  matchOrder.forEach((matchId, idx) => {
    for (const h of byMatch[matchId]) currentElo[h.player_id] = h.elo_after;
    const point: Record<string, number | string> = { label: `M${idx + 1}` };
    players.forEach((p) => {
      point[p.name] = currentElo[p.id] ?? p.current_elo;
    });
    data.push(point);
  });
  return data;
}

function buildEloProgressionDataByDate(
  players: Player[],
  history: EloHistory[],
): Record<string, number | string>[] {
  if (!history.length) return [];
  const sorted = [...history].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const currentElo: Record<string, number> = {};
  const firstSeen: Record<string, boolean> = {};
  for (const h of sorted) {
    if (!firstSeen[h.player_id]) {
      currentElo[h.player_id] = h.elo_before;
      firstSeen[h.player_id] = true;
    }
  }
  players.forEach((p) => {
    if (currentElo[p.id] === undefined) currentElo[p.id] = p.current_elo;
  });

  const startPoint: Record<string, number | string> = { label: "Start" };
  players.forEach((p) => {
    startPoint[p.name] = currentElo[p.id] ?? p.current_elo;
  });
  const data: Record<string, number | string>[] = [startPoint];

  // Group matches by date, preserving chronological order
  const dateOrder: string[] = [];
  const byDate: Record<string, EloHistory[]> = {};
  for (const h of sorted) {
    const date = new Date(h.created_at).toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    if (!byDate[date]) {
      byDate[date] = [];
      dateOrder.push(date);
    }
    byDate[date].push(h);
  }

  dateOrder.forEach((date) => {
    for (const h of byDate[date]) currentElo[h.player_id] = h.elo_after;
    const point: Record<string, number | string> = { label: date };
    players.forEach((p) => {
      point[p.name] = currentElo[p.id] ?? p.current_elo;
    });
    data.push(point);
  });
  return data;
}

export function Leaderboard({
  players,
  history,
  seasons,
  selectedSeason,
  onSeasonSelect,
  playerSeasonStats,
  onPlayerClick,
}: LeaderboardProps) {
  const [view, setView] = useState<"table" | "bump" | "elo">("table");

  // null selectedSeason = All-Time view
  const isSeasonView = selectedSeason != null;

  // Build a map of season ELO per player for quick lookup
  const seasonStatsMap = new Map(
    (playerSeasonStats ?? []).map((s) => [s.player_id, s]),
  );

  // In season view: override current_elo with the season ELO and wins/losses with season values
  const effectivePlayers = players.map((p) => {
    if (isSeasonView && seasonStatsMap.has(p.id)) {
      const s = seasonStatsMap.get(p.id)!;
      return { ...p, current_elo: s.current_season_elo, wins: s.wins, losses: s.losses, matches_played: s.wins + s.losses };
    }
    return p;
  });

  // In season view: filter history to the selected season only
  const effectiveHistory =
    isSeasonView && selectedSeason
      ? history.filter((h) => (h as { season_id?: string }).season_id === selectedSeason.id)
      : history;
  const [sortBy, setSortBy] = useState<"elo" | "name" | "winrate">("elo");
  const [sortAsc, setSortAsc] = useState(false);
  const [show1500Sep, setShow1500Sep] = useState(true);
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [eloXAxis, setEloXAxis] = useState<"date" | "game">("date");
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    player: Player;
    snap: Snapshot;
  } | null>(null);
  const [svgWidth, setSvgWidth] = useState(0);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    const measure = () => setSvgWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [view]);

  const visiblePlayers = showOnlyActive
    ? effectivePlayers.filter((p) => p.matches_played > 0)
    : effectivePlayers;

  const anyAtStartingElo = visiblePlayers.some((p) => p.current_elo === 1500);

  // sortedPlayers is always ELO desc — used for charts and color assignment
  const sortedPlayers = [...visiblePlayers].sort(
    (a, b) => b.current_elo - a.current_elo,
  );

  const handleSort = (key: "elo" | "name" | "winrate") => {
    if (sortBy === key) setSortAsc((a) => !a);
    else { setSortBy(key); setSortAsc(false); }
  };

  const tableRows = [...sortedPlayers].sort((a, b) => {
    const winrateOf = (p: Player) => {
      const t = p.wins + p.losses;
      return t > 0 ? p.wins / t : 0;
    };
    let diff = 0;
    if (sortBy === "elo") diff = b.current_elo - a.current_elo;
    else if (sortBy === "name") diff = a.name.localeCompare(b.name);
    else diff = winrateOf(b) - winrateOf(a);
    return sortAsc ? -diff : diff;
  });
  const snapshots = buildSnapshots(visiblePlayers, effectiveHistory);
  const eloData = buildEloProgressionData(visiblePlayers, effectiveHistory);
  const eloDateData = buildEloProgressionDataByDate(visiblePlayers, effectiveHistory);
  const matchIndices = [...new Set(snapshots.map((s) => s.match_index))].sort(
    (a, b) => a - b,
  );
  const nPlayers = players.length;

  // Responsive padding: smaller right pad on mobile (no name labels, just dots)
  const isMobile = svgWidth > 0 && svgWidth < 480;
  const PAD = {
    top: isMobile ? 32 : 44,
    right: isMobile ? 16 : 110,
    bottom: isMobile ? 32 : 44,
    left: isMobile ? 28 : 44,
  };

  const chartH = Math.max(
    isMobile ? 220 : 280,
    nPlayers * (isMobile ? 44 : 56),
  );
  const innerW = Math.max(10, (svgWidth || 600) - PAD.left - PAD.right);
  const innerH = chartH - PAD.top - PAD.bottom;

  const matchFirst = matchIndices[0] ?? 0;
  const matchLast = matchIndices.at(-1) ?? 1;
  const padLeft = PAD.left;
  const padTop = PAD.top;

  const xScale = useCallback(
    (m: number) =>
      padLeft + ((m - matchFirst) / (matchLast - matchFirst || 1)) * innerW,
    [matchFirst, matchLast, innerW, padLeft],
  );
  const yScale = useCallback(
    (rank: number) => padTop + ((rank - 1) / (nPlayers - 1 || 1)) * innerH,
    [nPlayers, innerH, padTop],
  );

  if (players.length === 0) {
    return (
      <div className="card">
        <h2>Leaderboard</h2>
        <p className="empty-state">
          No players yet. Create a player to get started!
        </p>
      </div>
    );
  }

  return (
    <div
      className={`card leaderboard-card${view !== "table" ? " lb-expanded" : ""}`}
    >
      {/* ── Header ── */}
      <div className="lb-header">
        <h2>Leaderboard</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(seasons ?? []).length > 0 && (
            <select
              className="season-select"
              value={selectedSeason?.id ?? "alltime"}
              onChange={(e) => {
                if (e.target.value === "alltime") {
                  onSeasonSelect?.(null);
                } else {
                  const s = (seasons ?? []).find((s) => s.id === e.target.value) ?? null;
                  onSeasonSelect?.(s);
                }
              }}
            >
              <option value="alltime">All-Time</option>
              {(seasons ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  S{s.number} · {s.name}{s.is_active ? " ★" : ""}
                </option>
              ))}
            </select>
          )}
          {!anyAtStartingElo && (
            <div className="lb-toggle">
              <button
                className={`lb-toggle-btn${show1500Sep ? " active" : ""}`}
                onClick={() => setShow1500Sep((v) => !v)}
              >
                Starting Elo Line
              </button>
            </div>
          )}
          <div className="lb-toggle">
            <button
              className={`lb-toggle-btn${showOnlyActive ? " active" : ""}`}
              onClick={() => setShowOnlyActive((v) => !v)}
            >
              Active only
            </button>
          </div>
          <div className="lb-toggle">
            <button
              className={`lb-toggle-btn${view === "table" ? " active" : ""}`}
              onClick={() => setView("table")}
            >
              <TableIcon /> Table
            </button>
            <button
              className={`lb-toggle-btn${view === "elo" ? " active" : ""}`}
              onClick={() => setView("elo")}
              disabled={eloData.length === 0}
              title={eloData.length === 0 ? "No match history yet" : undefined}
            >
              <EloIcon /> ELO Chart
            </button>
            <button
              className={`lb-toggle-btn${view === "bump" ? " active" : ""}`}
              onClick={() => setView("bump")}
              disabled={snapshots.length === 0}
              title={snapshots.length === 0 ? "No match history yet" : undefined}
            >
              <BumpIcon /> Bump Chart (rank)
            </button>
          </div>
        </div>
      </div>

      {/* ── TABLE VIEW — identical to your original ── */}
      {view === "table" && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("name")}>
                Name {sortBy === "name" && (sortAsc ? "▴" : "▾")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("elo")}>
                ELO {sortBy === "elo" && (sortAsc ? "▴" : "▾")}
              </th>
              <th className="winrate" style={{ cursor: "pointer" }} onClick={() => handleSort("winrate")}>
                Winrate {sortBy === "winrate" && (sortAsc ? "▴" : "▾")}
              </th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const show1500Line = show1500Sep && sortBy === "elo" && !anyAtStartingElo;
              return tableRows.flatMap((player, idx) => {
                const total = player.wins + player.losses;
                const winrate =
                  total > 0 ? ((player.wins / total) * 100).toFixed(1) : "0";
                const rank = sortedPlayers.findIndex((p) => p.id === player.id) + 1;
                const playerCount = sortedPlayers.length;
                const band = playerCount >= 10 ? 5 : playerCount >= 6 ? 2 : 1;
                const rowClass =
                  rank <= band ? "row-top" : rank > playerCount - band ? "row-bottom" : "";
                const row = (
                  <tr
                    key={player.id}
                    onClick={() => onPlayerClick?.(player)}
                    className={`clickable-row${rowClass ? ` ${rowClass}` : ""}`}
                  >
                    <td className="rank">#{rank}</td>
                    <td className="name">{player.name}</td>
                    <td className="elo">{player.current_elo}</td>
                    <td className="winrate">{winrate}%</td>
                  </tr>
                );
                const next = tableRows[idx + 1];
                const insertLine =
                  show1500Line &&
                  next &&
                  ((player.current_elo > 1500 && next.current_elo < 1500) ||
                    (player.current_elo < 1500 && next.current_elo > 1500));
                return insertLine
                  ? [row, <tr key="sep-1500" className="elo-1500-sep"><td colSpan={4} /></tr>]
                  : [row];
              });
            })()}
          </tbody>
        </table>
      )}

      {/* ── BUMP CHART VIEW ── */}
      {view === "bump" && (
        <div className="bump-chart-wrap">
          {/* Legend — wraps naturally on small screens */}
          <div className="bump-legend">
            {sortedPlayers.map((p, i) => (
              <button
                key={p.id}
                className="bump-legend-btn"
                style={{
                  opacity: hovered && hovered !== p.id ? 0.28 : 1,
                  borderColor:
                    hovered === p.id
                      ? playerColor(i, sortedPlayers.length)
                      : undefined,
                }}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onPlayerClick?.(p)}
              >
                <span
                  className="bump-legend-dot"
                  style={{ background: playerColor(i, sortedPlayers.length) }}
                />
                {p.name}
              </button>
            ))}
          </div>

          {/* SVG container — fills full card width */}
          <div ref={svgContainerRef} className="bump-svg-container">
            {svgWidth > 0 && (
              <svg
                width={svgWidth}
                height={chartH}
                style={{ display: "block" }}
                onMouseLeave={() => {
                  setHovered(null);
                  setTooltip(null);
                }}
              >
                {/* Rank grid lines + left labels */}
                {Array.from({ length: nPlayers }, (_, i) => (
                  <g key={i}>
                    <line
                      x1={PAD.left}
                      x2={svgWidth - PAD.right}
                      y1={yScale(i + 1)}
                      y2={yScale(i + 1)}
                      stroke="var(--bump-grid)"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD.left - 6}
                      y={yScale(i + 1)}
                      className="bump-axis-label"
                      textAnchor="end"
                      dominantBaseline="middle"
                    >
                      #{i + 1}
                    </text>
                  </g>
                ))}

                {/* X-axis match labels — fewer on mobile */}
                {matchIndices
                  .filter((_, i) => {
                    const maxLabels = isMobile ? 5 : 10;
                    return (
                      i %
                        Math.max(
                          1,
                          Math.ceil(matchIndices.length / maxLabels),
                        ) ===
                        0 || i === matchIndices.length - 1
                    );
                  })
                  .map((m) => (
                    <text
                      key={m}
                      x={xScale(m)}
                      y={chartH - 8}
                      className="bump-axis-label"
                      textAnchor="middle"
                    >
                      M{m + 1}
                    </text>
                  ))}

                {/* Paths */}
                {sortedPlayers.map((player, i) => {
                  const color = playerColor(i, sortedPlayers.length);
                  const dimmed = hovered && hovered !== player.id;
                  const active = hovered === player.id;
                  const d = buildPath(
                    player.id,
                    matchIndices,
                    snapshots,
                    xScale,
                    yScale,
                  );
                  if (!d) return null;
                  return (
                    <path
                      key={player.id}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={active ? 3.5 : isMobile ? 1.5 : 2}
                      strokeOpacity={dimmed ? 0.07 : active ? 1 : 0.5}
                      strokeLinecap="round"
                      style={{
                        transition: "stroke-opacity 0.2s, stroke-width 0.15s",
                        cursor: "pointer",
                      }}
                      onMouseEnter={() => setHovered(player.id)}
                    />
                  );
                })}

                {/* Dots — smaller on mobile */}
                {sortedPlayers.map((player, i) => {
                  const color = playerColor(i, sortedPlayers.length);
                  const dimmed = hovered && hovered !== player.id;
                  const active = hovered === player.id;
                  return matchIndices.map((m) => {
                    const snap = snapshots.find(
                      (s) => s.player_id === player.id && s.match_index === m,
                    );
                    if (!snap) return null;
                    const baseR = isMobile ? 2.5 : 3.5;
                    return (
                      <circle
                        key={`${player.id}-${m}`}
                        cx={xScale(snap.match_index)}
                        cy={yScale(snap.rank)}
                        r={active ? baseR + 2 : baseR}
                        fill={color}
                        fillOpacity={dimmed ? 0.06 : active ? 1 : 0.65}
                        style={{
                          cursor: "pointer",
                          transition: "r 0.15s, fill-opacity 0.2s",
                        }}
                        onMouseEnter={() => {
                          setHovered(player.id);
                          setTooltip({
                            x: xScale(snap.match_index),
                            y: yScale(snap.rank),
                            player,
                            snap,
                          });
                        }}
                        onMouseLeave={() => {
                          setHovered(null);
                          setTooltip(null);
                        }}
                      />
                    );
                  });
                })}

                {/* Right-side name labels — hidden on mobile (legend covers it) */}
                {!isMobile &&
                  sortedPlayers.map((player, i) => {
                    const last = matchIndices.at(-1);
                    const snap = snapshots.find(
                      (s) =>
                        s.player_id === player.id && s.match_index === last,
                    );
                    if (!snap) return null;
                    const color = playerColor(i, sortedPlayers.length);
                    const dimmed = hovered && hovered !== player.id;
                    return (
                      <text
                        key={player.id}
                        x={svgWidth - PAD.right + 8}
                        y={yScale(snap.rank)}
                        fill={color}
                        fontSize={12}
                        fontWeight={hovered === player.id ? 800 : 500}
                        dominantBaseline="middle"
                        fillOpacity={dimmed ? 0.18 : 1}
                        style={{
                          transition: "fill-opacity 0.2s",
                          cursor: "pointer",
                        }}
                        onClick={() => onPlayerClick(player)}
                      >
                        {player.name}
                      </text>
                    );
                  })}

                {/* Tooltip — flips left if near right edge, up if near bottom */}
                {tooltip &&
                  (() => {
                    const pi = sortedPlayers.findIndex(
                      (p) => p.id === tooltip.player.id,
                    );
                    const color = playerColor(pi, sortedPlayers.length);
                    const tipW = 148,
                      tipH = 50;
                    const tx =
                      tooltip.x + 12 + tipW > svgWidth
                        ? tooltip.x - tipW - 12
                        : tooltip.x + 12;
                    const ty =
                      tooltip.y - tipH - 8 < 0
                        ? tooltip.y + 8
                        : tooltip.y - tipH - 8;
                    return (
                      <g style={{ pointerEvents: "none" }}>
                        <rect
                          x={tx}
                          y={ty}
                          width={tipW}
                          height={tipH}
                          rx={7}
                          fill="var(--tooltip-bg)"
                          stroke={color}
                          strokeWidth={1}
                          strokeOpacity={0.6}
                          style={{
                            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.12))",
                          }}
                        />
                        <text
                          x={tx + 10}
                          y={ty + 17}
                          fill={color}
                          fontSize={12}
                          fontWeight={700}
                        >
                          {tooltip.player.name}
                        </text>
                        <text
                          x={tx + 10}
                          y={ty + 34}
                          fill="var(--tooltip-sub)"
                          fontSize={11}
                        >
                          ELO {tooltip.snap.elo} · Rank #{tooltip.snap.rank} · M
                          {tooltip.snap.match_index + 1}
                        </text>
                      </g>
                    );
                  })()}
              </svg>
            )}
          </div>

          <p className="bump-hint">
            {isMobile
              ? "Tap a line to highlight"
              : "Hover a line or dot to highlight · click a name to view player"}
          </p>
        </div>
      )}
      {/* ── ELO PROGRESSION CHART VIEW ── */}
      {view === "elo" && (
        <div className="bump-chart-wrap">
          <div className="lb-toggle" style={{ width: "fit-content", marginBottom: "12px" }}>
            <button
              className={`lb-toggle-btn${eloXAxis === "date" ? " active" : ""}`}
              onClick={() => setEloXAxis("date")}
            >
              Per Date
            </button>
            <button
              className={`lb-toggle-btn${eloXAxis === "game" ? " active" : ""}`}
              onClick={() => setEloXAxis("game")}
            >
              Per Game
            </button>
          </div>
          <div className="bump-legend">
            {sortedPlayers.map((p, i) => (
              <button
                key={p.id}
                className="bump-legend-btn"
                style={{
                  opacity: hovered && hovered !== p.id ? 0.28 : 1,
                  borderColor:
                    hovered === p.id
                      ? playerColor(i, sortedPlayers.length)
                      : undefined,
                }}
                onMouseEnter={() => setHovered(p.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onPlayerClick?.(p)}
              >
                <span
                  className="bump-legend-dot"
                  style={{ background: playerColor(i, sortedPlayers.length) }}
                />
                {p.name}
              </button>
            ))}
          </div>

          <div
            style={{
              width: "100%",
              height: Math.max(320, nPlayers * 48),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={eloXAxis === "date" ? eloDateData : eloData}
                margin={{ top: 12, right: 110, bottom: 8, left: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--bump-grid)"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 11 }}
                  width={48}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  itemSorter={(item) => -(item.value as number)}
                />
                <ReferenceLine
                  y={1500}
                  stroke="#aaa"
                  strokeDasharray="4 4"
                  label={{
                    value: "1500",
                    position: "insideBottomRight",
                    fontSize: 10,
                    fill: "#aaa",
                  }}
                />
                {sortedPlayers.map((p, i) => {
                  const color = playerColor(i, sortedPlayers.length);
                  const dimmed = !!(hovered && hovered !== p.id);
                  return (
                    <Line
                      key={p.id}
                      type="monotone"
                      dataKey={p.name}
                      stroke={color}
                      strokeWidth={hovered === p.id ? 3 : 1.5}
                      strokeOpacity={dimmed ? 0.12 : 1}
                      dot={false}
                      activeDot={{ r: 4 }}
                      label={
                        <EloLineLabel
                          dataLength={eloXAxis === "date" ? eloDateData.length : eloData.length}
                          playerName={p.name}
                          color={color}
                          dimmed={dimmed}
                        />
                      }
                      onMouseEnter={() => setHovered(p.id)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="bump-hint">
            {isMobile
              ? "Tap a line to highlight"
              : "Hover a line to highlight · click a name to view player"}
          </p>
        </div>
      )}
    </div>
  );
}

function TableIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="2.5" rx="1" />
      <rect x="1" y="6.5" width="14" height="2.5" rx="1" />
      <rect x="1" y="11" width="14" height="2.5" rx="1" />
    </svg>
  );
}

interface EloLineLabelProps {
  x?: number;
  y?: number;
  index?: number;
  dataLength: number;
  playerName: string;
  color: string;
  dimmed: boolean;
}

function EloLineLabel({
  x = 0,
  y = 0,
  index = 0,
  dataLength,
  playerName,
  color,
  dimmed,
}: EloLineLabelProps) {
  if (index !== dataLength - 1) return null;
  return (
    <text
      x={x + 8}
      y={y}
      fill={color}
      fontSize={12}
      fontWeight={500}
      dominantBaseline="middle"
      fillOpacity={dimmed ? 0.18 : 1}
      style={{ transition: "fill-opacity 0.2s" }}
    >
      {playerName}
    </text>
  );
}

function EloIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <polyline points="1,13 5,8 9,10 13,4" />
      <line x1="1" y1="13" x2="15" y2="13" strokeWidth={1} />
    </svg>
  );
}

function BumpIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <polyline points="1,13 4,6 8,10 12,3 15,5" />
    </svg>
  );
}
