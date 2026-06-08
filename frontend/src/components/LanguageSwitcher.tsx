import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type Language } from "../lib/i18n";

const LABELS: Record<Language, { label: string; title: string }> = {
  en: { label: "EN", title: "English" },
  de: { label: "DE", title: "Deutsch" },
};

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (SUPPORTED_LANGUAGES.find((l) => i18n.language?.startsWith(l)) ??
    "en") as Language;

  return (
    <div className="lb-toggle" title={t("language.switch")}>
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          className={`lb-toggle-btn${current === lng ? " active" : ""}`}
          onClick={() => i18n.changeLanguage(lng)}
          title={LABELS[lng].title}
          aria-pressed={current === lng}
        >
          {LABELS[lng].label}
        </button>
      ))}
    </div>
  );
}
