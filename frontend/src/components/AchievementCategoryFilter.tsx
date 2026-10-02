import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ACHIEVEMENT_CATEGORIES,
  type AchievementCategory,
} from "../lib/achievements";

interface AchievementCategoryFilterProps {
  /** Empty means every category. */
  selected: AchievementCategory[];
  onChange: (selected: AchievementCategory[]) => void;
  /** Per-category count shown on each option: `unlocked/total`, or just `total`. */
  counts?: Partial<
    Record<AchievementCategory, { total: number; unlocked?: number }>
  >;
  /**
   * With several picked, the trigger shows emoji-only badges, this many before
   * the rest collapse into "+N". A single pick always shows its full badge.
   */
  maxBadges?: number;
  /** Open the list from the trigger's left edge rather than its right. */
  alignStart?: boolean;
}

export function CategoryBadge({
  id,
  compact = false,
}: {
  id: AchievementCategory;
  /** Emoji only; the name stays for screen readers and the tooltip. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const icon = ACHIEVEMENT_CATEGORIES.find((c) => c.id === id)?.icon;
  return (
    <span
      className={`cat-badge cat-badge--${id}${compact ? " cat-badge--compact" : ""}`}
      title={compact ? t(`achievementCategories.${id}`) : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="cat-badge-label">
        {t(`achievementCategories.${id}`)}
      </span>
    </span>
  );
}

/**
 * Multi-select dropdown of category badges. Nothing picked means "all", so the
 * list's first option, "All categories", is simply the empty selection.
 */
export function AchievementCategoryFilter({
  selected,
  onChange,
  counts,
  maxBadges = 4,
  alignStart = false,
}: AchievementCategoryFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 0 is "All categories", 1..n the categories.
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionCount = ACHIEVEMENT_CATEGORIES.length + 1;

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const toggle = (index: number) => {
    if (index === 0) {
      onChange([]);
      return;
    }
    const id = ACHIEVEMENT_CATEGORIES[index - 1].id;
    const next = selected.includes(id)
      ? selected.filter((c) => c !== id)
      : [...selected, id];
    // Keep filter order, whatever order they were clicked in.
    onChange(
      ACHIEVEMENT_CATEGORIES.map((c) => c.id).filter((c) => next.includes(c)),
    );
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onListKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (h + 1) % optionCount);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => (h - 1 + optionCount) % optionCount);
        break;
      case "Home":
        e.preventDefault();
        setHighlight(0);
        break;
      case "End":
        e.preventDefault();
        setHighlight(optionCount - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        toggle(highlight);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const compact = selected.length > 1;
  const shown = compact ? selected.slice(0, maxBadges) : selected;
  const rest = selected.length - shown.length;

  return (
    <div
      className={`cat-filter${alignStart ? " cat-filter--start" : ""}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`cat-filter-trigger${selected.length > 0 ? " has-clear" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t("achievements.categoryFilter")}
        onClick={() => {
          setHighlight(0);
          setOpen((o) => !o);
        }}
      >
        {selected.length === 0 ? (
          <span className="cat-filter-all">
            {t("achievements.allCategories")}
          </span>
        ) : (
          <>
            {shown.map((id) => (
              <CategoryBadge key={id} id={id} compact={compact} />
            ))}
            {rest > 0 && (
              <span className="cat-filter-more">
                {t("achievements.moreCategories", { count: rest })}
              </span>
            )}
          </>
        )}
        <span className="cat-filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {/* A sibling over the trigger, since a button can't hold a button. */}
      {selected.length > 0 && (
        <button
          type="button"
          className="cat-filter-clear"
          aria-label={t("achievements.clearCategories")}
          title={t("achievements.clearCategories")}
          onClick={() => {
            onChange([]);
            triggerRef.current?.focus();
          }}
        >
          ✕
        </button>
      )}
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="cat-filter-list"
          role="listbox"
          aria-multiselectable="true"
          aria-label={t("achievements.categoryFilter")}
          aria-activedescendant={`${listId}-${highlight}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          {[null, ...ACHIEVEMENT_CATEGORIES].map((cat, index) => {
            const isSelected =
              cat === null ? selected.length === 0 : selected.includes(cat.id);
            const count = cat ? counts?.[cat.id] : undefined;
            return (
              <li
                key={cat?.id ?? "all"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`cat-filter-option${index === highlight ? " active" : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => toggle(index)}
              >
                <span className="cat-filter-check" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </span>
                {cat === null ? (
                  <span className="cat-filter-all">
                    {t("achievements.allCategories")}
                  </span>
                ) : (
                  <CategoryBadge id={cat.id} />
                )}
                {count && (
                  <span className="cat-filter-count">
                    {count.unlocked !== undefined
                      ? `${count.unlocked}/${count.total}`
                      : count.total}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
