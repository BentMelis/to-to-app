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
        .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
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
