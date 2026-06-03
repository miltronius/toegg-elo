import { useMemo } from "react";

interface ActivityHeatmapProps {
  /** Per-day match counts (days with ≥1 match). */
  activity: { day: string; games: number }[];
  /** Inclusive calendar range to render (YYYY-MM-DD or ISO datetime). */
  start: string;
  end: string;
  /** First "official" day, highlighted in a distinct color (YYYY-MM-DD…). */
  firstDay?: string;
  /** Always render at least this many week columns (GitHub-style padding). */
  minWeeks?: number;
}

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days since the most recent Monday (Mon=0 … Sun=6). */
function mondayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

interface Cell {
  day: string;
  games: number;
  inRange: boolean;
}

/**
 * GitHub-style contribution graph of matches played: one square per day, weeks
 * as columns, Mon→Sun top to bottom. Square intensity scales with the busiest
 * day in scope. Pure presentational — counts are precomputed upstream.
 */
export function ActivityHeatmap({
  activity,
  start,
  end,
  firstDay,
  minWeeks = 13,
}: ActivityHeatmapProps) {
  const { weeks, monthLabels, maxGames } = useMemo(() => {
    const games = new Map(activity.map((a) => [a.day, a.games]));
    const startDate = new Date(start.slice(0, 10) + "T00:00:00Z");
    const endDate = new Date(end.slice(0, 10) + "T00:00:00Z");

    // Snap the grid start back to the Monday of the first week, then pad the
    // window backwards so it spans at least `minWeeks` columns (older days on
    // the left, the most recent week on the right — like GitHub/GitLab).
    const gridStart = new Date(startDate);
    gridStart.setUTCDate(gridStart.getUTCDate() - mondayIndex(startDate));
    const minStart = new Date(endDate);
    minStart.setUTCDate(
      minStart.getUTCDate() - mondayIndex(endDate) - (minWeeks - 1) * 7,
    );
    if (minStart < gridStart) gridStart.setTime(minStart.getTime());

    const weeks: Cell[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    let max = 0;
    let prevMonth = -1;

    const cursor = new Date(gridStart);
    while (cursor <= endDate) {
      const week: Cell[] = [];
      for (let i = 0; i < 7; i++) {
        const day = dayStr(cursor);
        const inRange = cursor >= startDate && cursor <= endDate;
        const g = inRange ? games.get(day) ?? 0 : 0;
        if (g > max) max = g;
        week.push({ day, games: g, inRange });
        if (i === 0) {
          const month = cursor.getUTCMonth();
          if (month !== prevMonth) {
            monthLabels.push({ col: weeks.length, label: MONTH_LABELS[month] });
            prevMonth = month;
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      weeks.push(week);
    }
    return { weeks, monthLabels, maxGames: max };
  }, [activity, start, end, minWeeks]);

  const level = (games: number): number => {
    if (games <= 0) return 0;
    if (maxGames <= 1) return 4;
    const ratio = games / maxGames;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-weekdays">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="heatmap-weekday">
            {label}
          </span>
        ))}
      </div>
      <div className="heatmap-main">
        <div className="heatmap-months">
          {monthLabels.map((m) => (
            <span
              key={`${m.label}-${m.col}`}
              className="heatmap-month"
              style={{ gridColumn: m.col + 1 }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <div className="heatmap-grid">
          {weeks.flat().map((cell) =>
            cell.inRange ? (
              <div
                key={cell.day}
                className="heatmap-cell"
                data-level={level(cell.games)}
                data-first={cell.day === firstDay?.slice(0, 10) ? "true" : undefined}
                title={`${cell.day} · ${cell.games} ${cell.games === 1 ? "game" : "games"}${
                  cell.day === firstDay?.slice(0, 10) ? " · first day" : ""
                }`}
              />
            ) : (
              <div key={cell.day} className="heatmap-cell heatmap-cell-empty" />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
