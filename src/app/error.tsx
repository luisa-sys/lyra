'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 mx-auto mb-6 flex items-center justify-center">
          <span className="text-2xl">⚠️</span>
        </div>
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)] mb-2">
          Something went wrong
        </h1>
        <p className="text-[var(--color-muted)] mb-6">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
