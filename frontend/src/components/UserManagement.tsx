import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getAllProfiles,
  recomputeAllAchievementsAdmin,
  updateUserRole,
  type Profile,
  type Role,
} from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { DATE_LOCALE } from "../lib/i18n";

const ROLES: Role[] = ["viewer", "user", "admin"];

export function UserManagement({ onRecomputed }: { onRecomputed?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  useEffect(() => {
    getAllProfiles()
      .then(setProfiles)
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
      <table className="w-full border-collapse mt-4 text-[0.9rem]">
        <thead>
          <tr>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">{t("userManagement.email")}</th>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">{t("userManagement.role")}</th>
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
