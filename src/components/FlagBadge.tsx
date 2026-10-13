import type { FlagKind, Meeting } from '@/lib/tree/types';

export const IconMention = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 6.5v3h2l4.5 3v-9l-4.5 3z" fill="currentColor" />
    <path d="M11.5 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const flagLabel = (kind: FlagKind, m: Meeting) => (kind === 'ask' ? `Ask at ${m.name}` : `Mention at ${m.name}`);

/** A small coloured tag: "?" to ask, a megaphone to mention. The colour says which meeting or person. */
export function FlagBadge({ kind, meeting, small }: { kind: FlagKind; meeting: Meeting; small?: boolean }) {
  return (
    <span className={`flag-badge m-${meeting.color} ${kind}` + (small ? ' small' : '')} title={flagLabel(kind, meeting)} aria-hidden="true">
      {kind === 'ask' ? '?' : <IconMention />}
    </span>
  );
}
