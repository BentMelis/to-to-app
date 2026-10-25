/**
 * Notes are stored as Markdown (GitHub flavour: headings, lists, checklists, quotes, code, tables, links).
 * It stays readable in backups and in a future sync, and plain text is already almost valid Markdown.
 */

/**
 * Notes written before rich text were plain text: keep them looking exactly as they were.
 * Every line break stays a line break, and lines that would suddenly turn into a heading or quote are escaped.
 * (Lines starting with "- " do become a real list, which is what people meant by them.)
 */
export function legacyNotesToMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^(\s*)([#>])/, '$1\\$2'))
    .join('\n')
    .replace(/([^\n])\n(?=[^\n])/g, '$1  \n');
}

/**
 * The editor saves "&", "<" and ">" in text as "&amp;", "&lt;" and "&gt;" (KAN-46). Anything that shows notes without
 * the editor decodes them the way the editor does when it opens the note: those three, "&quot;" and numeric
 * references ("&#39;", "&#x263A;"). Other named entities ("&copy;") stay as typed, like in the editor.
 */
export const ENTITY = /^&(?:(amp|lt|gt|quot)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/** The character for one entity match of `ENTITY`. */
export function entityChar(m: RegExpExecArray): string {
  if (m[1]) return NAMED[m[1]];
  const cp = m[2] ? parseInt(m[2], 10) : parseInt(m[3], 16);
  // Like Markdown: invalid code points become the replacement character.
  return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp);
}

/** Decode the entities the editor decodes, in plain text (not code). */
export const decodeEntities = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g, (e) => entityChar(ENTITY.exec(e)!));

/** A short plain-text version of a note, for tooltips. */
export function notesPreview(md: string, max = 140): string {
  const text = md
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/, '') // table divider row
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-*+]\s+\[([ xX])\]\s+/, (_, c) => (c === ' ' ? '☐ ' : '☑ '))
        .replace(/^\s*([-*+]|\d+[.)])\s+/, '• ')
        .replace(/^\s*\|(.*)\|\s*$/, (_, cells: string) => cells.split('|').map((c) => c.trim()).join(' · '))
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|\*|_|`)(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/(\\?)(&(?:amp|lt|gt|quot|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, (_, esc: string, e: string) => (esc ? '\\' + e : decodeEntities(e)))
        .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .join(' · ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/**
 * Text in a paragraph that happens to start a line with "#", "> ", "- ", "1. " … would turn into a heading,
 * quote or list the next time the note is opened. The editor's own serializer only escapes inline syntax,
 * so paragraphs pass through this to escape block syntax at the start of each line.
 */
export function escapeLineStarts(md: string): string {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)([#>+=|]|-(?=\s|-|$)|\*(?=\s|$))/, '$1\\$2')
        .replace(/^(\s*\d{1,9})([.)])(?=\s|$)/, '$1\\$2'),
    )
    .join('\n');
}
