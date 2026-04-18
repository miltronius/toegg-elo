import { useState } from "react";
import { createPlayer, Player } from "../lib/supabase";

interface CreatePlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayerCreated: () => void;
}

export function CreatePlayerModal({
  isOpen,
  onClose,
  onPlayerCreated,
}: CreatePlayerModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await createPlayer(name);
      setName("");
      onPlayerCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create player");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={onClose}>
      <div className="bg-white rounded-lg p-8 max-w-[400px] w-[90%] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-semibold mb-6 text-text">Create New Player</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Player name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading}
            className="w-full px-3 py-2.5 border border-border rounded-md text-[0.95rem] focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 disabled:bg-bg-light disabled:cursor-not-allowed disabled:opacity-60"
          />
          {error && (
            <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error">
              {error}
            </div>
          )}
          <div className="flex gap-4 justify-end mt-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface PlayerDropdownProps {
  label: string;
  players: Player[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  excludeIds?: string[];
  seasonEloMap?: Map<string, number>;
}

export function PlayerDropdown({
  label,
  players,
  value,
  onChange,
  disabled,
  excludeIds = [],
  seasonEloMap,
}: PlayerDropdownProps) {
  const filteredPlayers = players.filter((p) => !excludeIds.includes(p.id));

  return (
    <div className="form-group">
      <label>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">-- Select player --</option>
        {filteredPlayers.map((player) => {
          const elo = seasonEloMap?.get(player.id) ?? player.current_elo;
          return (
            <option key={player.id} value={player.id}>
              {player.name} ({elo})
            </option>
          );
        })}
      </select>
    </div>
  );
}
