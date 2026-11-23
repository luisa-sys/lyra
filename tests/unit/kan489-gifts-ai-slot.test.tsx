/**
 * @jest-environment jsdom
 */
/**
 * KAN-489 — the AI gift suggestions slot, rendered with React Testing
 * Library (spec v0.8 §03: toggle OFF by default, a separate Generate button
 * when ON, a visible counter, individual approve / delete, AI origin
 * labelled, toggle OFF keeps approved entries, no URLs in V1).
 *
 * The real `GiftsAiSlot` and `AiGiftsContext`; only the two server actions
 * are mocked. Expected copy is written out as literals (failure mode 10).
 */
import React, { useMemo, useReducer, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mockGenerate = jest.fn();
const mockDismiss = jest.fn();
jest.mock('@/app/dashboard/profile/ai-gifts-actions', () => ({
  generateAiGifts: (...a: unknown[]) => mockGenerate(...a),
  dismissAiGift: (...a: unknown[]) => mockDismiss(...a),
}));

import { GiftsAiSlot } from '@/app/dashboard/profile/editor/gifts-ai-slot';
import { AiGiftsContext, type AiGiftsContextValue } from '@/app/dashboard/profile/editor/ai-gifts-context';
import type { AiGiftRow } from '@/modules/profile/editor/editor-state';
import type { GeneratedSuggestion } from '@/modules/profile/ai-gifts/types';

(globalThis as unknown as { React: typeof React }).React = React;

const SESSION = '3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f';

type Act = { type: string; id?: string };

/** A tiny harness: real slot, state held like the form holds it. */
function Harness({
  initial,
  configured = true,
  savedApproved,
  readOnly = false,
  log,
}: {
  initial: AiGiftRow[];
  configured?: boolean;
  savedApproved?: string[];
  readOnly?: boolean;
  log?: Act[];
}) {
  const [rows, setRows] = useState<AiGiftRow[]>(initial);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const ctx = useMemo<AiGiftsContextValue>(
    () => ({
      configured,
      sessionId: SESSION,
      savedApprovedIds: new Set(savedApproved ?? initial.filter((r) => r.approved).map((r) => r.id)),
      onGenerated: (added: readonly GeneratedSuggestion[]) =>
        setRows((r) => [...r, ...added.map((a) => ({ id: a.id, title: a.title, description: a.description ?? '', url: '', approved: false }))]),
      onDismissed: (id: string) => setRows((r) => r.filter((x) => x.id !== id)),
    }),
    [configured, savedApproved, initial],
  );
  const dispatch = (a: Act) => {
    log?.push(a);
    if (a.type === 'approveAiGift') setRows((r) => r.map((x) => (x.id === a.id ? { ...x, approved: true } : x)));
    if (a.type === 'deleteAiGift') setRows((r) => r.filter((x) => x.id !== a.id));
    force();
  };
  return (
    <AiGiftsContext.Provider value={ctx}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <GiftsAiSlot aiItems={rows} dispatch={dispatch as any} readOnly={readOnly} />
    </AiGiftsContext.Provider>
  );
}

function row(id: string, title: string, approved: boolean, over: Partial<AiGiftRow> = {}): AiGiftRow {
  return { id, title, description: '', url: '', approved, ...over };
}

const CONSENT =
  'When on, Lyra sends the text you’ve written on this profile (not your name, location, photo or affiliations) to our AI provider, Anthropic, to suggest gift ideas. Nothing is shown publicly until you approve it.';

function switchOn() {
  fireEvent.click(screen.getByRole('switch', { name: 'Suggest gift ideas with AI' }));
}

function consent() {
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
}

beforeEach(() => {
  mockGenerate.mockReset();
  mockDismiss.mockReset();
});
afterEach(cleanup);

describe('toggle and consent', () => {
  it('the switch is OFF by default and there is no Generate button', () => {
    render(<Harness initial={[]} />);
    const sw = screen.getByRole('switch', { name: 'Suggest gift ideas with AI' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Generate suggestions' })).toBeNull();
    expect(screen.queryByText(CONSENT)).toBeNull();
  });

  it('ON shows the data-sharing note first; Generate appears only after "Got it"', () => {
    render(<Harness initial={[]} />);
    switchOn();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(CONSENT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate suggestions' })).toBeNull();
    consent();
    expect(screen.queryByText(CONSENT)).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeTruthy();
    expect(screen.getByText('5 of 5 left this session')).toBeTruthy();
  });

  it('switching OFF hides Generate but keeps approved AND pending suggestions, with their buttons', () => {
    render(<Harness initial={[row('a1', 'Approved kite', true), row('p1', 'Pending clay', false)]} />);
    switchOn();
    consent();
    switchOn(); // off
    expect(screen.queryByRole('button', { name: 'Generate suggestions' })).toBeNull();
    expect(screen.getByText('Approved kite')).toBeTruthy();
    expect(screen.getByText('Pending clay')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Approved kite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve Pending clay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Pending clay' })).toBeTruthy();
  });

  it('switching back ON in the same session does not ask again', () => {
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    switchOn();
    switchOn();
    expect(screen.queryByText(CONSENT)).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeTruthy();
  });
});

describe('Generate', () => {
  it('calls the action with the session id, adds the rows and updates the counter from the server', async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      inserted: [
        { id: 'n1', title: 'Kite', description: 'Fly it' },
        { id: 'n2', title: 'Clay', description: null },
      ],
      droppedForCap: 0,
      droppedByFilter: 1,
      sessionRemaining: 2,
      dailyRemaining: 10,
    });
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    });
    // Was `toHaveBeenCalledWith(SESSION)` before the review fix sent the consent version.
    expect(mockGenerate).toHaveBeenCalledWith(SESSION, 'v1-2026-11-23');
    expect(screen.getByText('2 of 5 left this session')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Added 2 suggestions. Some suggestions were filtered out.');
    const list = screen.getByRole('list', { name: 'AI suggestions' });
    expect(within(list).getAllByText('AI suggestion').length).toBe(2);
    expect(within(list).getByText('Kite')).toBeTruthy();
  });

  it('reports the suggestions that did not fit under the cap', async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      inserted: Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, title: `Gift ${i}`, description: null })),
      droppedForCap: 3,
      droppedByFilter: 0,
      sessionRemaining: 4,
      dailyRemaining: 19,
    });
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    });
    expect(screen.getByRole('status').textContent).toBe(
      'Added 7 suggestions. 3 more didn’t fit: you can keep up to 10. Remove one to make room.',
    );
  });

  it.each([
    [{ ok: false, reason: 'refused', sessionRemaining: 3 }, 'We couldn’t generate suggestions from this profile.', '3 of 5 left this session'],
    [{ ok: false, reason: 'no_content' }, 'Add a few things about yourself first.', '5 of 5 left this session'],
    [{ ok: false, reason: 'busy', sessionRemaining: 1 }, 'Something went wrong, try again later.', '1 of 5 left this session'],
    [{ ok: false, reason: 'session_limit', sessionRemaining: 0 }, 'You’ve used all 5 generations for this session.', '0 of 5 left this session'],
  ])('a failure shows its message and the server count (%o)', async (result, message, counter) => {
    mockGenerate.mockResolvedValue(result);
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    });
    expect(screen.getByRole('status').textContent).toBe(message);
    expect(screen.getByText(counter)).toBeTruthy();
  });

  it('review fix — while a request runs the button reads "Generating…", is disabled, and the slot is aria-busy', async () => {
    let resolve!: (v: unknown) => void;
    mockGenerate.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    const slot = screen.getByTestId('gifts-ai-slot');
    expect(slot.getAttribute('aria-busy')).toBe('false');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    });
    const busy = screen.getByRole('button', { name: 'Generating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(slot.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      resolve({ ok: false, reason: 'refused', sessionRemaining: 4 });
    });
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeTruthy();
    expect(slot.getAttribute('aria-busy')).toBe('false');
  });

  it('review fix — the counter never shows more than the daily allowance left', async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      inserted: [{ id: 'n1', title: 'Kite', description: null }],
      droppedForCap: 0,
      droppedByFilter: 0,
      sessionRemaining: 4,
      dailyRemaining: 1,
    });
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    });
    expect(screen.getByText('1 of 5 left this session')).toBeTruthy();
  });

  it('at 0 left the button is disabled', async () => {
    mockGenerate.mockResolvedValue({ ok: false, reason: 'session_limit', sessionRemaining: 0 });
    render(<Harness initial={[]} />);
    switchOn();
    consent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    });
    expect((screen.getByRole('button', { name: 'Generate suggestions' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('at 10 suggestions held (pending + approved) Generate is disabled and says why', () => {
    const ten = [
      ...Array.from({ length: 4 }, (_, i) => row(`a${i}`, `A${i}`, true)),
      ...Array.from({ length: 6 }, (_, i) => row(`p${i}`, `P${i}`, false)),
    ];
    render(<Harness initial={ten} />);
    switchOn();
    consent();
    expect((screen.getByRole('button', { name: 'Generate suggestions' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Remove a suggestion to generate more')).toBeTruthy();
  });

  it('9 held → Generate is enabled', () => {
    render(<Harness initial={Array.from({ length: 9 }, (_, i) => row(`p${i}`, `P${i}`, false))} />);
    switchOn();
    consent();
    expect((screen.getByRole('button', { name: 'Generate suggestions' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('read-only (saving) disables the switch', () => {
    render(<Harness initial={[]} readOnly />);
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('pending suggestions', () => {
  it('Approve dispatches approveAiGift and the row reads "Approved, publishes when you save"', () => {
    const log: Act[] = [];
    render(<Harness initial={[row('p1', 'Pending clay', false)]} log={log} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve Pending clay' }));
    expect(log).toEqual([{ type: 'approveAiGift', id: 'p1' }]);
    expect(screen.getByText('Approved, publishes when you save')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve Pending clay' })).toBeNull();
    // Not public yet: not under "AI suggested".
    expect(screen.queryByRole('heading', { name: 'AI suggested' })).toBeNull();
  });

  it('Delete removes only that row, through the server action', async () => {
    mockDismiss.mockResolvedValue({ ok: true });
    render(<Harness initial={[row('p1', 'Pending clay', false), row('p2', 'Pending kite', false), row('a1', 'Approved map', true)]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Pending clay' }));
    });
    expect(mockDismiss).toHaveBeenCalledWith('p1');
    expect(screen.queryByText('Pending clay')).toBeNull();
    expect(screen.getByText('Pending kite')).toBeTruthy();
    expect(screen.getByText('Approved map')).toBeTruthy();
  });

  it('a delete the server reports as not_found (already gone) removes the row here too', async () => {
    mockDismiss.mockResolvedValue({ ok: false, reason: 'not_found' });
    render(<Harness initial={[row('p1', 'Pending clay', false)]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Pending clay' }));
    });
    expect(screen.queryByText('Pending clay')).toBeNull();
  });

  it('review fix — already approved elsewhere: the row is KEPT and the member is told to reload', async () => {
    mockDismiss.mockResolvedValue({ ok: false, reason: 'approved_elsewhere' });
    render(<Harness initial={[row('p1', 'Pending clay', false)]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Pending clay' }));
    });
    expect(screen.getByText('Pending clay')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'This suggestion is already approved, possibly in another tab. Reload the editor to see its current state.',
    );
  });

  it('a failed delete keeps the row and says so', async () => {
    mockDismiss.mockResolvedValue({ ok: false, reason: 'failed' });
    render(<Harness initial={[row('p1', 'Pending clay', false)]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Pending clay' }));
    });
    expect(screen.getByText('Pending clay')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Something went wrong, try again later.');
  });
});

describe('approved suggestions and links', () => {
  it('approved rows are grouped under "AI suggested" with Remove (committed by Save)', () => {
    const log: Act[] = [];
    render(<Harness initial={[row('a1', 'Approved map', true)]} log={log} />);
    expect(screen.getByRole('heading', { name: 'AI suggested' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Approved map' }));
    expect(log).toEqual([{ type: 'deleteAiGift', id: 'a1' }]);
  });

  it('never renders a link, even if a legacy row carries a URL', () => {
    const { container } = render(
      <Harness initial={[row('a1', 'Approved map', true, { url: 'https://shop.example/x' }), row('p1', 'Pending', false, { url: 'https://y.example' })]} />,
    );
    expect(container.querySelectorAll('a').length).toBe(0);
    expect(container.innerHTML).not.toContain('shop.example');
    expect(container.innerHTML).not.toContain('y.example');
  });
});

describe('not configured', () => {
  it('says so, offers no switch or Generate, and still shows held suggestions', () => {
    render(<Harness initial={[row('a1', 'Approved map', true), row('p1', 'Pending clay', false)]} configured={false} />);
    expect(screen.getByText('AI gift suggestions aren’t available yet.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate suggestions' })).toBeNull();
    expect(screen.getByText('Approved map')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve Pending clay' })).toBeTruthy();
  });
});
