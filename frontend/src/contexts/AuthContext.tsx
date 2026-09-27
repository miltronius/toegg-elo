import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, getMyRole, getMyPlayerId, type Role } from "../lib/supabase";

type AuthContextType = {
  user: User | null;
  role: Role | null;
  /** The player this account has claimed, or null. */
  myPlayerId: string | null;
  /** Re-reads myPlayerId, e.g. right after a claim. */
  refreshMyPlayer: () => Promise<void>;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadIdentity = (userId: string) => {
    getMyRole().then(setRole).catch(() => setRole(null));
    getMyPlayerId(userId).then(setMyPlayerId).catch(() => setMyPlayerId(null));
  };

  const refreshMyPlayer = async () => {
    if (!user) return;
    setMyPlayerId(await getMyPlayerId(user.id));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadIdentity(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadIdentity(session.user.id);
      } else {
        setRole(null);
        setMyPlayerId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, role, myPlayerId, refreshMyPlayer, loading, signIn, signInWithMagicLink, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

const NO_ME = {
  role: null,
  myPlayerId: null,
  refreshMyPlayer: async () => {},
};

/**
 * The signed-in account's role and linked player, for components that only
 * *mark* things ("you", rename rights). Unlike useAuth it doesn't throw
 * outside a provider, so those components keep rendering in isolation (tests).
 */
export function useMe(): {
  role: Role | null;
  myPlayerId: string | null;
  refreshMyPlayer: () => Promise<void>;
} {
  const ctx = useContext(AuthContext);
  return ctx
    ? {
        role: ctx.role,
        myPlayerId: ctx.myPlayerId,
        refreshMyPlayer: ctx.refreshMyPlayer,
      }
    : NO_ME;
}
