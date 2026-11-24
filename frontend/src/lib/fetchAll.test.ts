import { describe, expect, it } from "vitest";
import { fetchAllRows, PAGE_SIZE } from "./fetchAll";

/** A fake table that, like PostgREST, never returns more than PAGE_SIZE rows. */
const table = (n: number) => {
  const rows = Array.from({ length: n }, (_, i) => i);
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({
      data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)),
      error: null,
    });
  };
  return { rows, calls, page };
};

describe("fetchAllRows", () => {
  it.each([0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, 2 * PAGE_SIZE + 7])(
    "returns all %i rows, the newest included",
    async (n) => {
      const t = table(n);
      expect(await fetchAllRows(t.page)).toEqual(t.rows);
    },
  );

  it("asks for the next page only while pages come back full", async () => {
    const t = table(PAGE_SIZE + 1);
    await fetchAllRows(t.page);
    expect(t.calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);
  });

  it("throws a page's error rather than returning a partial list", async () => {
    const err = new Error("boom");
    await expect(
      fetchAllRows(() => Promise.resolve({ data: null, error: err })),
    ).rejects.toBe(err);
  });
});
