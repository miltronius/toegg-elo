import { useState } from "react";
import { Season, endSeasonAndStartNew } from "../lib/supabase";

interface SeasonDialogProps {
  activeSeason: Season | null;
  isAdmin: boolean;
  onSeasonChanged: () => void;
}

export function SeasonDialog({ activeSeason, isAdmin, onSeasonChanged }: SeasonDialogProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"info" | "new-season">("info");
  const [newName, setNewName] = useState("");
  const [newKFactor, setNewKFactor] = useState<32 | 64 | 128>(64);
  const [newPenalty, setNewPenalty] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setView("info");
    setError(null);
    if (activeSeason) {
      setNewName(`Season ${activeSeason.number + 1}`);
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setView("info");
    setError(null);
  };

  const handleConfirmNewSeason = async () => {
    if (!newName.trim()) {
      setError("Season name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await endSeasonAndStartNew(newName.trim(), newKFactor, newPenalty);
      close();
      onSeasonChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start new season.");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <>
      <button className="season-badge" onClick={openDialog} title="View season info">
        S{activeSeason?.number ?? "?"}
        <span className="season-badge-name">{activeSeason?.name ?? "No season"}</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content season-modal" onClick={(e) => e.stopPropagation()}>
            {view === "info" && (
              <>
                <h2>
                  {activeSeason?.name ?? "Season"}
                  <span className="season-number-tag">Season {activeSeason?.number}</span>
                </h2>

                <dl className="season-info-grid">
                  <dt>K-Factor</dt>
                  <dd>{activeSeason?.k_factor ?? "—"}</dd>

                  <dt>Inactivity Penalty</dt>
                  <dd>
                    {activeSeason?.inactivity_penalty_percent
                      ? `${activeSeason.inactivity_penalty_percent}% per week`
                      : "None"}
                  </dd>

                  <dt>Started</dt>
                  <dd>{activeSeason ? formatDate(activeSeason.started_at) : "—"}</dd>
                </dl>

                <div className="modal-buttons">
                  <button className="btn-secondary" onClick={close}>
                    Close
                  </button>
                  {isAdmin && (
                    <button
                      className="btn-primary"
                      onClick={() => setView("new-season")}
                    >
                      End Season &amp; Start New →
                    </button>
                  )}
                </div>
              </>
            )}

            {view === "new-season" && (
              <>
                <h2>Start New Season</h2>

                <div className="season-warning">
                  All players will reset to <strong>1500 ELO</strong> when the new season begins.
                </div>

                <div className="form-group">
                  <label htmlFor="season-name">Season Name</label>
                  <input
                    id="season-name"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={`Season ${(activeSeason?.number ?? 0) + 1}`}
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="season-kfactor">K-Factor</label>
                  <select
                    id="season-kfactor"
                    value={newKFactor}
                    onChange={(e) => setNewKFactor(Number(e.target.value) as 32 | 64 | 128)}
                    disabled={loading}
                  >
                    <option value={32}>32 — Standard (slower)</option>
                    <option value={64}>64 — Faster</option>
                    <option value={128}>128 — Very fast</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="season-penalty">
                    Weekly Inactivity Penalty (% of ELO)
                  </label>
                  <input
                    id="season-penalty"
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    value={newPenalty}
                    onChange={(e) => setNewPenalty(Number(e.target.value))}
                    disabled={loading}
                  />
                  <span className="form-hint">
                    Applied every Monday to players inactive for 7+ days. 0 = disabled.
                  </span>
                </div>

                {error && <p className="error-message">{error}</p>}

                <div className="modal-buttons">
                  <button
                    className="btn-secondary"
                    onClick={() => { setView("info"); setError(null); }}
                    disabled={loading}
                  >
                    Back
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleConfirmNewSeason}
                    disabled={loading || !newName.trim()}
                  >
                    {loading ? "Starting…" : `Confirm — End Season ${activeSeason?.number}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
