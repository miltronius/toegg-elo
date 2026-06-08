import "@testing-library/jest-dom";
// Initialize i18n so components using useTranslation() render real strings
// (defaults to English) in tests instead of raw translation keys.
import "../lib/i18n";

// Mock ResizeObserver (not available in jsdom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
