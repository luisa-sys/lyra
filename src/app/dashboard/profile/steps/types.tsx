/**
 * Profile wizard UI primitives — KAN-415 D8.
 *
 * ⚠️ THE DOMAIN MODEL IS NO LONGER HERE. The seven `Wizard*` /
 * `Conversation*` interfaces moved to `@/modules/profile/types`, because the
 * *public* profile's shape must not be owned by the *editor's* wizard (the D-4
 * privacy finding). They are re-exported below so the 14 existing imports in
 * this tree keep working — D8 moves the boundary, it does not rewrite the
 * wizard. **New code should import them from the module directly.**
 *
 * What stays is the two presentational components, which belong to the editor
 * and nowhere else. They carry design tokens and are founder-owned surface
 * under KAN-411 (`uiApprovalGated: always`), so they must not drift into a
 * domain module that other code is meant to depend on freely.
 */
export type {
  WizardProfile,
  WizardItem,
  WizardSchool,
  WizardLink,
  WizardFile,
  ConversationPrompt,
  ConversationAnswer,
} from '@/modules/profile/types';

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
