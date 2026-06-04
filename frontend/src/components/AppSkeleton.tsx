// First-load placeholder that mirrors the real app chrome (header, tab nav,
// and a leaderboard-style table) so the initial load doesn't blank to a bare
// 'Loading...'. Reuses the .chart-skeleton shimmer defined in App.css.
export function AppSkeleton() {
  return (
    <div className="min-h-screen flex flex-col" aria-busy="true" aria-label="Loading">
      <header className="bg-white border-b border-border px-8 py-6 flex justify-between items-center shadow-sm flex-wrap gap-3">
        <div className="chart-skeleton h-8 w-40" />
        <div className="flex items-center gap-3">
          <div className="chart-skeleton h-9 w-9 rounded-full" />
          <div className="chart-skeleton h-9 w-24" />
        </div>
      </header>
      {/* Same colorful moving border the app flashes on data updates. */}
      <div className="data-update-pulse active" aria-hidden="true" />
      <nav className="flex gap-1 bg-white border-b border-border px-6 overflow-x-auto">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-6 py-4">
            <div className="chart-skeleton h-5 w-20" />
          </div>
        ))}
      </nav>
      <main className="flex-1 p-8 max-w-300 mx-auto w-full">
        <div className="flex justify-center mb-8">
          <div className="app-spinner" role="status" aria-label="Loading" />
        </div>
        <div className="card">
          <div className="chart-skeleton h-7 w-48 mb-6" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="chart-skeleton h-12 w-full" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
