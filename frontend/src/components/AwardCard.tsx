import { useTranslation } from "react-i18next";
import { useTilt } from "../hooks/useTilt";

// A bigger card than a nominee's, so a gentler tilt reads the same.
const MAX_TILT_DEG = 9;

interface AwardCardProps {
  icon: string;
  name: string;
  /** Your current pick's name, or null. */
  pickName: string | null;
  /** Votes cast for this award so far (award_turnout); null while unknown. */
  votes: number | null;
  /** This award's nominees are the ones showing below. */
  active: boolean;
  /** The element holding the nominees, for aria-controls. */
  panelId: string;
  onClick: () => void;
}

/**
 * One award on the ballot's overview: a `.shiny-card` that opens the award's
 * nominees below (a disclosure, hence aria-expanded). The open award spins
 * the rainbow border; one you've picked in carries a check and a calm border.
 * Shows how many votes it has, never for whom - the tally waits for the close.
 */
export function AwardCard({ icon, name, pickName, votes, active, panelId, onClick }: AwardCardProps) {
  const { t } = useTranslation();
  const tilt = useTilt<HTMLButtonElement>(MAX_TILT_DEG);

  return (
    <button
      type="button"
      className={`shiny-card award-card${active ? " is-glowing" : ""}${pickName ? " is-done" : ""}`}
      aria-expanded={active}
      aria-controls={panelId}
      onClick={onClick}
      {...tilt}
    >
      <span className="award-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="award-card-name">{name}</span>
      <span className="award-card-pick">
        {pickName
          ? t("seasonAwards.ballot.yourPick", { name: pickName })
          : t("seasonAwards.ballot.notPickedYet")}
      </span>
      {votes !== null && (
        <span className="award-card-votes">
          {t("seasonAwards.ballot.votes", { count: votes })}
        </span>
      )}
      {pickName && (
        <span className="shiny-check" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  );
}
