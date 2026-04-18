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
      <button
        className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary text-white border-none rounded-full text-[0.8rem] font-semibold cursor-pointer transition-colors hover:bg-primary-dark whitespace-nowrap"
        onClick={openDialog}
        title="View season info"
      >
        S{activeSeason?.number ?? "?"}
        <span className="font-normal opacity-85 max-sm:hidden">{activeSeason?.name ?? "No season"}</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={close}>
          <div className="bg-white rounded-lg p-8 max-w-[440px] w-[90%] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)]" onClick={(e) => e.stopPropagation()}>
            {view === "info" && (
              <>
                <h2 className="text-2xl font-semibold mb-5 flex items-center gap-2.5">
                  {activeSeason?.name ?? "Season"}
                  <span className="text-[0.75rem] font-medium text-text-light bg-bg border border-border rounded-full px-2.5 py-0.5">
                    Season {activeSeason?.number}
                  </span>
                </h2>

                <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 mb-6 text-[0.9rem]">
                  <dt className="font-semibold text-text-light whitespace-nowrap">K-Factor</dt>
                  <dd className="m-0">{activeSeason?.k_factor ?? "—"}</dd>

                  <dt className="font-semibold text-text-light whitespace-nowrap">Inactivity Penalty</dt>
                  <dd className="m-0">
                    {activeSeason?.inactivity_penalty_percent
                      ? `${activeSeason.inactivity_penalty_percent}% per week`
                      : "None"}
                  </dd>

                  <dt className="font-semibold text-text-light whitespace-nowrap">Started</dt>
                  <dd className="m-0">{activeSeason ? formatDate(activeSeason.started_at) : "—"}</dd>
                </dl>

                <div className="flex gap-4 justify-end">
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
                <h2 className="text-2xl font-semibold mb-5">Start New Season</h2>

                <div className="bg-[#fef3c7] border border-warning rounded-md p-3 text-[0.875rem] text-[#92400e] mb-5">
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
                  <span className="block text-[0.78rem] text-text-light mt-1">
                    Applied every Monday to players inactive for 7+ days. 0 = disabled.
                  </span>
                </div>

                {error && (
                  <p className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-3">
                    {error}
                  </p>
                )}

                <div className="flex gap-4 justify-end">
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
