import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
} from "recharts";
import type { Season, Match, Player, EloHistory } from "../lib/supabase";
import { computeSeasonStats } from "../lib/seasonStats";

interface SeasonStatsProps {
  activeSeason: Season | null;
  seasons: Season[];
  matches: Match[];
  history: EloHistory[];
  players: Player[];
}

function formatDay(day: string): string {
  return new Date(day + "T12:00:00Z").toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function SeasonStats({
  activeSeason,
  seasons,
  matches,
  history,
  players,
}: SeasonStatsProps) {
  const orderedSeasons = useMemo(
    () => [...seasons].sort((a, b) => b.number - a.number),
    [seasons],
  );
  const [scope, setScope] = useState<string>(activeSeason?.id ?? "all");

  const seasonId = scope === "all" ? null : scope;
  const stats = useMemo(
    () => computeSeasonStats(seasonId, matches, history, players),
    [seasonId, matches, history, players],
  );

  const maxWeekday = Math.max(1, ...stats.weekday.map((w) => w.games));

  return (
    <div className="season-stats">
      <div className="season-stats-head">
        <span className="season-stats-title">📊 Statistics</span>
        <select
          className="season-stats-select"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">All-time</option>
          {orderedSeasons.map((s) => (
            <option key={s.id} value={s.id}>
              S{s.number} · {s.name}
            </option>
          ))}
        </select>
      </div>

      {stats.gamesPlayed === 0 ? (
        <p className="text-text-light text-[0.85rem] py-3 text-center">
          No matches recorded {scope === "all" ? "yet" : "this season"}.
        </p>
      ) : (
        <>
          <div className="season-stats-grid">
            <div className="season-stat-tile">
              <div className="season-stat-value">{stats.gamesPlayed}</div>
              <div className="season-stat-label">Games played</div>
            </div>
            <div className="season-stat-tile">
              <div className="season-stat-value">{stats.activePlayers}</div>
              <div className="season-stat-label">Active players</div>
            </div>
            {stats.topStreak && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  🔥 {stats.topStreak.streak}
                </div>
                <div className="season-stat-label">
                  Longest win streak · {stats.topStreak.name}
                </div>
              </div>
            )}
            {stats.bestDayGain && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  +{stats.bestDayGain.gain}
                </div>
                <div className="season-stat-label">
                  Best day · {stats.bestDayGain.name} ·{" "}
                  {formatDay(stats.bestDayGain.day)}
                </div>
              </div>
            )}
            {stats.biggestWin && (
              <div className="season-stat-tile">
                <div className="season-stat-value">+{stats.biggestWin.gain}</div>
                <div className="season-stat-label">
                  Biggest single win · {stats.biggestWin.name}
                </div>
              </div>
            )}
            {stats.busiestDay && (
              <div className="season-stat-tile">
                <div className="season-stat-value">{stats.busiestDay.games}</div>
                <div className="season-stat-label">
                  Busiest day · {formatDay(stats.busiestDay.day)}
                </div>
              </div>
            )}
          </div>

          <div className="season-stats-chart">
            <div className="season-stats-subhead">Games by weekday</div>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart
                data={stats.weekday}
                margin={{ top: 8, right: 8, bottom: 0, left: -24 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickLine={false} />
                <YAxis allowDecimals={false} domain={[0, maxWeekday]} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.05)" }}
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--bump-grid)",
                    borderRadius: 8,
                    color: "var(--color-text)",
                    fontSize: "0.8rem",
                  }}
                  labelStyle={{ color: "var(--color-text)" }}
                  itemStyle={{ color: "var(--color-text)" }}
                  formatter={(v) => [v as number, "Games"]}
                />
                <Bar
                  dataKey="games"
                  name="Games"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                >
                  <LabelList
                    dataKey="games"
                    position="top"
                    fill="var(--color-text)"
                    fontSize={12}
                    fontWeight={700}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
