import { useTranslation } from "react-i18next";
import { DATE_LOCALE } from "../lib/i18n";
import type { GoalTally } from "../lib/goals";

/**
 * Goals scored : received, as a `stat-card`. Unscored games count the loser
 * as 0, so unless every game had its score entered the figures are only a
 * floor - said as "at least" rather than passed off as exact.
 */
export function GoalStatCard({ goals }: { goals: GoalTally }) {
  const { t } = useTranslation();
  const fmt = (n: number) => n.toLocaleString(DATE_LOCALE);
  return (
    <div
      className="stat-card"
      title={goals.exact ? undefined : t("goals.estimateHint")}
    >
      <div className="stat-label">{t("goals.label")}</div>
      <div className="stat-value" style={{ fontSize: "1.1rem" }}>
        {fmt(goals.scored)} : {fmt(goals.received)}
      </div>
      {!goals.exact && <div className="stat-sub">{t("goals.atLeast")}</div>}
    </div>
  );
}
