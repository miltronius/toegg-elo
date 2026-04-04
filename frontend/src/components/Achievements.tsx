import { useState } from "react";
import type { CSSProperties } from "react";
import {
  ACHIEVEMENT_DEFINITIONS,
  buildAchievementStatuses,
  rarityColorForTier,
  RARITY_TIERS,
  type PlayerAchievementRow,
  type AchievementStatus,
} from "../lib/achievements";
import type { Player, Match } from "../lib/supabase";

interface AchievementsProps {
  players: Player[];
  matches: Match[];
  allAchievementRows: PlayerAchievementRow[];
  onSelectPlayer: (player: Player) => void;
}

export function Achievements({
  players,
  matches,
  allAchievementRows,
  onSelectPlayer,
}: AchievementsProps) {
  const total = ACHIEVEMENT_DEFINITIONS.length;

  // Build per-player row data sorted by badge count desc
  const rows = players
    .map((player) => {
      const statuses = buildAchievementStatuses(
        player.id,
        player,
        players,
        matches,
        allAchievementRows,
      );
      const unlockedCount = statuses.filter((s) => s.unlocked).length;
      return { player, statuses, unlockedCount };
    })
    .sort((a, b) => b.unlockedCount - a.unlockedCount);

  return (
    <div className="card">
      <h2>🏅 Achievements</h2>
      <table className="leaderboard-table achievements-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Badges</th>
            <th className="achievements-progress">Progress</th>
            <th>Highlights</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ player, statuses, unlockedCount }, index) => (
            <AchievementRow
              key={player.id}
              rank={index + 1}
              player={player}
              statuses={statuses}
              unlockedCount={unlockedCount}
              total={total}
              onClick={() => onSelectPlayer(player)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface AchievementRowProps {
  rank: number;
  player: Player;
  statuses: AchievementStatus[];
  unlockedCount: number;
  total: number;
  onClick: () => void;
}

function AchievementRow({
  rank,
  player,
  statuses,
  unlockedCount,
  total,
  onClick,
}: AchievementRowProps) {
  const pct = total > 0 ? (unlockedCount / total) * 100 : 0;

  // Show up to 5 unlocked badge icons as highlights, rarest first
  const highlights = statuses
    .filter((s) => s.unlocked)
    .sort((a, b) => (a.rarityPercent ?? Infinity) - (b.rarityPercent ?? Infinity))
    .slice(0, 5);

  return (
    <tr onClick={onClick} style={{ cursor: "pointer" }}>
      <td className="rank">{rank}</td>
      <td>
        <span className="player-name">{player.name}</span>
      </td>
      <td>
        <span className="achievements-count">
          {unlockedCount}/{total}
        </span>
      </td>
      <td className="achievements-progress">
        <div className="achievements-progress-bar">
          <div
            className="achievements-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      </td>
      <td>
        <div className="achievements-highlights">
          {highlights.map((s) => (
            <span
              key={s.definition.id}
              className="achievements-highlight-badge"
              title={s.definition.name}
              style={
                s.rarityTier
                  ? {
                      borderColor: rarityColorForTier(s.rarityTier),
                      color: rarityColorForTier(s.rarityTier),
                    }
                  : undefined
              }
            >
              {s.definition.icon}
            </span>
          ))}
          {unlockedCount === 0 && (
            <span className="achievements-none">None yet</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// AchievementGallery — used inside PlayerDetail
// ---------------------------------------------------------------------------

interface AchievementGalleryProps {
  statuses: AchievementStatus[];
  players: Player[];
}

export function AchievementGallery({
  statuses,
  players,
}: AchievementGalleryProps) {
  const [sortMode, setSortMode] = useState<"rarity" | "date">("rarity");
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const unlocked = statuses
    .filter((s) => s.unlocked)
    .sort((a, b) => {
      if (sortMode === "rarity") {
        // lower percent = rarer = first; undefined rarity goes last
        const ap = a.rarityPercent ?? Infinity;
        const bp = b.rarityPercent ?? Infinity;
        return ap - bp;
      } else {
        // most recently unlocked first; undefined date goes last
        const ad = a.unlockedAt?.getTime() ?? 0;
        const bd = b.unlockedAt?.getTime() ?? 0;
        return bd - ad;
      }
    });

  const locked = statuses.filter((s) => !s.unlocked);

  return (
    <div className="achievement-gallery">
      {unlocked.length > 0 && (
        <section>
          <div className="achievement-gallery-header">
            <div className="achievement-section-heading">
              Unlocked ({unlocked.length})
            </div>
            <div className="lb-toggle">
              <button
                className={`lb-toggle-btn${sortMode === "rarity" ? " active" : ""}`}
                onClick={() => setSortMode("rarity")}
              >
                By Rarity
              </button>
              <button
                className={`lb-toggle-btn${sortMode === "date" ? " active" : ""}`}
                onClick={() => setSortMode("date")}
              >
                By Date
              </button>
            </div>
          </div>
          <div className="achievement-grid">
            {unlocked.map((s) => (
              <AchievementCard
                key={s.definition.id}
                status={s}
                playerMap={playerMap}
              />
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="achievement-section-heading">
          Locked ({locked.length})
        </div>
        <div className="achievement-grid">
          {locked.map((s) => (
            <AchievementCard
              key={s.definition.id}
              status={s}
              playerMap={playerMap}
              locked
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface AchievementCardProps {
  status: AchievementStatus;
  playerMap: Map<string, Player>;
  locked?: boolean;
}

function AchievementCard({ status, playerMap, locked }: AchievementCardProps) {
  const { definition, rarityTier, rarityPercent, meta, unlockedAt } = status;

  const color = rarityTier ? rarityColorForTier(rarityTier) : undefined;
  const tierInfo = rarityTier
    ? RARITY_TIERS.find((r) => r.tier === rarityTier)
    : undefined;

  let subtext: string | null = null;
  if (!locked && meta) {
    const partnerId = meta.partnerId as string | undefined;
    const opponentId = meta.opponentId as string | undefined;
    if (partnerId) {
      subtext = `with ${playerMap.get(partnerId)?.name ?? "?"}`;
    } else if (opponentId) {
      subtext = `vs ${playerMap.get(opponentId)?.name ?? "?"}`;
    }
  }

  const unlockedLabel = unlockedAt
    ? unlockedAt.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
    : undefined;

  return (
    <div
      className={`achievement-card${locked ? " achievement-card--locked" : ""}`}
      style={
        color && !locked
          ? ({ "--achievement-rarity-color": color } as CSSProperties)
          : undefined
      }
      data-unlocked={!locked && unlockedLabel ? unlockedLabel : undefined}
    >
      <div className="achievement-icon">
        {locked ? "🔒" : definition.icon}
      </div>
      <div className="achievement-name">{definition.name}</div>
      <div className="achievement-desc">{definition.description}</div>
      {subtext && <div className="achievement-sub">{subtext}</div>}
      {tierInfo && !locked && (
        <span
          className="achievement-rarity-badge"
          style={{ color, borderColor: color }}
        >
          {tierInfo.label}
          {rarityPercent !== undefined && ` · ${rarityPercent.toFixed(0)}% of players`}
        </span>
      )}
    </div>
  );
}
