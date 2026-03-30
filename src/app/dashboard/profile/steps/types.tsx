export interface WizardProfile {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  city: string | null;
  region: string | null;
  postcode_prefix: string | null;
  country: string | null;
  is_published: boolean;
  avatar_url: string | null;
}

export interface WizardItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  url: string | null;
  visibility: string;
}

export interface WizardSchool {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
}

export interface WizardLink {
  id: string;
  title: string;
  url: string;
  link_type: string;
  description: string | null;
}

export function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
      />
    </div>
  );
}

export function SaveButton({ onClick, isPending, label }: {
  onClick: () => void; isPending: boolean; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className="w-full py-2.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
    >
      {isPending ? 'Saving...' : label}
    </button>
  );
}
