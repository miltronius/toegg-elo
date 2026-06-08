import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../locales/en.json';
import de from '../locales/de.json';

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// Dates are always rendered in Swiss/German style (dd.mm.yyyy, dots, 24h),
// independent of the selected UI language — the league is Swiss, so a US-style
// date in English mode would be confusing. Centralized here so every
// toLocale*String call shares one source of truth.
export const DATE_LOCALE = 'de-CH';

// Persist the choice in a cookie the same way the theme is stored
// (toegg-theme), so language survives reloads and is sent with SSR-less
// requests. The detector reads/writes this cookie automatically.
const COOKIE = 'toegg-lang';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true, // treat 'de-CH' as 'de'
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['cookie', 'navigator'],
      caches: ['cookie'],
      lookupCookie: COOKIE,
      cookieMinutes: COOKIE_MAX_AGE / 60,
      cookieOptions: { path: '/', sameSite: 'lax' },
    },
  });

export default i18n;
