/**
 * KAN-236 — gathering UI structural tests.
 *
 * Verifies page + actions files exist and carry the expected gates.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('Convene gatherings UI (KAN-236)', () => {
  const listPath = path.join(ROOT, 'src/app/dashboard/convene/gatherings/page.tsx');
  const detailPath = path.join(ROOT, 'src/app/dashboard/convene/gatherings/[id]/page.tsx');
  const actionsPath = path.join(ROOT, 'src/app/dashboard/convene/gatherings/[id]/actions.ts');
  const clientPath = path.join(ROOT, 'src/app/dashboard/convene/gatherings/[id]/gathering-actions.tsx');

  test('all four files exist', () => {
    expect(fs.existsSync(listPath)).toBe(true);
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(fs.existsSync(actionsPath)).toBe(true);
    expect(fs.existsSync(clientPath)).toBe(true);
  });

  describe('list page', () => {
    const src = fs.readFileSync(listPath, 'utf8');
    test('gates on isConveneEnabled', () => expect(src).toMatch(/isConveneEnabled\(\)/));
    test('redirects unauthenticated users to /login', () => expect(src).toMatch(/redirect\(['"]\/login/));
    test('filters by host_user_id', () => expect(src).toMatch(/\.eq\(['"]host_user_id['"],\s*user\.id\)/));
    test('soft-deleted gatherings excluded', () => expect(src).toMatch(/\.is\(['"]deleted_at['"],\s*null\)/));
  });

  describe('detail page', () => {
    const src = fs.readFileSync(detailPath, 'utf8');
    test('gates on isConveneEnabled', () => expect(src).toMatch(/isConveneEnabled\(\)/));
    test('filters main gathering query by host_user_id', () => expect(src).toMatch(/\.eq\(['"]host_user_id['"],\s*user\.id\)/));
    test('returns 404 (notFound) on missing or non-owned gathering', () => expect(src).toMatch(/notFound\(\)/));
    test('uses state-machine availableTransitions to gate buttons', () => expect(src).toMatch(/availableTransitions/));
    test('queries gathering_events_log for calendar_event_added', () => expect(src).toMatch(/calendar_event_added/));
  });

  describe('server actions', () => {
    const src = fs.readFileSync(actionsPath, 'utf8');
    test("'use server' directive at top", () => expect(src).toMatch(/^['"]use server['"]/m));
    test('addToHostCalendar validates host_user_id', () => {
      const fn = src.slice(src.indexOf('addToHostCalendar'));
      expect(fn).toMatch(/\.eq\(['"]host_user_id['"],\s*userId\)/);
    });
    test('addToHostCalendar requires status=live', () => {
      expect(src).toMatch(/status !== ['"]live['"]/);
    });
    test('addToHostCalendar uses adapterFor', () => {
      expect(src).toMatch(/adapterFor\(/);
    });
    test('addToHostCalendar appends calendar_event_added on success', () => {
      expect(src).toMatch(/calendar_event_added/);
    });
    test('cancelGathering uses applyTransition with cancel', () => {
      expect(src).toMatch(/applyTransition\([^,]+,\s*['"]cancel['"]/);
    });
    test('cancelGathering appends gathering_cancelled to audit log', () => {
      expect(src).toMatch(/gathering_cancelled/);
    });
  });

  describe('client action component', () => {
    const src = fs.readFileSync(clientPath, 'utf8');
    test("'use client' directive at top", () => expect(src).toMatch(/^['"]use client['"]/m));
    test('confirm before destructive cancel', () => {
      const fn = src.slice(src.indexOf('handleCancel'));
      expect(fn).toMatch(/confirm\(/);
    });
    test('add-to-calendar gated on status=live and not already added', () => {
      expect(src).toMatch(/status === ['"]live['"][\s\S]*?!calendarAdded/);
    });
  });
});
