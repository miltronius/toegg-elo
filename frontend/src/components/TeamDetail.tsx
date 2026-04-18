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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between mb-4"
          style={{ borderLeft: `4px solid ${teamColor(team)}`, paddingLeft: "0.75rem" }}
        >
          <h2 className="text-2xl font-bold text-text m-0">{getTeamDisplayName(team, players)}</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="flex gap-3 mb-4">
          {[team.player_id_lo, team.player_id_hi]
            .map((id) => playerMap.get(id))
            .filter((p): p is NonNullable<typeof p> => p != null)
            .sort((a, b) => b.current_elo - a.current_elo)
            .map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-bg rounded-md border border-border flex-1">
                <span className="font-semibold text-text">{p.name}</span>
                <span className="text-primary font-bold text-lg">{p.current_elo}</span>
              </div>
            ))}
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
              {team.wins} – {team.losses}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="stat-label mb-0">Team Color</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={saving}
                  className="w-10 h-8 rounded border border-border cursor-pointer p-0.5"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setColor(teamColor({ ...team, nameRow: null }))}
                  disabled={saving}
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="form-group">
              <div className="stat-label">Team Name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={getTeamDisplayName(team, players)}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <div className="stat-label">Alias 1</div>
              <input
                type="text"
                value={alias1}
                onChange={(e) => setAlias1(e.target.value)}
                placeholder="Alternative name"
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <div className="stat-label">Alias 2</div>
              <input
                type="text"
                value={alias2}
                onChange={(e) => setAlias2(e.target.value)}
                placeholder="Alternative name"
                disabled={saving}
              />
            </div>
            {error && (
              <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error">
                {error}
              </div>
            )}
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
          <div className="mt-4 pt-4 border-t border-border">
            <h3 className="text-base font-semibold text-text mb-3">Top Rivals</h3>
            <div className="flex flex-col">
              {team.rivals.map((rival) => (
                <div key={rival.key} className="flex items-center justify-between py-2 border-b border-border-light last:border-b-0">
                  <span className="text-sm text-text">{rivalTeamName(rival.key)}</span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-success font-semibold">{rival.wins}W</span>
                    {" – "}
                    <span className="text-error font-semibold">{rival.losses}L</span>
                    <span className="text-text-light">{rival.matchesPlayed}×</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
