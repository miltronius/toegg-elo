// Mirrored byte-for-byte in supabase/functions/_shared/fetchAll.ts.

/**
 * PostgREST answers at most `max_rows` rows per request (1000 on Supabase),
 * silently: no error, just a short result. A full-table read therefore has to
 * page. Until 2026-11 none did, and once elo_history passed 1000 rows the
 * newest match's rating changes stopped reaching the dashboard.
 */
export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Read every row of a query, page by page. `page(from, to)` must apply
 * `.range(from, to)` to a query with a **total, stable order** (end on a
 * unique column such as `id`), or rows can repeat or go missing between pages.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => Page<T>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
