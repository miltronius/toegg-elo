import { useTheme, type Theme } from "../contexts/ThemeContext";

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "light", label: "☀️", title: "Light theme" },
  { value: "dark", label: "🌙", title: "Dark theme" },
  { value: "win95", label: "🪟", title: "Windows 95 theme" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="lb-toggle" title="Switch theme">
      {OPTIONS.map(({ value, label, title }) => (
        <button
          key={value}
          className={`lb-toggle-btn${theme === value ? " active" : ""}`}
          onClick={() => setTheme(value)}
          title={title}
          aria-pressed={theme === value}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
