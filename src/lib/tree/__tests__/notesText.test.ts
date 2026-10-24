import { describe, expect, it } from 'vitest';
import { legacyNotesToMarkdown, notesPreview } from '../notesText';
import { parseDoc } from '../model';
import { DOC_VERSION } from '../types';

describe('notes as Markdown', () => {
  it('keeps old plain-text notes looking the same', () => {
    expect(legacyNotesToMarkdown('Kickoff Monday\nBudget 5k\n\n# not a heading\n> not a quote')).toBe(
      'Kickoff Monday  \nBudget 5k\n\n\\# not a heading  \n\\> not a quote',
    );
  });

  it('migrates notes only in documents from before v4', () => {
    const doc = (v: number) => ({
      v,
      meetings: [],
      root: { id: 'root', type: 'root', title: 'R', children: [{ id: 'a', type: 'project', title: 'A', notes: 'line 1\nline 2', children: [] }] },
    });
    expect(parseDoc(doc(3))!.root.children[0].notes).toBe('line 1  \nline 2');
    expect(parseDoc(doc(4))!.root.children[0].notes).toBe('line 1\nline 2');
    expect(parseDoc(doc(4))!.v).toBe(DOC_VERSION);
  });

  it('makes a readable plain-text preview', () => {
    const md = [
      '# Kickoff',
      'Budget is **5k**, see [the brief](https://example.com/brief) and `npm run`.',
      '',
      '- [x] Book room',
      '- [ ] Send invites',
      '1. First',
      '> Ask Sam',
      '',
      '| Who | What |',
      '| --- | --- |',
      '| Anna | Design |',
    ].join('\n');
    expect(notesPreview(md, 500)).toBe(
      'Kickoff · Budget is 5k, see the brief and npm run. · ☑ Book room · ☐ Send invites · • First · Ask Sam · Who · What · Anna · Design',
    );
    expect(notesPreview('a'.repeat(200))).toHaveLength(140);
  });
});

describe('escaping block syntax inside paragraphs', () => {
  it('escapes line starts that would change meaning, and nothing else', async () => {
    const { escapeLineStarts } = await import('../notesText');
    expect(escapeLineStarts('Budget 5k  \n# room 4  \n- not a list\n1. not numbered\n> no quote\n---')).toBe(
      'Budget 5k  \n\\# room 4  \n\\- not a list\n1\\. not numbered\n\\> no quote\n\\---',
    );
    expect(escapeLineStarts('**bold** start, 2024 numbers, -5 degrees')).toBe('**bold** start, 2024 numbers, -5 degrees');
  });
});
