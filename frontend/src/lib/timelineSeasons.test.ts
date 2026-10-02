import { describe, expect, it } from "vitest";
import { daysToReveal, seasonForDay, visibleItems, withSeasonBands } from "./timelineSeasons";

const S1 = { id: "s1", number: 1, started_at: "2026-04-04T10:00:00Z" };
const S2 = { id: "s2", number: 2, started_at: "2026-06-01T08:00:00Z" };
const S3 = { id: "s3", number: 3, started_at: "2026-09-04T18:00:00Z" };
const SEASONS = [S2, S3, S1];
const day = (date: string) => ({ date });

describe("seasonForDay", () => {
  it("picks the newest season started by that day", () => {
    expect(seasonForDay("2026-05-10", SEASONS)).toBe(S1);
    expect(seasonForDay("2026-09-03", SEASONS)).toBe(S2);
    expect(seasonForDay("2026-10-01", SEASONS)).toBe(S3);
  });

  it("gives a season its start day, even if it started late that day", () => {
    expect(seasonForDay("2026-09-04", SEASONS)).toBe(S3);
  });

  it("files days from before any season under the oldest", () => {
    expect(seasonForDay("2026-01-01", SEASONS)).toBe(S1);
  });

  it("has nothing to say without seasons", () => {
    expect(seasonForDay("2026-01-01", [])).toBeNull();
  });
});

describe("withSeasonBands", () => {
  const days = [day("2026-10-01"), day("2026-09-04"), day("2026-08-20"), day("2026-04-05")];
  const shape = (items: ReturnType<typeof withSeasonBands>) =>
    items.map((i) => (i.kind === "season" ? `S${i.season.number}` : i.day.date));

  it("puts each season's band above its days, newest first", () => {
    expect(shape(withSeasonBands(days, SEASONS))).toEqual([
      "S3",
      "2026-10-01",
      "2026-09-04",
      "S2",
      "2026-08-20",
      "S1",
      "2026-04-05",
    ]);
  });

  it("keeps a band for a season without days", () => {
    expect(shape(withSeasonBands([day("2026-10-01"), day("2026-04-05")], SEASONS))).toEqual([
      "S3",
      "2026-10-01",
      "S2",
      "S1",
      "2026-04-05",
    ]);
  });

  it("leaves the days alone without seasons", () => {
    expect(shape(withSeasonBands(days, []))).toEqual(days.map((d) => d.date));
  });
});

describe("visibleItems / daysToReveal", () => {
  const items = withSeasonBands(
    [day("2026-10-01"), day("2026-09-04"), day("2026-08-20"), day("2026-04-05")],
    SEASONS,
  );
  const shape = (list: typeof items) =>
    list.map((i) => (i.kind === "season" ? `S${i.season.number}` : i.day.date));

  it("stops before a band whose days aren't shown yet", () => {
    expect(shape(visibleItems(items, 2))).toEqual(["S3", "2026-10-01", "2026-09-04"]);
    expect(shape(visibleItems(items, 3))).toEqual([
      "S3",
      "2026-10-01",
      "2026-09-04",
      "S2",
      "2026-08-20",
    ]);
  });

  it("shows a dayless season's band as soon as it's reached", () => {
    const sparse = withSeasonBands([day("2026-10-01"), day("2026-04-05")], SEASONS);
    expect(shape(visibleItems(sparse, 1))).toEqual(["S3", "2026-10-01", "S2"]);
  });

  it("counts the days to render before a season's band and first day exist", () => {
    expect(daysToReveal(items, "s3")).toBe(1);
    expect(daysToReveal(items, "s2")).toBe(3);
    expect(daysToReveal(items, "s1")).toBe(4);
    expect(shape(visibleItems(items, daysToReveal(items, "s2")))).toContain("S2");
  });
});
