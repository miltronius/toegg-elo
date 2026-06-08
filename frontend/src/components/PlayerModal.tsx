import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createPlayer, Player } from "../lib/supabase";
import { generateAnonymousName } from "../lib/anonymousNames";

interface CreatePlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayerCreated: () => void;
  players: Player[];
}

export function CreatePlayerModal({
  isOpen,
  onClose,
  onPlayerCreated,
  players,
}: CreatePlayerModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [anonymousName, setAnonymousName] = useState("");
  // True once the user manually edits the anonymous name, so we stop auto-prefilling it.
  const [anonEdited, setAnonEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takenNames = players
    .map((p) => p.anonymous_name)
    .filter((n): n is string => !!n);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!anonEdited) {
      setAnonymousName(value.trim() ? generateAnonymousName(value, takenNames) : "");
    }
  };

  const handleRegenerate = () => {
    setAnonymousName(generateAnonymousName(name, takenNames));
    setAnonEdited(false);
  };

  const reset = () => {
    setName("");
    setAnonymousName("");
    setAnonEdited(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const finalAnon =
        anonymousName.trim() || generateAnonymousName(name, takenNames);
      await createPlayer(name, finalAnon);
      reset();
      onPlayerCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("playerModal.createError"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={onClose}>
      <div className="bg-white rounded-lg p-8 max-w-[400px] w-[90%] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-semibold mb-6 text-text">{t("playerModal.createTitle")}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder={t("playerModal.playerName")}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            disabled={loading}
            className="w-full px-3 py-2.5 border border-border rounded-md text-[0.95rem] focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 disabled:bg-bg-light disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-light">
              {t("playerModal.anonymousLabel")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t("playerModal.anonymousName")}
                value={anonymousName}
                onChange={(e) => {
                  setAnonymousName(e.target.value);
                  setAnonEdited(true);
                }}
                disabled={loading}
                className="flex-1 px-3 py-2.5 border border-border rounded-md text-[0.95rem] focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 disabled:bg-bg-light disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={loading || !name.trim()}
                title={t("playerModal.regenerate")}
                className="btn-secondary px-3"
              >
                🔁
              </button>
            </div>
          </div>
          {error && (
            <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error">
              {error}
            </div>
          )}
          <div className="flex gap-4 justify-end mt-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              {t("playerModal.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? t("playerModal.creating") : t("playerModal.create")}
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
  const { t } = useTranslation();
  const filteredPlayers = players.filter((p) => !excludeIds.includes(p.id));

  return (
    <div className="form-group">
      <label>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{t("playerModal.selectPlayer")}</option>
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
