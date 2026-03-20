import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export function AuthScreen({ onClose }: { onClose?: () => void }) {
  const { signIn, signInWithMagicLink, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginMethod, setLoginMethod] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "login" && loginMethod === "magic") {
        await signInWithMagicLink(email);
        setMagicLinkSent(true);
      } else if (mode === "login") {
        await signIn(email, password);
        onClose?.();
      } else {
        await signUp(email, password);
        setSignedUp(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>TöggElo⚽</h1>
          <div className="auth-success">
            <p>Magic link sent! Check your email and click the link to sign in.</p>
            <button className="btn-primary" onClick={() => { setMagicLinkSent(false); setError(null); }}>
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (signedUp) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>TöggElo⚽</h1>
          <div className="auth-success">
            <p>Account created! Check your email to confirm your address, then log in.</p>
            <button className="btn-primary" onClick={() => { setMode("login"); setSignedUp(false); }}>
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        {onClose && (
          <button className="auth-close-btn" onClick={onClose}>✕</button>
        )}
        <h1>TöggElo⚽</h1>
        <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
        {mode === "login" && (
          <div className="auth-method-toggle lb-toggle" data-method={loginMethod}>
            <button
              type="button"
              className={`lb-toggle-btn${loginMethod === "password" ? " active" : ""}`}
              onClick={() => { setLoginMethod("password"); setError(null); }}
            >
              Password
            </button>
            <button
              type="button"
              className={`lb-toggle-btn${loginMethod === "magic" ? " active" : ""}`}
              onClick={() => { setLoginMethod("magic"); setError(null); }}
            >
              Magic link
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoFocus
            />
          </div>
          <div className={`form-group-collapsible${mode === "login" && loginMethod === "magic" ? " collapsed" : ""}`}>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={mode === "signup" || loginMethod === "password"}
                disabled={loading || (mode === "login" && loginMethod === "magic")}
                minLength={6}
              />
            </div>
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? "..." : mode === "login" && loginMethod === "magic" ? "Send magic link" : mode === "login" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
          <button
            className="btn-link"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
        {mode === "signup" && (
          <p className="auth-note">New accounts start as viewers. An admin needs to grant you access.</p>
        )}
      </div>
    </div>
  );
}
