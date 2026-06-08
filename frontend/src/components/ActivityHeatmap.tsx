import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface ActivityHeatmapProps {
  /** Per-day match counts (days with ≥1 match). */
  activity: { day: string; games: number }[];
  /** Inclusive calendar range to render (YYYY-MM-DD or ISO datetime). */
  start: string;
  end: string;
  /** First "official" day, highlighted in a distinct color (YYYY-MM-DD…). */
  firstDay?: string;
  /** Render at least this many week columns before width-based expansion. */
  minWeeks?: number;
}

// Geometry, kept in sync with .heatmap-cell / .heatmap-grid in App.css.
const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;

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
 * GitHub-style contribution graph of matches played: one square per workday,
 * weeks as columns, Mon→Fri top to bottom. The most recent week sits at the far
 * right; columns expand to fill the available width. Days outside the in-range
 * window (e.g. after an ended season) render as inert greyed cells; future days
 * are not drawn at all. Pure presentational — counts are precomputed upstream.
 */
export function ActivityHeatmap({
  activity,
  start,
  end,
  firstDay,
  minWeeks = 13,
}: ActivityHeatmapProps) {
  const { t } = useTranslation();
  // Weekends are hidden by default — foosball happens on workdays — but can be
  // toggled on. Mon→Fri (5 rows) or Mon→Sun (7 rows).
  const allWeekdayLabels = t("heatmap.weekdays", { returnObjects: true }) as string[];
  const WEEKDAY_LABELS_FULL = allWeekdayLabels;
  const WEEKDAY_LABELS_WORKDAYS = allWeekdayLabels.slice(0, 5);
  const MONTH_LABELS = t("heatmap.months", { returnObjects: true }) as string[];
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  // Number of week columns that fit the widget's full width (0 until measured).
  const [fitWeeks, setFitWeeks] = useState(0);
  const [showWeekends, setShowWeekends] = useState(false);

  const weekdayLabels = showWeekends
    ? WEEKDAY_LABELS_FULL
    : WEEKDAY_LABELS_WORKDAYS;
  const rows = weekdayLabels.length; // 5 (Mon–Fri) or 7 (Mon–Sun)

  // Measure available width and derive how many columns fill it.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const labelsW = labelsRef.current?.offsetWidth ?? 0;
      // Leave room for the weekday labels + the flex gap between them and grid.
      const available = wrap.clientWidth - labelsW - 6;
      setFitWeeks(Math.max(1, Math.floor((available + GAP) / PITCH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const { weeks, monthLabels, maxGames } = useMemo(() => {
    const games = new Map(activity.map((a) => [a.day, a.games]));
    const startDate = new Date(start.slice(0, 10) + "T00:00:00Z");
    const endDate = new Date(end.slice(0, 10) + "T00:00:00Z");
    // Never draw past today — future days are omitted entirely.
    const today = new Date(dayStr(new Date()) + "T00:00:00Z");

    const columns = Math.max(minWeeks, fitWeeks);

    // The last column is always the current week; walk back enough Mondays to
    // fill `columns`, but extend further if the season started earlier.
    const gridStart = new Date(startDate);
    gridStart.setUTCDate(gridStart.getUTCDate() - mondayIndex(startDate));
    const minStart = new Date(today);
    minStart.setUTCDate(
      minStart.getUTCDate() - mondayIndex(today) - (columns - 1) * 7,
    );
    if (minStart < gridStart) gridStart.setTime(minStart.getTime());

    const weeks: Cell[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    let max = 0;
    let prevMonth = -1;
    let week: Cell[] = [];

    const cursor = new Date(gridStart); // always a Monday
    while (cursor <= today) {
      const idx = mondayIndex(cursor);
      if (idx === 0) {
        if (week.length) weeks.push(week);
        week = [];
        const month = cursor.getUTCMonth();
        if (month !== prevMonth) {
          monthLabels.push({ col: weeks.length, label: MONTH_LABELS[month] });
          prevMonth = month;
        }
      }
      if (idx < rows) {
        const day = dayStr(cursor);
        const inRange = cursor >= startDate && cursor <= endDate;
        const g = inRange ? games.get(day) ?? 0 : 0;
        if (g > max) max = g;
        week.push({ day, games: g, inRange });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (week.length) weeks.push(week);

    return { weeks, monthLabels, maxGames: max };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- MONTH_LABELS is stable per language; re-deriving on identity churn is unnecessary
  }, [activity, start, end, minWeeks, fitWeeks, rows]);

  // When the grid is wider than the widget, keep the most recent week in view.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  }, [weeks]);

  const level = (games: number): number => {
    if (games <= 0) return 0;
    if (maxGames <= 1) return 4;
    const ratio = games / maxGames;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  const rowsStyle = { gridTemplateRows: `repeat(${rows}, ${CELL}px)` };

  return (
    <div className="heatmap-container">
      <label className="heatmap-toggle">
        <span>{t("heatmap.showWeekends")}</span>
        <span className="heatmap-switch">
          <input
            type="checkbox"
            checked={showWeekends}
            onChange={(e) => setShowWeekends(e.target.checked)}
          />
          <span className="heatmap-switch-track">
            <span className="heatmap-switch-thumb" />
          </span>
        </span>
      </label>
      <div className="heatmap-wrap" ref={wrapRef}>
        <div className="heatmap-weekdays" ref={labelsRef} style={rowsStyle}>
          {weekdayLabels.map((label, i) => (
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
          <div className="heatmap-grid" style={rowsStyle}>
            {weeks.flat().map((cell) =>
              cell.inRange ? (
                <div
                  key={cell.day}
                  className="heatmap-cell"
                  data-level={level(cell.games)}
                  data-first={cell.day === firstDay?.slice(0, 10) ? "true" : undefined}
                  title={`${t("heatmap.cellTitle", { day: cell.day, count: cell.games })}${
                    cell.day === firstDay?.slice(0, 10) ? t("heatmap.firstDaySuffix") : ""
                  }`}
                />
              ) : (
                <div key={cell.day} className="heatmap-cell heatmap-cell-empty" />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
