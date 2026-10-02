import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Season, SeasonVotingSchedule } from "../lib/supabase";
import { SWISS_DATETIME_FORMAT, maskSwissDateTime, toSwissDateTime } from "../lib/banners";
import { DATE_LOCALE } from "../lib/i18n";
import {
  AWARD_VOTING_LEAD_DAYS,
  AWARD_VOTING_TAIL_DAYS,
  awardErrorKey,
  awardVotingStatus,
  awardVotingWindow,
  parseSeasonDate,
  votingStatusLabel,
} from "../lib/seasonAwards";

interface SeasonScheduleAdminProps {
  season: Season;
  /** The season after this one, which sets the default close; null while running. */
  nextSeason: Season | null;
  /** Saves the fields that changed; null clears one. */
  onSave: (schedule: SeasonVotingSchedule) => Promise<void>;
  onOpenVoting: () => Promise<void>;
  onCloseVoting: () => Promise<void>;
  now?: number;
}

export const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Admin-only, one season's block in the Admin tab's "Season options" card
 * (SeasonOptionsAdmin), in two groups. "Season": the running season's planned
 * end, with a live preview of when award voting opens from it (a lead week
 * before). "Award voting": the closing date, plus "Open voting now" (running
 * season, before it opens; one-way - open_award_voting keeps the first moment)
 * and "Close voting now" (while open; a later closing date reopens). Both
 * confirm. A season with an open ballot that has ended - usually the previous
 * one, during the first two weeks of the next - only gets the voting group.
 *
 * Collapsible (<details>): the summary keeps the season and the voting status,
 * so a closed block still says where voting stands. It starts open only while the ballot
 * is open - the state an admin is most likely to act on.
 */
export function SeasonScheduleAdmin({
  season,
  nextSeason,
  onSave,
  onOpenVoting,
  onCloseVoting,
  now = Date.now(),
}: SeasonScheduleAdminProps) {
  const { t } = useTranslation();
  const initialPlanned = toSwissDateTime(season.planned_end_at ?? null);
  const initialCloses = toSwissDateTime(season.voting_closes_at ?? null);
  const [planned, setPlanned] = useState(initialPlanned);
  const [closes, setCloses] = useState(initialCloses);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = season.is_active;
  const label = `S${season.number} · ${season.name}`;
  const status = awardVotingStatus(season, nextSeason, now);
  const statusLabel = votingStatusLabel(season, nextSeason, now);
  const statusText = t(`seasonDialog.${statusLabel.key}`, {
    date: "at" in statusLabel ? formatDateTime(statusLabel.at) : "",
    days: AWARD_VOTING_TAIL_DAYS,
  });
  const startedAt = Date.parse(season.started_at);
  const dirty = planned !== initialPlanned || closes !== initialCloses;

  // When voting would open from the planned end as typed - only worth saying
  // while it hasn't opened yet. Reuses the window logic, so it can't disagree.
  const opensPreview = (() => {
    if (!running || status !== "not_open") return null;
    const parsed = parseSeasonDate(planned, startedAt);
    if (parsed.kind === "empty") return t("seasonDialog.votingOpensPreviewNone");
    if (parsed.kind !== "ok") return null;
    const { opensAt } = awardVotingWindow({ ...season, planned_end_at: parsed.iso }, nextSeason);
    if (opensAt === null) return null;
    return opensAt <= now
      ? t("seasonDialog.votingOpensPreviewNow", { days: AWARD_VOTING_LEAD_DAYS })
      : t("seasonDialog.votingOpensPreview", {
          date: formatDateTime(opensAt),
          days: AWARD_VOTING_LEAD_DAYS,
        });
  })();

  const save = async () => {
    const schedule: SeasonVotingSchedule = {};
    // Only fields that changed are checked and sent, so a stored closing date
    // in the past (a closed vote) doesn't block saving the planned end.
    if (planned !== initialPlanned) {
      const parsed = parseSeasonDate(planned, startedAt);
      if (parsed.kind === "invalid") {
        setError(t("seasonDialog.plannedEndInvalid", { format: SWISS_DATETIME_FORMAT }));
        return;
      }
      if (parsed.kind === "before_start") {
        setError(t("seasonDialog.plannedEndBeforeStart"));
        return;
      }
      schedule.planned_end_at = parsed.kind === "ok" ? parsed.iso : null;
    }
    if (closes !== initialCloses) {
      const parsed = parseSeasonDate(closes, startedAt);
      if (parsed.kind === "invalid") {
        setError(t("seasonDialog.votingClosesInvalid", { format: SWISS_DATETIME_FORMAT }));
        return;
      }
      if (parsed.kind === "before_start") {
        setError(t("seasonDialog.votingClosesBeforeStart"));
        return;
      }
      schedule.voting_closes_at = parsed.kind === "ok" ? parsed.iso : null;
    }
    await run(() => onSave(schedule));
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(t(awardErrorKey(err) ?? "seasonDialog.scheduleError"));
    } finally {
      setBusy(false);
    }
  };

  const openNow = () => {
    if (confirm(t("seasonDialog.openVotingConfirm"))) void run(onOpenVoting);
  };
  const closeNow = () => {
    if (confirm(t("seasonDialog.closeVotingConfirm", { season: label }))) void run(onCloseVoting);
  };

  const fieldId = (name: string) => `season-${name}-${season.id}`;

  return (
    <details className="season-schedule-admin" open={status === "open"}>
      <summary className="season-schedule-summary">
        <h3 className="season-schedule-title">{label}</h3>
        <span className="season-schedule-status">🗳️ {statusText}</span>
      </summary>

      {running && (
        <fieldset className="season-options-group">
          <legend>{t("seasonDialog.seasonGroup")}</legend>
          <div className="form-group">
            <label htmlFor={fieldId("planned-end")}>{t("seasonDialog.plannedSeasonEnd")}</label>
            <input
              id={fieldId("planned-end")}
              type="text"
              inputMode="numeric"
              value={planned}
              placeholder={SWISS_DATETIME_FORMAT}
              onChange={(e) => setPlanned(maskSwissDateTime(e.target.value))}
              disabled={busy}
            />
            <span className="block text-[0.78rem] text-text-light mt-1">
              {t("seasonDialog.plannedSeasonEndHint", { format: SWISS_DATETIME_FORMAT })}
            </span>
            {opensPreview && <span className="season-options-preview">🗳️ {opensPreview}</span>}
          </div>
        </fieldset>
      )}

      <fieldset className="season-options-group">
        <legend>🗳️ {t("seasonDialog.awardVoting")}</legend>
        <div className="form-group">
          <label htmlFor={fieldId("voting-closes")}>{t("seasonDialog.votingCloses")}</label>
          <input
            id={fieldId("voting-closes")}
            type="text"
            inputMode="numeric"
            value={closes}
            placeholder={SWISS_DATETIME_FORMAT}
            onChange={(e) => setCloses(maskSwissDateTime(e.target.value))}
            disabled={busy}
          />
          <span className="block text-[0.78rem] text-text-light mt-1">
            {t("seasonDialog.votingClosesHint", {
              format: SWISS_DATETIME_FORMAT,
              days: AWARD_VOTING_TAIL_DAYS,
            })}
          </span>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={save} disabled={busy || !dirty}>
          {t("seasonDialog.save")}
        </button>
        {running && status === "not_open" && (
          <button className="btn-secondary" onClick={openNow} disabled={busy}>
            {t("seasonDialog.openVoting")}
          </button>
        )}
        {status === "open" && (
          <button className="btn-secondary" onClick={closeNow} disabled={busy}>
            {t("seasonDialog.closeVoting")}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mt-3"
        >
          {error}
        </p>
      )}
    </details>
  );
}
