export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="h-6 w-16 bg-[#ece7df] rounded animate-pulse" />
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <div className="h-8 w-48 bg-[#ece7df] rounded animate-pulse" />
        <div className="h-4 w-72 bg-[#f4efe7] rounded animate-pulse" />
        <div className="mt-8 space-y-3">
          <div className="h-24 bg-white rounded-xl border border-[var(--color-border)] animate-pulse" />
          <div className="h-24 bg-white rounded-xl border border-[var(--color-border)] animate-pulse" />
          <div className="h-24 bg-white rounded-xl border border-[var(--color-border)] animate-pulse" />
        </div>
      </div>
    </main>
  );
}
