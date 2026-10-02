import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_DEFINITIONS,
  categoryCounts,
  inCategories,
} from "./achievements";
import en from "../locales/en.json";
import de from "../locales/de.json";

describe("achievement categories", () => {
  const ids = ACHIEVEMENT_CATEGORIES.map((c) => c.id);

  it("gives every definition a known category", () => {
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      expect(ids, def.id).toContain(def.category);
    }
  });

  it("leaves no category empty", () => {
    const counts = categoryCounts(
      ACHIEVEMENT_DEFINITIONS.map((definition) => ({
        definition,
        unlocked: false,
      })),
    );
    for (const id of ids) expect(counts[id].total, id).toBeGreaterThan(0);
  });

  it("names every category in en and de", () => {
    for (const id of ids) {
      expect(en.achievementCategories[id], id).toBeTruthy();
      expect(de.achievementCategories[id], id).toBeTruthy();
    }
  });

  it("passes everything when nothing is selected", () => {
    expect(inCategories({ category: "goals" }, [])).toBe(true);
    expect(inCategories({ category: "goals" }, ["goals", "elo"])).toBe(true);
    expect(inCategories({ category: "goals" }, ["elo"])).toBe(false);
  });

  it("counts unlocked per category", () => {
    const def = (category: "elo" | "goals") => ({ category });
    const counts = categoryCounts([
      { definition: def("elo"), unlocked: true },
      { definition: def("elo"), unlocked: false },
      { definition: def("goals"), unlocked: false },
    ]);
    expect(counts.elo).toEqual({ total: 2, unlocked: 1 });
    expect(counts.goals).toEqual({ total: 1, unlocked: 0 });
  });
});
