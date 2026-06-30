export interface WizardProfile {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  city: string | null;
  region: string | null;
  // KAN-339: postcode_prefix removed (postcode no longer collected/stored).
  country: string | null;
  // KAN-186: ISO-3166 alpha-2 country where gifts for this profile should
  // ship. Separate from `country` (which is freeform display text). NULL
  // means "unknown — fall back to buyer country at recommendation time".
  delivery_country_code: string | null;
  is_published: boolean;
  avatar_url: string | null;
  // KAN-234 / KAN-221: hybrid visibility. Per-section default ({} when
  // unset) that items inherit when their own `visibility` is NULL.
  // Keys live in `section-visibility.ts → CONTROLLABLE_SECTION_KEYS`.
  section_visibility: Record<string, string> | null;
}

export interface WizardItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  url: string | null;
  // KAN-234 / KAN-221: nullable to allow "inherit from section default".
  // Older rows from before KAN-221 always had an explicit value; new items
  // default to NULL when the form chooses "Use section default".
  visibility: string | null;
}

export interface WizardSchool {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
  // KAN-220: one of school|organisation|community. Backward-compatible
  // default — older rows from before migration 20260517010000 have this
  // column with the default value 'school'.
  affiliation_type: string;
  // KAN-263 / KAN-267: affiliations are hidden on the public profile unless
  // the owner opts the row in. `description` is an optional short note
  // ("Class of 2008"). Older rows default to false / null.
  show_on_profile: boolean;
  description: string | null;
}

export interface WizardLink {
  id: string;
  title: string;
  url: string;
  link_type: string;
  description: string | null;
}

// KAN-142: profile_files row, shaped for the wizard FilesStep.
export interface WizardFile {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: string;
}

// KAN-181: conversation starters — both the curated prompt library
// and the user's answers (joined to the prompt for display).
export interface ConversationPrompt {
  id: string;
  prompt: string;
  sort_order: number;
}

export interface ConversationAnswer {
  id: string;
  prompt_id: string;
  answer: string;
  prompt: string; // joined for display
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
        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
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
