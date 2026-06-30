'use client';

/**
 * KAN-153 / KAN-339: Settings UI for opt-in phone discovery.
 *
 * One toggle. Enabling it reveals an input where the user enters their phone
 * number, which is hashed server-side and stored. We never display the
 * previously-stored value (only the hash is persisted); disabling clears the hash.
 *
 * KAN-339: postcode discovery removed for privacy/data-minimisation. Coarse
 * town/city discovery (KAN-341) replaces the location-based discovery path.
 */
import { useEffect, useState, useTransition } from 'react';
import { setDiscoverability, getDiscoverability } from './discoverability-actions';

type Banner = { type: 'success' | 'error'; text: string } | null;

export function DiscoverabilityClient() {
  const [isPending, startTransition] = useTransition();
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  useEffect(() => {
    startTransition(async () => {
      const result = await getDiscoverability();
      if (result.success) {
        setPhoneEnabled(result.phone);
      }
    });
  }, []);

  const handlePhoneToggle = (next: boolean) => {
    setBanner(null);
    if (next) {
      // Reveal the input — the actual enable happens after the user submits.
      setShowPhoneInput(true);
      return;
    }
    // Disabling is immediate.
    startTransition(async () => {
      const result = await setDiscoverability({ phone: false });
      if (result.success) {
        setPhoneEnabled(false);
        setShowPhoneInput(false);
        setPhoneInput('');
        setBanner({ type: 'success', text: 'Phone discovery disabled.' });
      } else {
        setBanner({ type: 'error', text: result.error });
      }
    });
  };

  const handlePhoneSubmit = () => {
    setBanner(null);
    if (!phoneInput) return;
    startTransition(async () => {
      const result = await setDiscoverability({ phone: true, phoneValue: phoneInput });
      if (result.success) {
        setPhoneEnabled(true);
        setShowPhoneInput(false);
        setPhoneInput('');
        setBanner({
          type: 'success',
          text: 'Phone discovery enabled. Your number is stored only as a salted hash.',
        });
      } else {
        setBanner({ type: 'error', text: result.error });
      }
    });
  };

  return (
    <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
      <h2 className="text-lg font-medium text-[var(--color-ink)] mb-1">Discovery by phone number</h2>
      <p className="text-sm text-[var(--color-muted)] mb-4">
        Let people who know your phone number find your profile. It&rsquo;s off by default.
        Lyra never stores your number in plain text — only a one-way salted hash that can be
        matched against an exact lookup but cannot be reversed.
      </p>

      {banner && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            banner.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* ── Phone toggle ────────────────────────────────────── */}
      <div>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1">
            <label htmlFor="discover-phone" className="block text-sm font-medium text-[var(--color-ink)]">
              Allow discovery by phone number
            </label>
            <p className="text-xs text-[var(--color-muted)] mt-1">
              Anyone who knows your exact phone number will be able to find your profile.
              Partial numbers, area-code lookups, and reverse-search are not supported.
            </p>
          </div>
          <input
            id="discover-phone"
            type="checkbox"
            checked={phoneEnabled || showPhoneInput}
            disabled={isPending}
            onChange={(e) => handlePhoneToggle(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-[var(--color-border)] text-[var(--color-sage)] focus:ring-[var(--color-sage)]"
          />
        </div>
        {showPhoneInput && !phoneEnabled && (
          <div className="mt-3 flex gap-2">
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="+44 7700 900000"
              autoComplete="off"
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
            />
            <button
              onClick={handlePhoneSubmit}
              disabled={isPending || !phoneInput}
              className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Enable
            </button>
            <button
              onClick={() => { setShowPhoneInput(false); setPhoneInput(''); }}
              disabled={isPending}
              className="px-3 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
