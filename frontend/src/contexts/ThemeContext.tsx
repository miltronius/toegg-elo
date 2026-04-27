import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "win95";

const COOKIE = "toegg-theme";
const MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(): Theme {
  if (typeof document === "undefined") return "light";
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`));
  const v = m?.[1];
  return v === "dark" || v === "win95" ? v : "light";
}

function writeCookie(t: Theme) {
  document.cookie = `${COOKIE}=${t};max-age=${MAX_AGE};path=/;SameSite=Lax`;
}

type ThemeCtx = { theme: Theme; setTheme: (t: Theme) => void };
const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readCookie();
    document.documentElement.setAttribute("data-theme", t);
    return t;
  });

  function setTheme(t: Theme) {
    setThemeState(t);
    writeCookie(t);
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}
