import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Season } from "../lib/supabase";
import { SWISS_DATETIME_FORMAT, maskSwissDateTime, toSwissDateTime } from "../lib/banners";
import {
  AWARD_VOTING_LEAD_DAYS,
  awardErrorKey,
  awardVotingStatus,
  parsePlannedEnd,
} from "../lib/seasonAwards";

interface SeasonScheduleAdminProps {
  /** The running season. */
  season: Season;
  /** null clears the planned end. */
  onSavePlannedEnd: (plannedEndAt: string | null) => Promise<void>;
  onOpenVoting: () => Promise<void>;
  now?: number;
}

/**
 * Admin-only, in SeasonDialog's info view: the running season's planned end
 * (award voting opens a lead week before it) and "Open voting now". Opening is
 * one-way - open_award_voting keeps the first moment - hence the confirm.
 */
export function SeasonScheduleAdmin({
  season,
  onSavePlannedEnd,
  onOpenVoting,
  now = Date.now(),
}: SeasonScheduleAdminProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => toSwissDateTime(season.planned_end_at ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The running season has no successor yet, so its voting can't have closed.
  const votingOpen = awardVotingStatus(season, null, now) === "open";

  const save = async () => {
    const parsed = parsePlannedEnd(text, Date.parse(season.started_at));
    if (parsed.kind === "invalid") {
      setError(t("seasonDialog.plannedEndInvalid", { format: SWISS_DATETIME_FORMAT }));
      return;
    }
    if (parsed.kind === "before_start") {
      setError(t("seasonDialog.plannedEndBeforeStart"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSavePlannedEnd(parsed.kind === "ok" ? parsed.iso : null);
    } catch {
      setError(t("seasonDialog.scheduleError"));
    } finally {
      setBusy(false);
    }
  };

  const openNow = async () => {
    if (!confirm(t("seasonDialog.openVotingConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await onOpenVoting();
    } catch (err) {
      setError(t(awardErrorKey(err) ?? "seasonDialog.scheduleError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="season-schedule-admin">
      <div className="form-group">
        <label htmlFor="season-planned-end">{t("seasonDialog.plannedEnd")}</label>
        <div className="flex gap-2">
          <input
            id="season-planned-end"
            type="text"
            inputMode="numeric"
            value={text}
            placeholder={SWISS_DATETIME_FORMAT}
            onChange={(e) => setText(maskSwissDateTime(e.target.value))}
            disabled={busy}
          />
          <button className="btn-secondary" onClick={save} disabled={busy}>
            {t("seasonDialog.save")}
          </button>
        </div>
        <span className="block text-[0.78rem] text-text-light mt-1">
          {t("seasonDialog.plannedEndHint", {
            format: SWISS_DATETIME_FORMAT,
            days: AWARD_VOTING_LEAD_DAYS,
          })}
        </span>
      </div>
      <button className="btn-secondary" onClick={openNow} disabled={busy || votingOpen}>
        {votingOpen ? t("seasonDialog.votingIsOpen") : t("seasonDialog.openVoting")}
      </button>
      {error && (
        <p
          role="alert"
          className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mt-3"
        >
          {error}
        </p>
      )}
    </section>
  );
}
