import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  adminLinkPlayer,
  getAllPlayerAccounts,
  getAllProfiles,
  recomputeAllAchievementsAdmin,
  unlinkPlayer,
  updateUserRole,
  type Player,
  type PlayerAccount,
  type Profile,
  type Role,
} from "../lib/supabase";
import { linkErrorKey } from "../lib/playerLinking";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import { useAuth } from "../contexts/AuthContext";
import { DATE_LOCALE } from "../lib/i18n";

const ROLES: Role[] = ["viewer", "user", "admin"];

export function UserManagement({
  players,
  onRecomputed,
  onLinksChanged,
}: {
  players: Player[];
  onRecomputed?: () => void;
  onLinksChanged?: () => void;
}) {
  const { t } = useTranslation();
  const { user, refreshMyPlayer } = useAuth();
  const [links, setLinks] = useState<PlayerAccount[]>([]);
  // Profile currently choosing a player (Link or Change), or null.
  const [picking, setPicking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAllProfiles(), getAllPlayerAccounts()])
      .then(([p, l]) => {
        setProfiles(p);
        setLinks(l);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleRoleChange = async (profileId: string, newRole: Role) => {
    setSaving(profileId);
    try {
      await updateUserRole(profileId, newRole);
      setProfiles((prev) =>
        prev.map((p) => (p.id === profileId ? { ...p, role: newRole } : p))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("userManagement.updateRoleError"));
    } finally {
      setSaving(null);
    }
  };

  const playerById = new Map(players.map((p) => [p.id, p]));
  const linkedPlayerIds = links.map((l) => l.player_id);

  const afterLinkChange = async (profileId: string) => {
    try {
      setLinks(await getAllPlayerAccounts());
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : t("userManagement.linkError"));
    }
    if (profileId === user?.id) await refreshMyPlayer();
    onLinksChanged?.();
  };

  const reportLinkError = (e: unknown) =>
    setLinkError(t(linkErrorKey(e) ?? "userManagement.linkError"));

  const handleLink = async (profile: Profile, playerId: string) => {
    if (!playerId) return;
    setSaving(profile.id);
    setLinkError(null);
    const current = links.find((l) => l.user_id === profile.id);
    try {
      // Change = unlink + link, as the spec defines a reassign. If the link
      // half fails the account is left unlinked, and the error says why.
      if (current) await unlinkPlayer(current.player_id);
      await adminLinkPlayer(profile.id, playerId);
    } catch (e) {
      reportLinkError(e);
    } finally {
      setPicking(null);
      setSaving(null);
      await afterLinkChange(profile.id);
    }
  };

  const handleUnlink = async (profile: Profile, link: PlayerAccount) => {
    const name = playerById.get(link.player_id)?.name ?? "?";
    if (
      !confirm(
        t("userManagement.confirmUnlink", { player: name, email: profile.email }),
      )
    )
      return;
    setSaving(profile.id);
    setLinkError(null);
    try {
      await unlinkPlayer(link.player_id);
    } catch (e) {
      reportLinkError(e);
    } finally {
      setSaving(null);
      await afterLinkChange(profile.id);
    }
  };

  const renderPlayerCell = (profile: Profile) => {
    const link = links.find((l) => l.user_id === profile.id);
    const busy = saving === profile.id;
    if (picking === profile.id) {
      return (
        <div className="flex items-center gap-2">
          <PlayerAutocomplete
            compact
            players={players}
            value=""
            excludeIds={linkedPlayerIds}
            placeholder={t("userManagement.pickPlayer")}
            onChange={(id) => handleLink(profile, id)}
            disabled={busy}
          />
          <button
            className="btn-small btn-cancel"
            onClick={() => setPicking(null)}
            disabled={busy}
          >
            ✕
          </button>
        </div>
      );
    }
    if (link) {
      return (
        <div className="flex items-center gap-2">
          <span>🪪 {playerById.get(link.player_id)?.name ?? "?"}</span>
          <button
            className="btn-small"
            onClick={() => setPicking(profile.id)}
            disabled={busy}
          >
            {t("userManagement.change")}
          </button>
          <button
            className="btn-small btn-cancel"
            onClick={() => handleUnlink(profile, link)}
            disabled={busy}
          >
            {t("userManagement.unlink")}
          </button>
        </div>
      );
    }
    if (profile.role === "viewer") {
      return (
        <span className="text-text-light text-[0.8rem]">
          {t("userManagement.linkViewerHint")}
        </span>
      );
    }
    return (
      <button
        className="btn-small"
        onClick={() => setPicking(profile.id)}
        disabled={busy}
      >
        {t("userManagement.link")}
      </button>
    );
  };

  const handleRecompute = async () => {
    setRecomputing(true);
    setRecomputeMsg(null);
    try {
      const { players, matches } = await recomputeAllAchievementsAdmin();
      setRecomputeMsg(
        t("userManagement.recomputeDone", { players, matches })
      );
      onRecomputed?.();
    } catch (e) {
      setRecomputeMsg(
        e instanceof Error ? e.message : t("userManagement.recomputeError")
      );
    } finally {
      setRecomputing(false);
    }
  };

  if (loading) return <div className="text-center p-8 text-text-light">{t("userManagement.loading")}</div>;
  if (error) return <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error">{error}</div>;

  return (
    <div className="card">
      <h2>{t("userManagement.title")}</h2>
      {linkError && (
        <div
          role="alert"
          className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mt-4"
        >
          {linkError}
        </div>
      )}
      <table className="w-full border-collapse mt-4 text-[0.9rem]">
        <thead>
          <tr>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">{t("userManagement.email")}</th>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">{t("userManagement.role")}</th>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">{t("userManagement.player")}</th>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">{t("userManagement.joined")}</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.id} className={profile.id === user?.id ? "bg-bg-light" : ""}>
              <td className="px-3 py-2.5 border-b border-border-light">
                {profile.email}
                {profile.id === user?.id && <span className="text-text-light text-[0.8rem]">{t("userManagement.you")}</span>}
              </td>
              <td className="px-3 py-2.5 border-b border-border-light">
                <select
                  value={profile.role}
                  onChange={(e) => handleRoleChange(profile.id, e.target.value as Role)}
                  disabled={saving === profile.id || profile.id === user?.id}
                  className="px-2 py-1.5 border border-border rounded-md text-[0.875rem] bg-white cursor-pointer disabled:opacity-60 disabled:cursor-default font-[inherit]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{t(`userManagement.roles.${r}`)}</option>
                  ))}
                </select>
                {saving === profile.id && <span className="text-text-light text-[0.8rem] ml-2">{t("userManagement.saving")}</span>}
              </td>
              <td className="px-3 py-2.5 border-b border-border-light">
                {renderPlayerCell(profile)}
              </td>
              <td className="px-3 py-2.5 border-b border-border-light text-text-light">
                {new Date(profile.created_at).toLocaleDateString(DATE_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 pt-4 border-t border-border-light">
        <h3 className="font-semibold">{t("userManagement.achievements")}</h3>
        <p className="text-text-light text-[0.85rem] mt-1 mb-3">
          {t("userManagement.rebuildHint")}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRecompute}
            disabled={recomputing}
            className="btn-secondary disabled:opacity-60 disabled:cursor-default"
          >
            {recomputing ? t("userManagement.recomputing") : t("userManagement.recompute")}
          </button>
          {recomputeMsg && (
            <span className="text-text-light text-[0.85rem]">{recomputeMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}
