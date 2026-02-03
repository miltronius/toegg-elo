import { useState, useEffect } from "react";
import { getPlayers, createPlayer, Player } from "../lib/supabase";

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Create New Player</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Player name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading}
          />
          {error && <div className="error-message">{error}</div>}
          <div className="modal-buttons">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading}>
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
}

export function PlayerDropdown({
  label,
  players,
  value,
  onChange,
  disabled,
  excludeIds = [],
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
        {filteredPlayers.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name} ({player.current_elo})
          </option>
        ))}
      </select>
    </div>
  );
}
