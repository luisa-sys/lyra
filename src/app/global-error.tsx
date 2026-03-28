'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', backgroundColor: '#fafaf9' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
            <div style={{ width: '4rem', height: '4rem', borderRadius: '50%', backgroundColor: '#fef2f2', margin: '0 auto 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            </div>
            <h1 style={{ fontSize: '1.5rem', color: '#1c1917', marginBottom: '0.5rem' }}>
              Something went wrong
            </h1>
            <p style={{ color: '#78716c', marginBottom: '1.5rem' }}>
              {error.message || 'An unexpected error occurred. Please try again.'}
            </p>
            <button
              onClick={reset}
              style={{ padding: '0.625rem 1.5rem', borderRadius: '0.5rem', backgroundColor: '#6b8f71', color: 'white', fontSize: '0.875rem', fontWeight: 500, border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
