import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Player, PlayerSeasonStats, Season } from "../lib/supabase";
import { useMe } from "../contexts/AuthContext";
import { DATE_LOCALE } from "../lib/i18n";
import { RANKED_MIN_GAMES } from "../lib/rosterFilter";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import {
  SEASON_AWARDS,
  awardErrorKey,
  awardVotingWindow,
  eligibleNomineeIds,
  nextSeasonOf,
  picksForSeason,
  type AwardId,
  type AwardVote,
} from "../lib/seasonAwards";

interface AwardBallotDialogProps {
  season: Season;
  seasons: Season[];
  players: Player[];
  /** Every season's standings - the rookie award looks at earlier seasons. */
  seasonStats: PlayerSeasonStats[];
  /** The voter's own votes (any season); read once, when the dialog opens. */
  votes: AwardVote[];
  /** Saves one pick; null clears it. A rejection reverts the pick and says why. */
  onCast: (awardId: AwardId, nomineeId: string | null) => Promise<void>;
  onClose: () => void;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * The Season Awards ballot: one picker per award, limited to who qualifies
 * right now, your own player never offered. Each pick is saved as it's made
 * (cast_award_vote), so there's nothing to submit and any award can be
 * skipped. A pick who stopped qualifying stays visible with a warning -
 * blanking it would hide that the vote is at risk.
 *
 * Portalled to <body> above SeasonDialog (z-[1000]), which it can open from.
 */
export function AwardBallotDialog({
  season,
  seasons,
  players,
  seasonStats,
  votes,
  onCast,
  onClose,
}: AwardBallotDialogProps) {
  const { t } = useTranslation();
  const { myPlayerId } = useMe();
  const [picks, setPicks] = useState(() => picksForSeason(votes, season.id));
  const [saving, setSaving] = useState<Partial<Record<AwardId, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AwardId, string>>>({});

  const eligible = useMemo(
    () =>
      new Map(
        SEASON_AWARDS.map((award) => [
          award.id,
          eligibleNomineeIds(award, season, seasons, seasonStats),
        ]),
      ),
    [season, seasons, seasonStats],
  );
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const { closesAt } = awardVotingWindow(season, nextSeasonOf(season, seasons));
  const pickedCount = Object.values(picks).filter(Boolean).length;

  const pick = async (awardId: AwardId, playerId: string) => {
    const previous = picks[awardId] ?? "";
    if (playerId === previous) return;
    setPicks((p) => ({ ...p, [awardId]: playerId || undefined }));
    setErrors((e) => ({ ...e, [awardId]: undefined }));
    setSaving((s) => ({ ...s, [awardId]: true }));
    try {
      await onCast(awardId, playerId || null);
    } catch (err) {
      setPicks((p) => ({ ...p, [awardId]: previous || undefined }));
      setErrors((e) => ({
        ...e,
        [awardId]: t(awardErrorKey(err) ?? "seasonAwards.errors.unknown"),
      }));
    } finally {
      setSaving((s) => ({ ...s, [awardId]: false }));
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100] p-4"
      onClick={onClose}
    >
      <div
        className="modal-panel bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="award-ballot-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="award-ballot-title" className="text-xl font-bold mb-3">
          🗳️ {t("seasonAwards.ballot.title", { season: `S${season.number} · ${season.name}` })}
        </h2>
        <p className="text-sm mb-2">
          {t("seasonAwards.ballot.intro")}
          {closesAt !== null && ` ${t("seasonAwards.ballot.closes", { date: formatDate(closesAt) })}`}
        </p>
        <p className="text-sm text-text-light mb-4">
          {t("seasonAwards.ballot.secret")} {t("seasonAwards.ballot.recheck")}
        </p>

        {SEASON_AWARDS.map((award) => {
          const ids = eligible.get(award.id) ?? new Set<string>();
          const current = picks[award.id] ?? "";
          const options = players.filter(
            (p) => p.id !== myPlayerId && (ids.has(p.id) || p.id === current),
          );
          const nobody = options.length === 0;
          return (
            <div key={award.id} className="award-ballot-row">
              <PlayerAutocomplete
                label={`${award.icon} ${t(`seasonAwards.awards.${award.id}`)}`}
                players={options}
                value={current}
                onChange={(id) => void pick(award.id, id)}
                emptyLabel={t("seasonAwards.ballot.noPick")}
                placeholder={
                  nobody
                    ? t("seasonAwards.ballot.nobodyEligible")
                    : t("seasonAwards.ballot.choose")
                }
                disabled={nobody || saving[award.id]}
              />
              <p className="award-ballot-hint">
                {t(`seasonAwards.nominees.${award.nominees}`, {
                  min: RANKED_MIN_GAMES,
                  max: RANKED_MIN_GAMES - 1,
                })}
                {saving[award.id] && ` · ${t("seasonAwards.ballot.saving")}`}
              </p>
              {current && !ids.has(current) && (
                <p className="award-ballot-warning">
                  {t("seasonAwards.ballot.noLongerEligible", {
                    name: playerById.get(current)?.name ?? "?",
                  })}
                </p>
              )}
              {errors[award.id] && (
                <p role="alert" className="award-ballot-error">
                  {errors[award.id]}
                </p>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between gap-2 mt-4">
          <span className="text-sm text-text-light">
            {t("seasonAwards.nudge.picked", { picked: pickedCount, total: SEASON_AWARDS.length })}
          </span>
          <button className="btn-primary" onClick={onClose}>
            {t("seasonAwards.ballot.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
