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

  if (loading) return <div className="loading-state">Loading users...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="card">
      <h2>User Management</h2>
      <table className="user-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.id} className={profile.id === user?.id ? "current-user-row" : ""}>
              <td>
                {profile.email}
                {profile.id === user?.id && <span className="badge-you"> (you)</span>}
              </td>
              <td>
                <select
                  value={profile.role}
                  onChange={(e) => handleRoleChange(profile.id, e.target.value as Role)}
                  disabled={saving === profile.id || profile.id === user?.id}
                  className="role-select"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {saving === profile.id && <span className="saving-indicator"> saving...</span>}
              </td>
              <td className="text-light">
                {new Date(profile.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
