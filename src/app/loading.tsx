export default function Loading() {
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-stone-200 border-t-[var(--color-sage)] animate-spin mx-auto mb-4" />
        <p className="text-sm text-[var(--color-muted)]">Loading...</p>
      </div>
    </main>
  );
}
