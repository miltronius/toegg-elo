import { useEffect, useState } from "react";
import { getAllProfiles, updateUserRole, type Profile, type Role } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

const ROLES: Role[] = ["viewer", "user", "admin"];

export function UserManagement() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="text-center p-8 text-text-light">Loading users...</div>;
  if (error) return <div className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error">{error}</div>;

  return (
    <div className="card">
      <h2>User Management</h2>
      <table className="w-full border-collapse mt-4 text-[0.9rem]">
        <thead>
          <tr>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">Email</th>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">Role</th>
            <th className="text-left px-3 py-2.5 border-b-2 border-border text-text-light font-semibold">Joined</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.id} className={profile.id === user?.id ? "bg-bg-light" : ""}>
              <td className="px-3 py-2.5 border-b border-border-light">
                {profile.email}
                {profile.id === user?.id && <span className="text-text-light text-[0.8rem]"> (you)</span>}
              </td>
              <td className="px-3 py-2.5 border-b border-border-light">
                <select
                  value={profile.role}
                  onChange={(e) => handleRoleChange(profile.id, e.target.value as Role)}
                  disabled={saving === profile.id || profile.id === user?.id}
                  className="px-2 py-1.5 border border-border rounded-md text-[0.875rem] bg-white cursor-pointer disabled:opacity-60 disabled:cursor-default font-[inherit]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {saving === profile.id && <span className="text-text-light text-[0.8rem] ml-2">saving...</span>}
              </td>
              <td className="px-3 py-2.5 border-b border-border-light text-text-light">
                {new Date(profile.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
