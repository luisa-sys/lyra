/**
 * KAN-487 — editor UI helpers (spec v0.8 §01–§10; plan §C counters, caps,
 * undo row, section numbering; plan §D undo copy). Expected values are
 * literals from the spec / plan.
 */
import {
  UNDO_TTL_MS,
  answerLabelContext,
  capState,
  charCount,
  describedBy,
  linkChip,
  linkChipText,
  listRowGroupLabel,
  liveFieldError,
  oneLine,
  rowHasError,
  rowLabel,
  sectionHeadingText,
  undoMessage,
  undoRemainingMs,
} from '@/modules/profile/editor/editor-ui-helpers';

describe('KAN-487 charCount — `{n} / {max}` in code points', () => {
  test('reads n / max', () => {
    expect(charCount('hello', 60)).toEqual({ count: 5, max: 60, over: false, text: '5 / 60' });
  });

  test('exactly at the limit is not over', () => {
    expect(charCount('a'.repeat(100), 100).over).toBe(false);
  });

  test('one over the limit is over', () => {
    expect(charCount('a'.repeat(101), 100)).toEqual({ count: 101, max: 100, over: true, text: '101 / 100' });
  });

  test('an emoji counts once (code points, not UTF-16 units)', () => {
    expect(charCount('😀😀', 2)).toEqual({ count: 2, max: 2, over: false, text: '2 / 2' });
  });

  test('a line break counts as one character', () => {
    expect(charCount('a\nb', 200).text).toBe('3 / 200');
  });
});

describe('KAN-487 liveFieldError', () => {
  test('the validator error wins', () => {
    expect(liveFieldError('x', 60, 'Display name', 'Display name is required.')).toBe('Display name is required.');
  });

  test('over the limit shows the too-long message live', () => {
    expect(liveFieldError('a'.repeat(61), 60, 'Display name', undefined)).toBe(
      'Display name is too long: 61 characters (limit 60, including spaces).',
    );
  });

  test('at the limit there is no error', () => {
    expect(liveFieldError('a'.repeat(60), 60, 'Display name', undefined)).toBeUndefined();
  });

  test('no limit, no error', () => {
    expect(liveFieldError('a'.repeat(5000), undefined, 'Link', undefined)).toBeUndefined();
  });
});

describe('KAN-487 capState — Add disabled at the cap with "n of cap"', () => {
  test('below the cap', () => {
    expect(capState(5, 6)).toEqual({ atCap: false, note: '5 of 6' });
  });

  test('at the cap', () => {
    expect(capState(25, 25)).toEqual({ atCap: true, note: '25 of 25' });
  });

  test('over the cap (legacy data) is still at cap', () => {
    expect(capState(16, 15).atCap).toBe(true);
  });
});

describe('KAN-487 describedBy', () => {
  test('joins present ids in order', () => {
    expect(describedBy('a-help', undefined, 'a-count', false, 'a-error')).toBe('a-help a-count a-error');
  });

  test('undefined when none', () => {
    expect(describedBy(undefined, null, '', false)).toBeUndefined();
  });
});

describe('KAN-487 rowHasError', () => {
  const errors = { 'new:abc.title': 'Title is required.', 'profile.display_name': 'x', 'lists.causes': 'cap' };

  test('true for an error on one of the row fields', () => {
    expect(rowHasError(errors, 'new:abc')).toBe(true);
  });

  test('false for another row, even one whose key is a prefix', () => {
    expect(rowHasError(errors, 'new:ab')).toBe(false);
    expect(rowHasError(errors, 'causes')).toBe(false);
  });
});

describe('KAN-487 summary text', () => {
  test('oneLine collapses breaks and spaces', () => {
    expect(oneLine('  a\n\n b   c ', 50)).toBe('a b c');
  });

  test('oneLine cuts at max code points with an ellipsis', () => {
    expect(oneLine('abcdefghij', 5)).toBe('abcd…');
    expect(oneLine('abcde', 5)).toBe('abcde');
  });

  test('rowLabel uses the title, else the description', () => {
    expect(rowLabel('Coffee', 'Flat white')).toBe('Coffee');
    expect(rowLabel('  ', 'Flat white')).toBe('Flat white');
    expect(rowLabel('', '')).toBe('');
  });
});

describe('KAN-487 undo row', () => {
  test('message (plan §D proposed copy)', () => {
    expect(undoMessage('Coffee')).toBe("Removed 'Coffee'.");
  });

  test('a blank row still gets a message', () => {
    expect(undoMessage('')).toBe('Removed an empty entry.');
  });

  test('expires 8 s after removal', () => {
    expect(UNDO_TTL_MS).toBe(8000);
    expect(undoRemainingMs(1000, 1000)).toBe(8000);
    expect(undoRemainingMs(1000, 6000)).toBe(3000);
    expect(undoRemainingMs(1000, 9000)).toBe(0);
    expect(undoRemainingMs(1000, 20000)).toBe(0);
  });
});

describe('KAN-487 linkChipText', () => {
  test('shows the host without www.', () => {
    expect(linkChipText('https://www.example.com/a/b?c=1')).toBe('example.com');
  });

  test('accepts a bare domain', () => {
    expect(linkChipText('shop.example.org/item')).toBe('shop.example.org');
  });

  test('blank stays blank', () => {
    expect(linkChipText('   ')).toBe('');
  });
});

describe('KAN-487 linkChip — only safe links are clickable', () => {
  test('an https link gets an href', () => {
    expect(linkChip('https://example.com/x')).toEqual({ text: 'example.com', href: 'https://example.com/x' });
  });

  test('a javascript: link is text only', () => {
    expect(linkChip('javascript:alert(1)').href).toBeNull();
  });

  test('a link with credentials is text only', () => {
    expect(linkChip('https://user:pw@example.com/').href).toBeNull();
  });

  test('blank: no text, no href', () => {
    expect(linkChip('')).toEqual({ text: '', href: null });
  });
});

describe('KAN-487 sectionHeadingText', () => {
  test('two-digit number, em dash', () => {
    expect(sectionHeadingText(1, 'About Me')).toBe('01 — About Me');
    expect(sectionHeadingText(10, 'Billboard')).toBe('10 — Billboard');
  });
});

// KAN-487 PR2 review Major 5 / minor (f): field context for screen readers.
describe('KAN-487 answerLabelContext — every answer field names its question', () => {
  test('the question follows the visible "Your answer"', () => {
    expect('Your answer' + answerLabelContext('Who you’d invite for a dinner party, dead or alive?')).toBe(
      'Your answer: Who you’d invite for a dinner party, dead or alive?',
    );
  });

  test('whitespace in the question is collapsed', () => {
    expect(answerLabelContext('  My\nquestion  ')).toBe(': My question');
  });

  test('a blank question adds nothing', () => {
    expect(answerLabelContext('   ')).toBe('');
  });
});

describe('KAN-487 listRowGroupLabel — repeated list labels get context', () => {
  test('list name and 1-based position of n', () => {
    expect(listRowGroupLabel('Gifts', 1, 3)).toBe('Gifts, entry 2 of 3');
    expect(listRowGroupLabel('Tips & life hacks I can share', 0, 1)).toBe('Tips & life hacks I can share, entry 1 of 1');
  });
});
