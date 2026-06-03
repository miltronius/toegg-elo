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
import type { PlayerAchievementRow } from "../lib/achievements";
import { computeSeasonStats } from "../lib/seasonStats";
import { ActivityHeatmap } from "./ActivityHeatmap";

interface SeasonStatsProps {
  activeSeason: Season | null;
  seasons: Season[];
  matches: Match[];
  history: EloHistory[];
  players: Player[];
  achievements: PlayerAchievementRow[];
}

// Rough estimate: a 2v2 match takes about this long start to finish.
const MINUTES_PER_GAME = 17;

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
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
  achievements,
}: SeasonStatsProps) {
  const orderedSeasons = useMemo(
    () => [...seasons].sort((a, b) => b.number - a.number),
    [seasons],
  );
  const [scope, setScope] = useState<string>(activeSeason?.id ?? "all");

  const seasonId = scope === "all" ? null : scope;
  const stats = useMemo(() => {
    const season = seasonId ? seasons.find((s) => s.id === seasonId) : null;
    const bounds = season
      ? { startedAt: season.started_at, endedAt: season.ended_at }
      : null;
    return computeSeasonStats(
      seasonId,
      matches,
      history,
      players,
      achievements,
      bounds,
    );
  }, [seasonId, seasons, matches, history, players, achievements]);

  const maxWeekday = Math.max(1, ...stats.weekday.map((w) => w.games));

  // Date range: for a season use its official start/end (ongoing → today);
  // for all-time fall back to the first/last day with a match.
  const season = seasonId ? seasons.find((s) => s.id === seasonId) : null;
  const today = new Date().toISOString().slice(0, 10);
  const range = season
    ? {
        start: season.started_at.slice(0, 10),
        end: (season.ended_at ?? today).slice(0, 10),
      }
    : stats.dateRange;

  // The heatmap runs up to the most recent relevant day (today for all-time and
  // ongoing seasons; the season's end otherwise) so current days sit far-right.
  const heatmapRange = range
    ? {
        start: range.start,
        end: season ? (season.ended_at ?? today).slice(0, 10) : today,
      }
    : null;

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

      {range && (
        <div className="season-stats-daterange">
          📅 {formatDay(range.start)} – {formatDay(range.end)}
          {season && !season.ended_at ? " (active)" : ""}
        </div>
      )}

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
            {stats.topLoseStreak && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  🥶 {stats.topLoseStreak.streak}
                </div>
                <div className="season-stat-label">
                  Longest lose streak · {stats.topLoseStreak.name}
                </div>
              </div>
            )}
            {stats.bestDayGain && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  +{stats.bestDayGain.gain}
                  <span className="season-stat-unit"> Elo</span>
                </div>
                <div className="season-stat-label">
                  Best day · {stats.bestDayGain.name} ·{" "}
                  {formatDay(stats.bestDayGain.day)}
                </div>
              </div>
            )}
            {stats.biggestWin && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  +{stats.biggestWin.gain}
                  <span className="season-stat-unit"> Elo</span>
                </div>
                <div className="season-stat-label">
                  Biggest single win · {stats.biggestWin.name}
                </div>
              </div>
            )}
            {stats.biggestLoss && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  −{stats.biggestLoss.drop}
                  <span className="season-stat-unit"> Elo</span>
                </div>
                <div className="season-stat-label">
                  Biggest single loss · {stats.biggestLoss.name}
                </div>
              </div>
            )}
            {stats.worstDayDrop && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  −{stats.worstDayDrop.drop}
                  <span className="season-stat-unit"> Elo</span>
                </div>
                <div className="season-stat-label">
                  Worst day · {stats.worstDayDrop.name} ·{" "}
                  {formatDay(stats.worstDayDrop.day)}
                </div>
              </div>
            )}
            {stats.highestElo && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  📈 {stats.highestElo.elo}
                </div>
                <div className="season-stat-label">
                  Highest Elo · {stats.highestElo.name}
                </div>
              </div>
            )}
            {stats.lowestElo && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  📉 {stats.lowestElo.elo}
                </div>
                <div className="season-stat-label">
                  Lowest Elo · {stats.lowestElo.name}
                </div>
              </div>
            )}
            {stats.busiestDay && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  {stats.busiestDay.games}
                  <span className="season-stat-unit">
                    {stats.busiestDay.games === 1 ? " game" : " games"}
                  </span>
                </div>
                <div className="season-stat-label">
                  Busiest day · {formatDay(stats.busiestDay.day)}
                </div>
              </div>
            )}
            {stats.winRateLeader && (
              <div className="season-stat-tile">
                <div className="season-stat-value">
                  {stats.winRateLeader.winrate.toFixed(0)}%
                </div>
                <div className="season-stat-label">
                  Win-rate leader ({stats.winRateLeader.minGames}+ games) ·{" "}
                  {stats.winRateLeader.name}
                </div>
              </div>
            )}
            <div className="season-stat-tile">
              <div className="season-stat-value">
                {stats.achievementsUnlocked}
              </div>
              <div className="season-stat-label">
                {scope === "all"
                  ? "Achievements unlocked in total"
                  : "Achievements unlocked this season"}
              </div>
            </div>
            <div className="season-stat-tile">
              <div className="season-stat-value">
                {formatDuration(stats.gamesPlayed * MINUTES_PER_GAME)}
              </div>
              <div className="season-stat-label">
                Est. time played · ~{MINUTES_PER_GAME}min/game
              </div>
            </div>
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
                <YAxis allowDecimals={false} domain={[0, maxWeekday + 1]} />
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

          {heatmapRange && (
            <div className="season-stats-chart">
              <div className="season-stats-subhead">Daily Activity Heatmap</div>
              <ActivityHeatmap
                activity={stats.activity}
                start={heatmapRange.start}
                end={heatmapRange.end}
                firstDay={range?.start}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
