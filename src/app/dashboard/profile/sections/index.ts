/**
 * KAN-220 — barrel export for the single-page profile editor's section
 * components. Sections live in this directory; the legacy `steps/`
 * directory keeps the wizard step components (still used by the legacy
 * wizard at `/dashboard/profile/legacy` and the existing tests).
 */

export { BasicInfoSection } from './basic-info-section';
export { BioSection } from './bio-section';
export { ManualOfMeSection } from './manual-of-me-section';
export { AffiliationsSection } from './affiliations-section';
export { useAutoSave, AutoSaveStatusLabel } from './use-auto-save';
export type { AutoSaveStatus, AutoSaveResult } from './use-auto-save';
