/**
 * KAN-404 (#8/#9) — coverage for the save-model rework.
 *
 * Two layers, both runnable in the project's `node` jest env (no jsdom):
 *
 * 1. Behavioural tests for `runSave`, the framework-agnostic core that BOTH
 *    the debounced timer path and the eager flush() path in `use-auto-save`
 *    go through. This is where the saving→saved / saving→error contract
 *    lives, so testing it directly proves the Save button (flush) and the
 *    debounce transition identically — the E2E's `/Saved|Saving/` assertion
 *    depends on exactly these transitions.
 *
 * 2. Static-source guards that `useAutoSave` returns `{ status, flush }`,
 *    that flush cancels the pending debounce timer, that the free-text
 *    sections render a visible Save button via SectionSaveBar, and that the
 *    single-page editor drops the "Continue →" button while the legacy
 *    wizard keeps it. Rendering React hooks needs a DOM env the repo's jest
 *    config doesn't provide (see affiliations-and-autosave.test.ts), so we
 *    assert the contract at the source level as that file does.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSave } from '@/app/dashboard/profile/sections/auto-save-core';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');
const SECTIONS = resolve(ROOT, SRC.profileSections);

// ─────────── 1. runSave behaviour ───────────

describe('KAN-404: runSave status transitions', () => {
  test('success → saving then saved, save called once with the value', async () => {
    const statuses: string[] = [];
    const save = jest.fn().mockResolvedValue({ success: true });
    await runSave(save, 'hello', (s) => statuses.push(s));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('hello');
    expect(statuses).toEqual(['saving', 'saved']);
  });

  test('void result (legacy save fn) is treated as success', async () => {
    const statuses: string[] = [];
    const save = jest.fn().mockResolvedValue(undefined);
    await runSave(save, 42, (s) => statuses.push(s));
    expect(statuses).toEqual(['saving', 'saved']);
  });

  test('{ success: false } result → saving then error', async () => {
    const statuses: string[] = [];
    const save = jest.fn().mockResolvedValue({ success: false, error: 'nope' });
    await runSave(save, 'x', (s) => statuses.push(s));
    expect(statuses).toEqual(['saving', 'error']);
  });

  test('a throw → saving then error (never rejects)', async () => {
    const statuses: string[] = [];
    const save = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      runSave(save, 'x', (s) => statuses.push(s)),
    ).resolves.toBeUndefined();
    expect(statuses).toEqual(['saving', 'error']);
  });

  test('flush saves the LATEST value handed to it', async () => {
    // The hook keeps a latestValueRef and passes ref.current to runSave, so
    // flush persists what the user currently sees. Simulate by calling runSave
    // with the newest value directly.
    const save = jest.fn().mockResolvedValue({ success: true });
    await runSave(save, 'newest', () => {});
    expect(save).toHaveBeenCalledWith('newest');
  });
});

// ─────────── 2. Static contract guards ───────────

describe('KAN-404: use-auto-save exposes flush + cancels the debounce', () => {
  const src = readFileSync(resolve(SECTIONS, 'use-auto-save.tsx'), 'utf-8');

  test('hook returns { status, flush }', () => {
    expect(src).toMatch(/return\s*\{\s*status,\s*flush\s*\}/);
    expect(src).toMatch(/flush:\s*\(\)\s*=>\s*Promise<void>/);
  });

  test('flush clears the pending debounce timer before saving', () => {
    // flush must cancel the in-flight timer so the eager save is the last write.
    expect(src).toMatch(/const flush =/);
    expect(src).toMatch(/clearTimeout\(timerRef\.current\)/);
  });

  test('debounce default is still 800ms and both paths route through runSave', () => {
    expect(src).toMatch(/debounceMs:\s*number\s*=\s*800/);
    const runSaveCalls = (src.match(/runSave\(/g) || []).length;
    expect(runSaveCalls).toBeGreaterThanOrEqual(2); // debounced timer + flush
  });

  test('AutoSaveStatusLabel keeps the exact Saving…/Saved text (E2E depends on it)', () => {
    expect(src).toMatch(/'Saving…'/);
    expect(src).toMatch(/'Saved'/);
  });
});

describe('KAN-404: SectionSaveBar + free-text sections render a visible Save', () => {
  test('SectionSaveBar renders the status label + a Save button and disables while saving', () => {
    const src = readFileSync(resolve(SECTIONS, 'section-save-bar.tsx'), 'utf-8');
    expect(src).toMatch(/AutoSaveStatusLabel/);
    expect(src).toMatch(/>\s*Save\s*</);
    expect(src).toMatch(/onSave/);
    expect(src).toMatch(/status === 'saving'/);
  });

  test.each(['basic-info-section.tsx', 'bio-section.tsx', 'manual-of-me-section.tsx'])(
    '%s uses flush from useAutoSave and renders SectionSaveBar',
    (file) => {
      const src = readFileSync(resolve(SECTIONS, file), 'utf-8');
      expect(src).toMatch(/const\s*\{\s*status,\s*flush\s*\}\s*=\s*useAutoSave/);
      expect(src).toMatch(/<SectionSaveBar\s+status=\{status\}\s+onSave=\{flush\}/);
    },
  );
});

describe('KAN-404: Continue button gated behind showContinue', () => {
  const STEPS = resolve(ROOT, SRC.steps);

  test.each(['items-step.tsx', 'links-step.tsx', 'conversation-starters-step.tsx', 'files-step.tsx'])(
    '%s only renders the Continue button when showContinue is not false',
    (file) => {
      const src = readFileSync(resolve(STEPS, file), 'utf-8');
      expect(src).toMatch(/showContinue\?:\s*boolean/);
      expect(src).toMatch(/showContinue\s*=\s*true/);
      // The Continue button is gated behind showContinue.
      expect(src).toMatch(/\{showContinue && <SaveButton/);
      expect(src).toMatch(/label="Continue →"/);
    },
  );

  test('single-page editor passes showContinue={false} to the list steps', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.editProfileForm),
      'utf-8',
    );
    const count = (src.match(/showContinue=\{false\}/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3); // items + links + starters
  });

  test('legacy wizard.tsx does NOT pass showContinue (keeps the default true)', () => {
    const src = readFileSync(
      resolve(ROOT, SRC.wizard),
      'utf-8',
    );
    expect(src).not.toMatch(/showContinue/);
  });
});
