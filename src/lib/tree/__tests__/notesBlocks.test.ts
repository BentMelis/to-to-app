import { describe, expect, it } from 'vitest';
import { notesPreviewBlocks, parseInline } from '../notesBlocks';
import { legacyNotesToMarkdown } from '../notesText';

describe('inline Markdown for the notes preview', () => {
  it('reads bold, italic, strike, code and links', () => {
    expect(parseInline('Budget is **5k**, _maybe_ ~~4k~~, run `npm i` and see [the brief](https://example.com/b).')).toEqual([
      { text: 'Budget is ' },
      { text: '5k', b: true },
      { text: ', ' },
      { text: 'maybe', i: true },
      { text: ' ' },
      { text: '4k', s: true },
      { text: ', run ' },
      { text: 'npm i', code: true },
      { text: ' and see ' },
      { text: 'the brief', href: 'https://example.com/b' },
      { text: '.' },
    ]);
  });

  it('nests styles and keeps escaped or in-word markers as text', () => {
    expect(parseInline('**bold _and italic_**')).toEqual([{ text: 'bold ', b: true }, { text: 'and italic', b: true, i: true }]);
    expect(parseInline('snake_case_name and 2 * 3 * 4 and \\*not\\*')).toEqual([{ text: 'snake_case_name and 2 * 3 * 4 and *not*' }]);
  });

  it('links bare and angle-bracket addresses, and never unsafe ones', () => {
    expect(parseInline('see https://example.com/x.')).toEqual([{ text: 'see ' }, { text: 'https://example.com/x', href: 'https://example.com/x' }, { text: '.' }]);
    expect(parseInline('<mailto:sam@example.com>')).toEqual([{ text: 'sam@example.com', href: 'mailto:sam@example.com' }]);
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ text: 'click' }, { text: ')' }]);
    expect(parseInline('![diagram](https://example.com/d.png)')).toEqual([{ text: 'diagram' }]);
  });
});

describe('notes preview blocks', () => {
  it('reads headings, paragraphs, lists, checklists, quotes, code, tables and rules', () => {
    const md = [
      '# Kickoff',
      'Budget 5k',
      'and a room.',
      '',
      '- [x] Book room',
      '- [ ] Send invites',
      '  - Anna',
      '1. First',
      '2. Second',
      '> Ask Sam',
      '',
      '```',
      'npm run dev',
      '```',
      '| Who | What |',
      '| --- | --- |',
      '| Anna | Design |',
      '---',
    ].join('\n');
    expect(notesPreviewBlocks(md, 50)).toEqual({
      more: false,
      blocks: [
        { kind: 'h', level: 1, spans: [{ text: 'Kickoff' }] },
        { kind: 'p', spans: [{ text: 'Budget 5k and a room.' }] },
        { kind: 'li', list: 'task', depth: 0, checked: true, spans: [{ text: 'Book room' }] },
        { kind: 'li', list: 'task', depth: 0, checked: false, spans: [{ text: 'Send invites' }] },
        { kind: 'li', list: 'ul', depth: 1, spans: [{ text: 'Anna' }] },
        { kind: 'li', list: 'ol', depth: 0, n: 1, spans: [{ text: 'First' }] },
        { kind: 'li', list: 'ol', depth: 0, n: 2, spans: [{ text: 'Second' }] },
        { kind: 'quote', spans: [{ text: 'Ask Sam' }] },
        { kind: 'code', text: 'npm run dev' },
        { kind: 'table', rows: [[[{ text: 'Who' }], [{ text: 'What' }]], [[{ text: 'Anna' }], [{ text: 'Design' }]]] },
        { kind: 'hr' },
      ],
    });
  });

  it('keeps line breaks of notes written before rich text', () => {
    const md = legacyNotesToMarkdown('Kickoff Monday\nBudget 5k\n# not a heading');
    expect(notesPreviewBlocks(md).blocks).toEqual([{ kind: 'p', spans: [{ text: 'Kickoff Monday\nBudget 5k\n# not a heading' }] }]);
  });

  it('stops after a card full and says there is more', () => {
    const md = Array.from({ length: 20 }, (_, i) => `- item ${i + 1}`).join('\n');
    const r = notesPreviewBlocks(md, 5);
    expect(r.blocks).toHaveLength(5);
    expect(r.more).toBe(true);
    expect(notesPreviewBlocks('- one\n- two', 2)).toEqual({ more: false, blocks: expect.any(Array) });
  });

  it('cuts a long paragraph short with an ellipsis', () => {
    const r = notesPreviewBlocks('word '.repeat(200), 3);
    expect(r.more).toBe(true);
    expect(r.blocks).toHaveLength(1);
    const text = (r.blocks[0] as { spans: { text: string }[] }).spans.map((s) => s.text).join('');
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(140);
  });

  it('is empty for empty notes', () => {
    expect(notesPreviewBlocks('')).toEqual({ blocks: [], more: false });
  });
});
