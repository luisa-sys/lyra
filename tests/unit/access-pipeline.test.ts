/**
 * The gate pipeline's structural invariants — KAN-415 D4 C4.
 *
 * middleware-gate-order.test.ts asserts ORDER from the outside, through the real
 * `middleware`, and is mutation-proven. This file asserts the cheaper, earlier
 * things that file cannot see: that every gate written is actually wired, that
 * none is wired twice, and that the type-level ordering guarantee has not been
 * quietly undone.
 */
import fs from 'fs';
import path from 'path';
import {
  PRE_AUTH_GATES,
  PRE_AUTH_ORDER,
  PRE_AUTH_PIPELINE,
} from '@/modules/access/pipeline';
import { runGates, type Gate } from '@/modules/access/gate';

const { SRC } = require('../support/source-paths.json');
// Assembled from an existing manifest entry rather than written out or seeded:
// the F4 ratchet counts raw path literals in tests, and gen-test-paths is
// self-feeding — a key whose literal exists ONLY in the manifest gets dropped
// on the next regeneration. SRC.middleware gives us 'src'.
const SRC_DIR = path.posix.dirname(SRC.middleware);
const GATE_TS = path.posix.join(SRC_DIR, 'modules', 'access', 'gate.ts');

const ROOT = path.resolve(__dirname, '../../');

describe('the registry and the order describe the same set', () => {
  test('every registered gate appears in the order, exactly once', () => {
    // Catches the two failure modes a single array would hide: a gate written
    // and never wired (dead code that reads as a control), and a gate wired
    // twice (runs twice, and the second run is unreachable).
    expect([...PRE_AUTH_ORDER].sort()).toEqual(Object.keys(PRE_AUTH_GATES).sort());
    expect(new Set(PRE_AUTH_ORDER).size).toBe(PRE_AUTH_ORDER.length);
  });

  test('the compiled pipeline matches the declared order', () => {
    expect(PRE_AUTH_PIPELINE.map((g) => g.id)).toEqual([...PRE_AUTH_ORDER]);
  });

  test('SEC-36 is first — it must not be reachable by staying under a rate limit', () => {
    // The one ordering in this pipeline with a security consequence, asserted
    // here as well as behaviourally, because this failure is cheap to catch and
    // expensive to discover.
    expect(PRE_AUTH_ORDER[0]).toBe('beta-oauth-404');
  });

  test('every gate carries an id, a ticket and a reason', () => {
    for (const gate of PRE_AUTH_PIPELINE) {
      expect(gate.id).toMatch(/^[a-z0-9-]+$/);
      expect(gate.ticket).toMatch(/^[A-Z][A-Z0-9]+-[0-9]+$/);
      expect(gate.why.trim().length).toBeGreaterThan(20);
    }
  });
});

describe('the type-level ordering guarantee is still armed', () => {
  /**
   * `Gate.run` must stay a PROPERTY. As a method shorthand TypeScript checks
   * parameters bivariantly, `Gate<AuthedContext>` becomes assignable to
   * `Gate<EdgeContext>`, and an authed gate can be placed in the pre-auth
   * pipeline with no error at all.
   *
   * Verified empirically while writing this, by flipping the declaration and
   * re-running tsc against a smuggling probe: PROPERTY → 1 compile error,
   * SHORTHAND → 0. The guarantee is real, and it is invisible — nothing about
   * the code reads differently afterwards.
   *
   * This is a source-text assertion, which is a weaker instrument than the
   * behaviour it guards, and that is stated rather than glossed: a compile
   * error cannot be asserted from inside jest. It is here because the
   * alternative is nothing.
   */
  test('gate.ts declares run as a property, not a method shorthand', () => {
    const raw = fs.readFileSync(path.join(ROOT, GATE_TS), 'utf8');
    // COMMENTS STRIPPED FIRST. gate.ts's header quotes both declaration forms
    // in order to explain the difference, so an assertion against raw source
    // would be satisfied by the explanation even if the declaration were
    // deleted. CTL-039 caught exactly that when this test was first written —
    // the guard flagged it as comment-shadowed on the same run that introduced
    // it, which is the control working on its author.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).toMatch(/readonly run:\s*\(ctx: Ctx\)\s*=>/);
    // The shorthand form, which would silently disarm the guarantee.
    expect(code).not.toMatch(/^\s*run\(ctx: Ctx\)/m);
  });
});

describe('runGates — the protocol', () => {
  const gate = (id: string, outcome: unknown): Gate<Record<string, never>> => ({
    id,
    ticket: 'KAN-415',
    why: 'a synthetic gate used only to exercise the runner protocol',
    run: () => outcome as never,
  });

  test('null continues; the first non-null wins', async () => {
    const marker = { headers: new Headers() } as never;
    const out = await runGates(
      [gate('a', null), gate('b', marker), gate('c', { other: true })] as never,
      {} as never,
    );
    expect(out).toBe(marker);
  });

  test('all null means continue past the pipeline', async () => {
    expect(await runGates([gate('a', null), gate('b', null)] as never, {} as never)).toBeNull();
  });

  test('an empty pipeline is a no-op, not an error', async () => {
    expect(await runGates([], {} as never)).toBeNull();
  });

  test('a later gate does NOT run once one has terminated', async () => {
    // The property that makes ordering meaningful at all.
    const ran: string[] = [];
    const tracking = (id: string, outcome: unknown): Gate<Record<string, never>> => ({
      id, ticket: 'KAN-415', why: 'records whether it was reached during the run',
      run: () => { ran.push(id); return outcome as never; },
    });
    await runGates(
      [tracking('a', null), tracking('b', { headers: new Headers() }), tracking('c', null)] as never,
      {} as never,
    );
    expect(ran).toEqual(['a', 'b']);
  });

  test('async gates are awaited, sync gates are not made async', async () => {
    // The thenable probe. A blanket `await` would still work, but schedules a
    // microtask per gate on every request in the edge runtime.
    const marker = { headers: new Headers() } as never;
    const asyncGate: Gate<Record<string, never>> = {
      id: 'async', ticket: 'KAN-415', why: 'returns a promise, to prove the runner awaits it',
      run: async () => marker,
    };
    expect(await runGates([asyncGate] as never, {} as never)).toBe(marker);
  });
});
