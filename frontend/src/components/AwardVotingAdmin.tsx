import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  closeAwardVoting,
  openAwardVoting,
  updateSeasonVotingSchedule,
  type Season,
} from "../lib/supabase";
import { awardVotingStatus, nextSeasonOf } from "../lib/seasonAwards";
import { SeasonScheduleAdmin } from "./SeasonScheduleAdmin";

interface AwardVotingAdminProps {
  seasons: Season[];
  /** Refetch after a change, so every view sees the new window. */
  onChanged: () => void;
  /** Fixed clock for tests; live (ticking) when omitted. */
  now?: number;
}

// A ballot closing changes nothing in the DB, so no event would re-render us.
const TICK_MS = 60_000;

/**
 * Admin tab card for Season Awards voting: one SeasonScheduleAdmin block for
 * the running season, plus one for the previous season while its ballot is
 * still open (it runs into the first two weeks of the next).
 */
export function AwardVotingAdmin({ seasons, onChanged, now: fixedNow }: AwardVotingAdminProps) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [fixedNow]);
  const now = fixedNow ?? tick;
  const active = seasons.find((s) => s.is_active) ?? null;
  const previous = active ? (seasons.find((s) => s.number === active.number - 1) ?? null) : null;
  const managed = [
    ...(previous && awardVotingStatus(previous, active, now) === "open" ? [previous] : []),
    ...(active ? [active] : []),
  ];

  return (
    <div className="card mt-6">
      <h2>{t("seasonDialog.votingAdminCardTitle")}</h2>
      <p className="text-text-light text-[0.85rem] mt-1 mb-4">
        {t("seasonDialog.votingAdminHint")}
      </p>
      {managed.length === 0 ? (
        <p className="text-text-light text-[0.85rem]">{t("seasonDialog.noSeason")}</p>
      ) : (
        managed.map((season) => (
          <SeasonScheduleAdmin
            // Keyed on the stored dates too, so the fields pick up a change
            // (e.g. Close voting now) once seasons refetch.
            key={`${season.id}-${season.planned_end_at}-${season.voting_closes_at}`}
            season={season}
            nextSeason={nextSeasonOf(season, seasons)}
            now={now}
            onSave={async (schedule) => {
              await updateSeasonVotingSchedule(season.id, schedule);
              onChanged();
            }}
            onOpenVoting={async () => {
              await openAwardVoting(season.id);
              onChanged();
            }}
            onCloseVoting={async () => {
              await closeAwardVoting(season.id);
              onChanged();
            }}
          />
        ))
      )}
    </div>
  );
}
