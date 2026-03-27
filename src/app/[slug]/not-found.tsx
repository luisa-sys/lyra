import Link from 'next/link';

export default function ProfileNotFound() {
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-[family-name:var(--font-serif)] text-[var(--color-ink)] mb-4">
          404
        </h1>
        <p className="text-lg text-[var(--color-muted)] mb-2">
          This profile doesn&apos;t exist or hasn&apos;t been published yet.
        </p>
        <p className="text-sm text-[var(--color-muted)] mb-8">
          The person you&apos;re looking for may not have created their Lyra profile yet.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-lg bg-[var(--color-sage)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Go to Lyra
        </Link>
      </div>
    </main>
  );
}
