/**
 * The start of a note as a few simple blocks, for the hover preview (KAN-25).
 * Loading the real editor (Tiptap) on hover would undo its lazy loading, so this reads the small
 * Markdown subset the editor writes (see notesText.ts) and stops once a card's worth is filled.
 */

export type Span = { text: string; b?: true; i?: true; s?: true; code?: true; href?: string };

export type PreviewBlock =
  | { kind: 'h'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'p'; spans: Span[] }
  | { kind: 'li'; list: 'ul' | 'ol' | 'task'; depth: number; n?: number; checked?: boolean; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: Span[][][] }
  | { kind: 'hr' };

export interface NotesPreview {
  blocks: PreviewBlock[];
  /** Something was cut off: the card fades out and points to the full notes. */
  more: boolean;
}

/** Roughly how many characters fit on one line of the preview card. */
const LINE = 44;

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Lines of a paragraph join with a space, except hard breaks (two trailing spaces or a backslash). */
function joinLines(lines: string[]): string {
  return lines
    .map((l, i) => {
      if (i === lines.length - 1) return l.trim();
      if (/ {2,}$/.test(l)) return l.trim() + '\n';
      if (/\\$/.test(l.trimEnd())) return l.trimEnd().slice(0, -1) + '\n';
      return l.trim() + ' ';
    })
    .join('');
}

/** Only links that are safe to open from a card. */
function safeHref(url: string): string | undefined {
  const u = url.trim().replace(/^<|>$/g, '');
  return /^(https?:|mailto:)/i.test(u) ? u : undefined;
}

type Style = Omit<Span, 'text'>;

/** Inline Markdown (bold, italic, strike, code, links, escapes) into styled runs of text. */
export function parseInline(src: string, style: Style = {}): Span[] {
  const out: Span[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    // Bare web addresses become links too, as the editor shows them.
    if (style.href || style.code) out.push({ ...style, text: buf });
    else {
      let last = 0;
      for (const m of buf.matchAll(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g)) {
        if (m.index > last) out.push({ ...style, text: buf.slice(last, m.index) });
        out.push({ ...style, text: m[0], href: m[0] });
        last = m.index + m[0].length;
      }
      if (last < buf.length) out.push({ ...style, text: buf.slice(last) });
    }
    buf = '';
  };
  const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (c === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|>~<]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ ...style, code: true, text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === '<') {
      const m = /^<((?:https?:|mailto:)[^>\s]+)>/i.exec(rest);
      if (m) {
        flush();
        out.push({ ...style, text: m[1].replace(/^mailto:/i, ''), href: m[1] });
        i += m[0].length;
        continue;
      }
    }
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const m = /^!?\[((?:\\.|[^\]\\])*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest);
      if (m) {
        flush();
        const href = c === '!' ? undefined : safeHref(m[2]);
        out.push(...parseInline(m[1], href ? { ...style, href } : style));
        i += m[0].length;
        continue;
      }
    }
    const mark = rest.startsWith('**') ? '**' : rest.startsWith('__') ? '__' : rest.startsWith('~~') ? '~~' : c === '*' || c === '_' ? c : null;
    if (mark && src[i + mark.length] && !/\s/.test(src[i + mark.length]) && !(mark[0] === '_' && wordChar(src[i - 1]))) {
      // Find the matching closer: not after a space, and for "_" not inside a word.
      let j = src.indexOf(mark, i + mark.length + 1);
      while (j > -1 && (/\s/.test(src[j - 1]) || (mark[0] === '_' && wordChar(src[j + mark.length])) || src[j - 1] === '\\'))
        j = src.indexOf(mark, j + 1);
      if (j > -1) {
        flush();
        const inner = src.slice(i + mark.length, j);
        const s: Style = mark === '~~' ? { ...style, s: true } : mark.length === 2 ? { ...style, b: true } : { ...style, i: true };
        out.push(...parseInline(inner, s));
        i = j + mark.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const linesOf = (spans: Span[]) =>
  spans
    .map((s) => s.text)
    .join('')
    .split('\n')
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / LINE)), 0);

/** The first `max` characters of some styled text, ending in "…". */
function clip(spans: Span[], max: number): Span[] {
  const out: Span[] = [];
  let left = max;
  for (const s of spans) {
    if (left <= 0) break;
    if (s.text.length <= left) out.push(s);
    else out.push({ ...s, text: s.text.slice(0, left).trimEnd() });
    left -= s.text.length;
  }
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + '…' };
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => parseInline(c.trim()));

/** The opening part of a note, at most about `maxLines` lines of the preview card. */
export function notesPreviewBlocks(md: string, maxLines = 10): NotesPreview {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: PreviewBlock[] = [];
  let budget = maxLines;
  let more = false;
  let para: string[] = [];
  let quote: string[] = [];
  let item: { block: Extract<PreviewBlock, { kind: 'li' }>; lines: string[] } | null = null;
  let indents: number[] = [];

  /** Adds a block if it fits; a long text block is cut to what's left. Returns false once the card is full. */
  const add = (b: PreviewBlock): boolean => {
    if (budget <= 0) return (more = true), false;
    const cost =
      b.kind === 'code' ? b.text.split('\n').length : b.kind === 'table' ? b.rows.length : b.kind === 'hr' ? 1 : b.kind === 'h' && b.level === 1 ? linesOf(b.spans) + 1 : linesOf(b.spans);
    if (cost <= budget) {
      blocks.push(b);
      budget -= cost;
      return true;
    }
    more = true;
    if (b.kind === 'code') blocks.push({ kind: 'code', text: b.text.split('\n').slice(0, budget).join('\n') });
    else if (b.kind === 'table') blocks.push({ kind: 'table', rows: b.rows.slice(0, budget) });
    else if (b.kind !== 'hr') blocks.push({ ...b, spans: clip(b.spans, Math.max(1, budget * LINE - 4)) });
    budget = 0;
    return false;
  };

  const endPara = () => {
    const ok = !para.length || add({ kind: 'p', spans: parseInline(joinLines(para)) });
    para = [];
    return ok;
  };
  const endQuote = () => {
    const ok = !quote.length || add({ kind: 'quote', spans: parseInline(joinLines(quote)) });
    quote = [];
    return ok;
  };
  const endItem = () => {
    if (!item) return true;
    const { block, lines } = item;
    item = null;
    return add({ ...block, spans: parseInline(joinLines(lines)) });
  };
  const endAll = (keepList = false) => {
    const ok = endPara() && endQuote() && endItem();
    if (!keepList) indents = [];
    return ok;
  };

  for (let i = 0; i < lines.length; i++) {
    if (budget <= 0) {
      more ||= lines.slice(i).some((l) => l.trim()) || !!(para.length || quote.length || item);
      break;
    }
    const line = lines[i];

    if (FENCE.test(line)) {
      if (!endAll()) break;
      const fence = FENCE.exec(line)![1];
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence); i++) body.push(lines[i]);
      if (!add({ kind: 'code', text: body.join('\n') })) {
        more ||= lines.slice(i + 1).some((l) => l.trim());
        break;
      }
      continue;
    }
    if (!line.trim()) {
      if (!endAll(true)) break;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = HEADING.exec(line))) {
      if (!endAll() || !add({ kind: 'h', level: Math.min(3, m[1].length) as 1 | 2 | 3, spans: parseInline(m[2]) })) break;
      continue;
    }
    if (RULE.test(line) && !para.length) {
      if (!endAll() || !add({ kind: 'hr' })) break;
      continue;
    }
    if (line.trim().startsWith('|') && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
      if (!endAll()) break;
      const rows = [cells(line)];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      i--;
      if (!add({ kind: 'table', rows })) break;
      continue;
    }
    const task = TASK.exec(line), bullet = !task && BULLET.exec(line), num = !task && !bullet && NUMBER.exec(line);
    const li = task || bullet || num;
    if (li) {
      if (!endPara() || !endQuote() || !endItem()) break;
      // Depth from indentation, whatever the indent width the note was written with.
      const indent = li[1].replace(/\t/g, '    ').length;
      while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
      const depth = Math.min(indents.length, 3);
      indents.push(indent);
      item = task
        ? { block: { kind: 'li', list: 'task', depth, checked: task[2] !== ' ', spans: [] }, lines: [task[3]] }
        : bullet
          ? { block: { kind: 'li', list: 'ul', depth, spans: [] }, lines: [bullet[2]] }
          : { block: { kind: 'li', list: 'ol', depth, n: Number((num as RegExpExecArray)[2]), spans: [] }, lines: [(num as RegExpExecArray)[3]] };
      continue;
    }
    if ((m = QUOTE.exec(line))) {
      if (!endPara() || !endItem()) break;
      indents = [];
      quote.push(m[1]);
      continue;
    }
    // Plain text: continues an open list item or quote, or is part of a paragraph.
    if (item) item.lines.push(line);
    else if (quote.length) quote.push(line);
    else para.push(line);
  }
  endAll();
  return { blocks, more };
}
