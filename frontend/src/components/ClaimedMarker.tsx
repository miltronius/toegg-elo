import { useTranslation } from "react-i18next";

interface ClaimedMarkerProps {
  /** Whether an account has claimed the player. */
  isLinked: boolean;
  /** Whether that account is the viewer's own. */
  isMe: boolean;
}

/**
 * Shown beside a player's name in PlayerDetail. Someone else's claimed player
 * gets a bare 🪪 whose tooltip explains it; your own gets a spelled-out
 * "This is you" badge, since that's the one worth noticing.
 */
export function ClaimedMarker({ isLinked, isMe }: ClaimedMarkerProps) {
  const { t } = useTranslation();
  if (!isLinked) return null;
  if (isMe) {
    return (
      <span
        className="streak-badge you claimed-marker"
        title={t("linking.yourPlayer")}
      >
        🪪 {t("linking.thisIsYou")}
      </span>
    );
  }
  return (
    <span
      className="claimed-marker"
      title={t("linking.claimed")}
      aria-label={t("linking.claimed")}
    >
      🪪
    </span>
  );
}
