import "@testing-library/jest-dom";
// Initialize i18n so components using useTranslation() render real strings
// (defaults to English) in tests instead of raw translation keys.
import "../lib/i18n";

// Node 25 ships an experimental global `localStorage` that shadows jsdom's and,
// without --localstorage-file, has none of the Storage methods. CI runs Node 20,
// where jsdom's works; on newer Node put an in-memory Storage in its place.
if (typeof globalThis.localStorage?.getItem !== "function") {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

// Mock ResizeObserver (not available in jsdom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
