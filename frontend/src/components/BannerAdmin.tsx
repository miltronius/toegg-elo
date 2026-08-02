import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  createBanner,
  deleteBanner,
  reorderBanners,
  updateBanner,
  type Banner,
  type BannerInput,
  type Season,
} from "../lib/supabase";
import {
  BANNER_AUDIENCES,
  BANNER_DURATIONS,
  SEASON_BANNER_DAYS,
  addDuration,
  bannerStatus,
  maskSwissDateTime,
  parseSwissDateTime,
  isGeneratedSeasonBanner,
  moveItem,
  orderBanners,
  toSwissDateTime,
  SWISS_DATETIME_FORMAT,
  type BannerAudience,
  type BannerDuration,
  type BannerStatus,
} from "../lib/banners";
import { bannerDisplayText, storedMessage } from "../lib/bannerText";
import { DATE_LOCALE } from "../lib/i18n";

interface BannerAdminProps {
  banners: Banner[];
  seasons: Season[];
  onChanged: () => void;
}

/** Chip colour per status - live is the only "good news" state. */
const STATUS_CLASS: Record<BannerStatus, string> = {
  live: "bg-success-light text-success border-success",
  scheduled: "bg-bg-light text-primary border-primary",
  expired: "bg-bg-light text-text-light border-border",
  hidden: "bg-bg-light text-warning border-warning",
};

/**
 * Two independent controls, not one three-way choice.
 *
 * An earlier version offered "show now / scheduled / hidden", which was
 * redundant: hiding and scheduling are not alternatives. Hiding is a switch
 * ("never show this"), scheduling is a window ("show it between these times"),
 * and every combination of the two is meaningful. So `isActive` is a plain
 * on/off and the window is always available - both bounds optional, no window
 * at all meaning "from now until I turn it off".
 */
type FormState = {
  message: string;
  isActive: boolean;
  audience: BannerAudience;
  from: string;
  until: string;
};

/**
 * A function, not a constant: "from" defaults to the moment the form is opened,
 * so the common case (announce something starting now, for a while) needs only
 * a run-length click. Clearing the field still means "no lower bound".
 */
const emptyForm = (): FormState => ({
  message: "",
  isActive: true,
  audience: "everyone",
  from: toSwissDateTime(new Date().toISOString()),
  until: "",
});

const formFor = (
  banner: Banner,
  seasons: Season[],
  t: TFunction,
): FormState => ({
  // The text the banner actually shows, so a season banner's generated
  // announcement can be edited in place. Leaving it untouched still stores NULL
  // (see storedMessage), so it keeps being translated per viewer.
  message: bannerDisplayText(banner, seasons, t),
  isActive: banner.is_active,
  audience: banner.audience,
  from: toSwissDateTime(banner.starts_at),
  until: toSwissDateTime(banner.ends_at),
});

/**
 * Admin-only banner management: one form that doubles as create and edit, plus
 * the list of every banner the admin can see (hidden and expired included -
 * RLS widens the read for admins specifically so this list is complete).
 *
 * Banners arrive as a prop from App's single query rather than being fetched
 * here, so the admin list and the live banner can never disagree.
 */
export function BannerAdmin({ banners, seasons, onChanged }: BannerAdminProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drag state. `pendingOrder` doubles as the optimistic order shown while a
  // drag is in progress and the payload sent when it ends.
  const [dragId, setDragId] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);

  const now = Date.now();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setError(null);
  };

  // The list to render: the optimistic order while one is pending, else
  // whatever the server says.
  const ordered = (() => {
    const sorted = orderBanners(banners);
    if (!pendingOrder) return sorted;

    const byId = new Map(sorted.map((b) => [b.id, b]));
    const moved = pendingOrder
      .map((id) => byId.get(id))
      .filter((b): b is Banner => b !== undefined);
    // Anything created elsewhere mid-drag still has to appear.
    const seen = new Set(pendingOrder);
    return [...moved, ...sorted.filter((b) => !seen.has(b.id))];
  })();

  // Drop the optimistic order once the refetch has caught up with it, rather
  // than clearing on success - that would flash the old order for a moment.
  useEffect(() => {
    if (!pendingOrder) return;
    const live = orderBanners(banners).map((b) => b.id);
    if (live.length === pendingOrder.length && live.every((id, i) => id === pendingOrder[i])) {
      setPendingOrder(null);
    }
  }, [banners, pendingOrder]);

  /** Reorder locally; the write happens once the drag ends. */
  const moveTo = (id: string, to: number) => {
    const ids = ordered.map((b) => b.id);
    const next = moveItem(ids, ids.indexOf(id), to);
    if (next !== ids) setPendingOrder(next);
  };

  /** Set "until" to `duration` after the start (or after now, if unset). */
  const setRunLength = (duration: BannerDuration) => {
    const start = parseSwissDateTime(form.from);
    const startMs = start.kind === "ok" ? Date.parse(start.iso) : Date.now();
    set(
      "until",
      toSwissDateTime(new Date(addDuration(startMs, duration)).toISOString()),
    );
  };

  const commitOrder = async () => {
    setDragId(null);
    if (!pendingOrder) return;
    try {
      await reorderBanners(pendingOrder);
      onChanged();
    } catch (e) {
      setPendingOrder(null); // fall back to the server's order
      setError(e instanceof Error ? e.message : t("bannerAdmin.reorderError"));
    }
  };

  const editing = editingId
    ? (banners.find((b) => b.id === editingId) ?? null)
    : null;
  /** Season banners may be left blank; that reverts them to the translation. */
  const isSeasonBanner = editing?.season_id != null;

  const handleSubmit = async () => {
    if (!form.message.trim() && !isSeasonBanner) {
      setError(t("bannerAdmin.messageRequired"));
      return;
    }
    const message = storedMessage(form.message, editing, seasons, t);

    // The window is stored exactly as typed, whether or not the banner is
    // currently switched on - hiding one must not throw away its dates. A typo
    // is reported rather than dropped: silently reading "31.02.2026" as "no end
    // date" would publish a banner that never stops.
    const from = parseSwissDateTime(form.from);
    const until = parseSwissDateTime(form.until);
    if (from.kind === "invalid" || until.kind === "invalid") {
      setError(t("bannerAdmin.dateInvalid", { format: SWISS_DATETIME_FORMAT }));
      return;
    }
    const starts_at = from.kind === "ok" ? from.iso : null;
    const ends_at = until.kind === "ok" ? until.iso : null;
    if (starts_at && ends_at && Date.parse(ends_at) <= Date.parse(starts_at)) {
      setError(t("bannerAdmin.windowOrder"));
      return;
    }

    const input: BannerInput = {
      message,
      starts_at,
      ends_at,
      is_active: form.isActive,
      audience: form.audience,
    };

    setSaving(true);
    setError(null);
    try {
      if (editingId) await updateBanner(editingId, input);
      else await createBanner(input);
      resetForm();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bannerAdmin.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (banner: Banner) => {
    setBusyId(banner.id);
    setError(null);
    try {
      await updateBanner(banner.id, { is_active: !banner.is_active });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bannerAdmin.saveError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (banner: Banner) => {
    if (!confirm(t("bannerAdmin.confirmDelete"))) return;
    setBusyId(banner.id);
    setError(null);
    try {
      await deleteBanner(banner.id);
      if (editingId === banner.id) resetForm();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bannerAdmin.deleteError"));
    } finally {
      setBusyId(null);
    }
  };

  const formatMoment = (iso: string) =>
    new Date(iso).toLocaleString(DATE_LOCALE, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const windowLabel = (banner: Banner) => {
    const { starts_at, ends_at } = banner;
    if (starts_at && ends_at)
      return t("bannerAdmin.windowBoth", {
        from: formatMoment(starts_at),
        until: formatMoment(ends_at),
      });
    if (starts_at)
      return t("bannerAdmin.windowFrom", { from: formatMoment(starts_at) });
    if (ends_at)
      return t("bannerAdmin.windowUntil", { until: formatMoment(ends_at) });
    return t("bannerAdmin.windowOpen");
  };

  return (
    <div className="card mt-6">
      <h2>{t("bannerAdmin.title")}</h2>
      <p className="text-text-light text-[0.85rem] mt-1 mb-4">
        {t("bannerAdmin.hint", { days: SEASON_BANNER_DAYS })}
      </p>

      <div className="form-group">
        <label htmlFor="banner-message">{t("bannerAdmin.message")}</label>
        <input
          id="banner-message"
          type="text"
          maxLength={500}
          value={form.message}
          placeholder={t("bannerAdmin.messagePlaceholder")}
          onChange={(e) => set("message", e.target.value)}
          disabled={saving}
        />
        {isSeasonBanner && (
          <span className="block text-[0.78rem] text-text-light mt-1">
            {t("bannerAdmin.seasonMessageHint")}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="form-group">
          <span className="block font-medium mb-2">
            {t("bannerAdmin.audience")}
          </span>
          <div
            className="lb-toggle w-fit"
            role="group"
            aria-label={t("bannerAdmin.audience")}
          >
            {BANNER_AUDIENCES.map((a) => (
              <button
                key={a}
                type="button"
                className={`lb-toggle-btn${form.audience === a ? " active" : ""}`}
                aria-pressed={form.audience === a}
                onClick={() => set("audience", a)}
                disabled={saving}
              >
                {t(`bannerAdmin.audiences.${a}`)}
              </button>
            ))}
          </div>
          <span className="block text-[0.78rem] text-text-light mt-1">
            {t(`bannerAdmin.audienceHint.${form.audience}`)}
          </span>
        </div>

        <div className="form-group">
          <span className="block font-medium mb-2">
            {t("bannerAdmin.state")}
          </span>
          <div
            className="lb-toggle w-fit"
            role="group"
            aria-label={t("bannerAdmin.state")}
          >
            {[true, false].map((active) => (
              <button
                key={String(active)}
                type="button"
                className={`lb-toggle-btn${form.isActive === active ? " active" : ""}`}
                aria-pressed={form.isActive === active}
                onClick={() => set("isActive", active)}
                disabled={saving}
              >
                {t(active ? "bannerAdmin.states.on" : "bannerAdmin.states.off")}
              </button>
            ))}
          </div>
          <span className="block text-[0.78rem] text-text-light mt-1">
            {t(form.isActive ? "bannerAdmin.stateHintOn" : "bannerAdmin.stateHintOff")}
          </span>
        </div>
      </div>

      {/* Always available: the window and the on/off switch are independent, so
          a hidden banner keeps its dates and a visible one may have none. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="form-group">
          <label htmlFor="banner-from">{t("bannerAdmin.from")}</label>
          <input
            id="banner-from"
            type="text"
            inputMode="numeric"
            maxLength={16}
            placeholder={SWISS_DATETIME_FORMAT}
            value={form.from}
            onChange={(e) => set("from", maskSwissDateTime(e.target.value))}
            disabled={saving}
          />
          <span className="block text-[0.78rem] text-text-light mt-1">
            {t("bannerAdmin.fromHint", { format: SWISS_DATETIME_FORMAT })}
          </span>
        </div>
        <div className="form-group">
          <label htmlFor="banner-until">{t("bannerAdmin.until")}</label>
          <input
            id="banner-until"
            type="text"
            inputMode="numeric"
            maxLength={16}
            placeholder={SWISS_DATETIME_FORMAT}
            value={form.until}
            onChange={(e) => set("until", maskSwissDateTime(e.target.value))}
            disabled={saving}
          />
          {/* Run lengths measured from the start, so picking one answers "how
              long should this run?" rather than "what date is two weeks out?".
              An empty start means now. */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {BANNER_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className="btn-small"
                onClick={() => setRunLength(d)}
                disabled={saving}
              >
                {t(`bannerAdmin.durations.${d}`)}
              </button>
            ))}
            {form.until && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => set("until", "")}
                disabled={saving}
              >
                {t("bannerAdmin.clearUntil")}
              </button>
            )}
          </div>
          <span className="block text-[0.78rem] text-text-light mt-1">
            {t("bannerAdmin.untilHint", { format: SWISS_DATETIME_FORMAT })}
          </span>
        </div>
      </div>

      {error && (
        <p className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-3">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSubmit}
          disabled={saving || (!form.message.trim() && !isSeasonBanner)}
        >
          {saving
            ? t("bannerAdmin.saving")
            : editingId
              ? t("bannerAdmin.save")
              : t("bannerAdmin.create")}
        </button>
        {editingId && (
          <button
            type="button"
            className="btn-secondary"
            onClick={resetForm}
            disabled={saving}
          >
            {t("bannerAdmin.cancel")}
          </button>
        )}
      </div>

      <div className="mt-6 pt-4 border-t border-border-light">
        <h3 className="font-semibold">{t("bannerAdmin.existing")}</h3>
        {banners.length === 0 ? (
          <p className="text-text-light text-[0.85rem] mt-2">
            {t("bannerAdmin.empty")}
          </p>
        ) : (
          <>
            <p className="text-text-light text-[0.8rem] mt-1">
              {t("bannerAdmin.reorderHint")}
            </p>
            <ul className="list-none p-0 m-0 mt-3 flex flex-col gap-2">
              {ordered.map((banner, index) => {
              const status = bannerStatus(banner, now);
              return (
                <li
                  key={banner.id}
                  // The row is only draggable once the grip is pressed, so
                  // dragging a button or selecting text still behaves normally.
                  draggable={dragId === banner.id}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    moveTo(dragId, index);
                  }}
                  onDragEnd={commitOrder}
                  onDrop={(e) => e.preventDefault()}
                  className={`banner-row border border-border rounded-md p-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${
                    editingId === banner.id ? "bg-bg-light" : ""
                  }${dragId === banner.id ? " dragging" : ""}`}
                >
                  <span
                    className="banner-grip"
                    role="button"
                    tabIndex={0}
                    aria-label={t("bannerAdmin.reorderGrip")}
                    title={t("bannerAdmin.reorderGrip")}
                    onPointerDown={() => setDragId(banner.id)}
                    onPointerUp={() => setDragId(null)}
                    // Keyboard equivalent: dragging is unusable without a
                    // mouse, so the grip moves the row with the arrow keys.
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      moveTo(banner.id, index + (e.key === "ArrowUp" ? -1 : 1));
                    }}
                    onKeyUp={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") commitOrder();
                    }}
                    aria-hidden={false}
                  >
                    ⠿
                  </span>
                  <span
                    className={`text-[0.7rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASS[status]}`}
                  >
                    {t(`bannerAdmin.statuses.${status}`)}
                  </span>
                  {banner.season_id && (
                    <span
                      className="text-[0.7rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-bg-light text-text-light border-border"
                      title={t("bannerAdmin.seasonBannerTitle")}
                    >
                      {t("bannerAdmin.seasonBadge")}
                    </span>
                  )}
                  {/* Shows the translated default for a season banner the admin
                      hasn't overridden - i.e. exactly what viewers see. */}
                  <span
                    className={`flex-1 min-w-40 break-words ${
                      isGeneratedSeasonBanner(banner) ? "italic" : ""
                    }`}
                  >
                    {bannerDisplayText(banner, seasons, t)}
                  </span>
                  <span className="text-text-light text-[0.78rem] whitespace-nowrap">
                    {t(`bannerAdmin.audiences.${banner.audience}`)} ·{" "}
                    {windowLabel(banner)}
                  </span>
                  <span className="flex gap-2 ml-auto">
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => handleToggle(banner)}
                      disabled={busyId === banner.id}
                    >
                      {banner.is_active
                        ? t("bannerAdmin.hide")
                        : t("bannerAdmin.show")}
                    </button>
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => {
                        setForm(formFor(banner, seasons, t));
                        setEditingId(banner.id);
                        setError(null);
                      }}
                      disabled={busyId === banner.id}
                    >
                      {t("bannerAdmin.edit")}
                    </button>
                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => handleDelete(banner)}
                      disabled={busyId === banner.id}
                    >
                      {t("bannerAdmin.delete")}
                    </button>
                  </span>
                </li>
              );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
