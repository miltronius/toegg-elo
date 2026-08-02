import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Player } from "../lib/supabase";
import { filterPlayers, nextHighlight } from "../lib/playerSearch";

interface PlayerAutocompleteProps {
  players: Player[];
  /** Selected player id, or "" for none. */
  value: string;
  onChange: (playerId: string) => void;
  label?: string;
  disabled?: boolean;
  /** Players already picked elsewhere, hidden from the list. */
  excludeIds?: string[];
  /** Season-normalized Elo to show instead of all-time, when in season scope. */
  seasonEloMap?: Map<string, number>;
  /**
   * Label for the "no player" choice. Given, an explicit clear entry is offered
   * (the Teams filter's "All players"); omitted, clearing just empties the box.
   */
  emptyLabel?: string;
  placeholder?: string;
  /**
   * Header-row sizing: drops the form-group bottom margin and matches
   * `--control-h`, so it lines up with the season select and toggles beside it
   * rather than standing a head taller.
   */
  compact?: boolean;
}

/**
 * Type-to-find player picker, replacing a plain `<select>`.
 *
 * A native select is fine for a handful of options but degrades as a league
 * grows: it can only be searched by typing a name's first letters, blind, with
 * no visible feedback. This is a standard combobox - text filters the list,
 * arrows and Enter work, and the roster is alphabetical so a name always sits
 * where the reader expects.
 *
 * Selection is still by id; the text box is only a means of finding it. Typing
 * something that matches nobody therefore selects nobody, and the field snaps
 * back to the current selection on blur rather than leaving a half-typed name
 * looking authoritative.
 */
export function PlayerAutocomplete({
  players,
  value,
  onChange,
  label,
  disabled,
  excludeIds = [],
  seasonEloMap,
  emptyLabel,
  placeholder,
  compact = false,
}: PlayerAutocompleteProps) {
  const { t } = useTranslation();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);

  const selected = players.find((p) => p.id === value) ?? null;

  const options = useMemo(() => {
    const available = players.filter((p) => !excludeIds.includes(p.id));
    // While closed the box shows the selection, so an unfiltered list is right
    // on open; once the user types, that text is the filter.
    return filterPlayers(available, open ? query : "");
  }, [players, excludeIds, query, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlight(-1);
  };

  // Close when a click lands outside the widget entirely.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  });

  const commit = (playerId: string) => {
    onChange(playerId);
    close();
    inputRef.current?.blur();
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setHighlight(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      setHighlight((h) => nextHighlight(h, e.key === "ArrowDown" ? 1 : -1, options.length));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      // Enter with nothing highlighted takes the only match, which is what a
      // near-complete name usually leaves.
      const pick = highlight >= 0 ? options[highlight] : options.length === 1 ? options[0] : null;
      if (pick) commit(pick.id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Backspace" && !query && selected) {
      // Backspacing an empty box clears the selection rather than doing nothing.
      onChange("");
    }
  };

  const eloOf = (player: Player) =>
    seasonEloMap?.get(player.id) ?? player.current_elo;

  const displayValue = open ? query : (selected?.name ?? "");

  return (
    <div
      className={`player-ac ${compact ? "player-ac--compact" : "form-group"}`}
      ref={rootRef}
    >
      {label && <label htmlFor={`${listId}-input`}>{label}</label>}
      <div className="player-ac-field">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder ?? t("playerPicker.placeholder")}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {selected && !disabled && (
          <button
            type="button"
            className="player-ac-clear"
            aria-label={t("playerPicker.clear")}
            title={t("playerPicker.clear")}
            onClick={() => {
              onChange("");
              close();
            }}
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <ul className="player-ac-list" id={listId} role="listbox">
          {emptyLabel && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={`player-ac-option${!value ? " selected" : ""}`}
                onClick={() => commit("")}
              >
                {emptyLabel}
              </button>
            </li>
          )}
          {options.length === 0 && !emptyLabel && (
            <li className="player-ac-empty">{t("playerPicker.noMatch")}</li>
          )}
          {options.map((player, i) => (
            <li key={player.id}>
              <button
                type="button"
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={player.id === value}
                className={`player-ac-option${i === highlight ? " active" : ""}${
                  player.id === value ? " selected" : ""
                }`}
                // Pointer-down would blur the input before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(player.id)}
              >
                <span className="player-ac-name">{player.name}</span>
                <span className="player-ac-elo">{eloOf(player)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
