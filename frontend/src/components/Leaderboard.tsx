import { useState, useRef, useEffect, useCallback } from "react";
import { Player, EloHistory } from "../lib/supabase";

interface LeaderboardProps {
  players: Player[];
  history: EloHistory[];
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

export function Leaderboard({
  players,
  history,
  onPlayerClick,
}: LeaderboardProps) {
  const [view, setView] = useState<"table" | "bump">("table");
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

  const sortedPlayers = [...players].sort(
    (a, b) => b.current_elo - a.current_elo,
  );
  const snapshots = buildSnapshots(players, history);
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
      className={`card leaderboard-card${view === "bump" ? " lb-expanded" : ""}`}
    >
      {/* ── Header ── */}
      <div className="lb-header">
        <h2>Leaderboard</h2>
        <div className="lb-toggle">
          <button
            className={`lb-toggle-btn${view === "table" ? " active" : ""}`}
            onClick={() => setView("table")}
          >
            <TableIcon /> Table
          </button>
          <button
            className={`lb-toggle-btn${view === "bump" ? " active" : ""}`}
            onClick={() => setView("bump")}
            disabled={snapshots.length === 0}
            title={snapshots.length === 0 ? "No match history yet" : undefined}
          >
            <BumpIcon /> Bump Chart
          </button>
        </div>
      </div>

      {/* ── TABLE VIEW — identical to your original ── */}
      {view === "table" && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Elo</th>
              <th className="winrate">Winrate</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player, index) => {
              const total = player.wins + player.losses;
              const winrate =
                total > 0 ? ((player.wins / total) * 100).toFixed(1) : "0";
              return (
                <tr
                  key={player.id}
                  onClick={() => onPlayerClick?.(player)}
                  className="clickable-row"
                >
                  <td className="rank">#{index + 1}</td>
                  <td className="name">{player.name}</td>
                  <td className="elo">{player.current_elo}</td>
                  <td className="winrate">{winrate}%</td>
                </tr>
              );
            })}
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
