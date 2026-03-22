import { useState } from "react";
import { Player, upsertTeamName } from "../lib/supabase";
import {
  TeamStats,
  getTeamDisplayName,
  teamKeyParts,
  teamColor,
} from "../lib/teamUtils";


interface TeamDetailProps {
  team: TeamStats;
  players: Player[];
  allTeams: TeamStats[];
  canEdit: boolean;
  onClose: () => void;
  onNamesUpdated: () => void;
}

export function TeamDetail({
  team,
  players,
  allTeams,
  canEdit,
  onClose,
  onNamesUpdated,
}: TeamDetailProps) {
  const [name, setName] = useState(team.nameRow?.name ?? "");
  const [alias1, setAlias1] = useState(team.nameRow?.alias_1 ?? "");
  const [alias2, setAlias2] = useState(team.nameRow?.alias_2 ?? "");
  const [color, setColor] = useState(team.nameRow?.color ?? teamColor(team));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playerMap = new Map(players.map((p) => [p.id, p]));

  const rivalTeamName = (rivalKey: string) => {
    const [lo, hi] = teamKeyParts(rivalKey);
    const rival = allTeams.find((t) => t.key === rivalKey);
    if (rival?.nameRow?.name) return rival.nameRow.name;
    return `${playerMap.get(lo)?.name ?? "?"} & ${playerMap.get(hi)?.name ?? "?"}`;
  };

  const handleSave = async () => {
    setError(null);

    // Collect all names in use by other teams (name + both aliases)
    const takenNames = new Set<string>();
    for (const t of allTeams) {
      if (t.key === team.key) continue;
      if (t.nameRow?.name) takenNames.add(t.nameRow.name.trim().toLowerCase());
      if (t.nameRow?.alias_1) takenNames.add(t.nameRow.alias_1.trim().toLowerCase());
      if (t.nameRow?.alias_2) takenNames.add(t.nameRow.alias_2.trim().toLowerCase());
    }

    const toCheck = [name, alias1, alias2].map((v) => v.trim()).filter(Boolean);
    const duplicate = toCheck.find((v) => takenNames.has(v.toLowerCase()));
    if (duplicate) {
      setError(`"${duplicate}" is already used by another team.`);
      return;
    }

    setSaving(true);
    try {
      await upsertTeamName(
        team.player_id_lo,
        team.player_id_hi,
        name.trim() || null,
        alias1.trim() || null,
        alias2.trim() || null,
        color,
      );
      onNamesUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content team-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="team-detail-header"
          style={{ borderLeft: `4px solid ${teamColor(team)}`, paddingLeft: "0.75rem" }}
        >
          <h2>{getTeamDisplayName(team, players)}</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="team-detail-players">
          {[team.player_id_lo, team.player_id_hi].map((id) => {
            const p = playerMap.get(id);
            if (!p) return null;
            return (
              <div key={id} className="team-detail-player">
                <span className="team-detail-player-name">{p.name}</span>
                <span className="team-detail-player-elo">{p.current_elo}</span>
              </div>
            );
          })}
        </div>

        <div className="player-stats-grid">
          <div className="stat-card">
            <div className="stat-label">Combined ELO</div>
            <div className="stat-value">{team.combinedElo}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Matches</div>
            <div className="stat-value">{team.matchesPlayed}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Win Rate</div>
            <div className="stat-value">
              {(team.winRate * 100).toFixed(0)}%
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Record</div>
            <div className="stat-value" style={{ fontSize: "1.1rem" }}>
              {team.wins}W – {team.losses}L
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="team-names-form">
            <div className="team-color-row">
              <label>Team Color</label>
              <div className="team-color-picker-wrap">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={saving}
                  className="team-color-input"
                />
                <button
                  type="button"
                  onClick={() => setColor(teamColor({ ...team, nameRow: null }))}
                  disabled={saving}
                >
                  Reset
                </button>
              </div>
            </div>
            <div>
              <label>Team Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={getTeamDisplayName(team, players)}
                disabled={saving}
              />
            </div>
            <div>
              <label>Alias 1</label>
              <input
                type="text"
                value={alias1}
                onChange={(e) => setAlias1(e.target.value)}
                placeholder="Alternative name"
                disabled={saving}
              />
            </div>
            <div>
              <label>Alias 2</label>
              <input
                type="text"
                value={alias2}
                onChange={(e) => setAlias2(e.target.value)}
                placeholder="Alternative name"
                disabled={saving}
              />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Names"}
            </button>
          </div>
        )}

        {team.rivals.length > 0 && (
          <div className="team-rivals-list">
            <h3>Top Rivals</h3>
            {team.rivals.map((rival) => (
              <div key={rival.key} className="rival-item">
                <span>{rivalTeamName(rival.key)}</span>
                <span className="rival-record">
                  <span className="rival-record-w">{rival.wins}W</span>
                  {" – "}
                  <span className="rival-record-l">{rival.losses}L</span>
                  <span className="rival-count">{rival.matchesPlayed}×</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
