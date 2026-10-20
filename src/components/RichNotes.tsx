'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import Paragraph from '@tiptap/extension-paragraph';
import { escapeLineStarts } from '@/lib/tree/notesText';

/** Plain text that starts a line with "#", "- ", "1. "… stays plain text when saved as Markdown. */
const SafeParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    const out = this.parent?.(node, h, ctx) ?? '';
    return escapeLineStarts(out);
  },
});

interface Props {
  /** Markdown. */
  value: string;
  placeholder: string;
  label: string;
  /** Markdown, on every change (the caller debounces). */
  onChange: (md: string) => void;
}

/**
 * Rich text notes: a small formatting bar plus the usual shortcuts and Markdown-style typing
 * ("# " heading, "- " list, "[ ] " checklist, "> " quote, ``` code block). Stored as Markdown.
 */
export default function RichNotes({ value, placeholder, label, onChange }: Props) {
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        paragraph: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
      }),
      SafeParagraph,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: value,
    contentType: 'markdown',
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'notes-rich', 'aria-label': label, 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' },
    },
    onUpdate: ({ editor }) => changed.current(editor.isEmpty ? '' : editor.getMarkdown()),
  });

  if (!editor) return <div className="notes-rich notes-loading" aria-busy="true" />;
  return (
    <div
      className="notes-editor"
      onClick={(e) => {
        // Links open with Ctrl/⌘ + click (a plain click puts the cursor in the link to edit it).
        const a = (e.target as HTMLElement).closest('a');
        if (a && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener,noreferrer');
        }
      }}
    >
      <FormatBar editor={editor} />
      <EditorContent editor={editor} className="notes-scroll" />
    </div>
  );
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function FormatBar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('code'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  });
  const run = (f: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => f(editor.chain().focus()).run();
  return (
    <div className="fmt-wrap">
      <div className="fmt-bar" role="toolbar" aria-label="Formatting">
        <Fmt on={s.bold} title={`Bold (${mod}B)`} onClick={run((c) => c.toggleBold())}>
          <b>B</b>
        </Fmt>
        <Fmt on={s.italic} title={`Italic (${mod}I)`} onClick={run((c) => c.toggleItalic())}>
          <i>I</i>
        </Fmt>
        <Fmt on={s.strike} title={`Strikethrough (${mod}Shift+S)`} onClick={run((c) => c.toggleStrike())}>
          <s>S</s>
        </Fmt>
        <span className="fmt-sep" />
        <Fmt on={s.h1} title="Heading (# )" onClick={run((c) => c.toggleHeading({ level: 1 }))}>
          H1
        </Fmt>
        <Fmt on={s.h2} title="Subheading (## )" onClick={run((c) => c.toggleHeading({ level: 2 }))}>
          H2
        </Fmt>
        <Fmt on={s.h3} title="Small heading (### )" onClick={run((c) => c.toggleHeading({ level: 3 }))}>
          H3
        </Fmt>
        <span className="fmt-sep" />
        <Fmt on={s.bullet} title="Bulleted list (- )" onClick={run((c) => c.toggleBulletList())}>
          <Svg d="M6 4h8M6 8h8M6 12h8" dots />
        </Fmt>
        <Fmt on={s.ordered} title="Numbered list (1. )" onClick={run((c) => c.toggleOrderedList())}>
          <Svg d="M7 4h7M7 8h7M7 12h7" nums />
        </Fmt>
        <Fmt on={s.task} title="Checklist ([ ] )" onClick={run((c) => c.toggleTaskList())}>
          <Svg d="M2.5 3.5h3v3h-3zM2.5 9.5h3v3h-3zM8 5h6M8 11h6M3.2 11l.9.9 1.6-1.9" />
        </Fmt>
        <span className="fmt-sep" />
        <Fmt on={s.quote} title="Quote (> )" onClick={run((c) => c.toggleBlockquote())}>
          <Svg d="M3 4v8M6.5 5h7M6.5 8h7M6.5 11h5" />
        </Fmt>
        <Fmt on={s.code} title={`Inline code (${mod}E)`} onClick={run((c) => c.toggleCode())}>
          <Svg d="M6 4.5 2.5 8 6 11.5M10 4.5l3.5 3.5-3.5 3.5" />
        </Fmt>
        <Fmt on={s.codeBlock} title="Code block (```)" onClick={run((c) => c.toggleCodeBlock())}>
          <Svg d="M2.5 2.5h11v11h-11zM6 6 4.5 8 6 10M10 6l1.5 2-1.5 2" />
        </Fmt>
        <Fmt on={s.link || linkOpen} title={`Link (${mod}K)`} onClick={() => setLinkOpen((o) => !o)}>
          <Svg d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6" />
        </Fmt>
        <Fmt
          on={s.table}
          title={s.table ? 'Table options' : 'Insert a table'}
          onClick={s.table ? run((c) => c) : run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
        >
          <Svg d="M2.5 3h11v10h-11zM2.5 6.5h11M2.5 9.75h11M6.2 3v10M9.8 3v10" />
        </Fmt>
      </div>
      {s.table && (
        <div className="fmt-bar fmt-sub" role="toolbar" aria-label="Table">
          <span className="fmt-label">Table</span>
          <Fmt title="Add row below" onClick={run((c) => c.addRowAfter())}>
            + Row
          </Fmt>
          <Fmt title="Add column to the right" onClick={run((c) => c.addColumnAfter())}>
            + Column
          </Fmt>
          <Fmt title="Delete this row" onClick={run((c) => c.deleteRow())}>
            − Row
          </Fmt>
          <Fmt title="Delete this column" onClick={run((c) => c.deleteColumn())}>
            − Column
          </Fmt>
          <Fmt title="Delete the table" onClick={run((c) => c.deleteTable())}>
            Delete table
          </Fmt>
        </div>
      )}
      {linkOpen && <LinkField editor={editor} onDone={() => setLinkOpen(false)} />}
      <LinkShortcut editor={editor} onOpen={() => setLinkOpen(true)} />
    </div>
  );
}

/** Ctrl/⌘+K opens the link field. */
function LinkShortcut({ editor, onOpen }: { editor: Editor; onOpen: () => void }) {
  useEffect(() => {
    const el = editor.view.dom;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    el.addEventListener('keydown', h);
    return () => el.removeEventListener('keydown', h);
  }, [editor, onOpen]);
  return null;
}

function LinkField({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [url, setUrl] = useState<string>(() => editor.getAttributes('link').href ?? '');
  const has = editor.isActive('link');
  const apply = () => {
    const u = url.trim();
    const c = editor.chain().focus().extendMarkRange('link');
    if (!u) c.unsetLink().run();
    else if (editor.state.selection.empty && !has) {
      // Nothing selected: insert the address itself as a link.
      const href = /^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`;
      c.insertContent({ type: 'text', text: u, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else c.setLink({ href: /^[a-z][\w+.-]*:/i.test(u) || u.startsWith('mailto:') ? u : `https://${u}` }).run();
    onDone();
  };
  return (
    <form
      className="fmt-link"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          onDone();
          editor.commands.focus();
        }
      }}
    >
      <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste or type a link" aria-label="Link address" />
      <button className="tb primary" type="submit">
        {has ? 'Update' : 'Add link'}
      </button>
      {has && (
        <button
          className="tb"
          type="button"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            onDone();
          }}
        >
          Remove
        </button>
      )}
    </form>
  );
}

function Fmt({ on, title, onClick, children, disabled }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={'fmt' + (on ? ' on' : '')}
      aria-pressed={on}
      aria-label={title.replace(/ \(.*\)$/, '')}
      title={title}
      disabled={disabled}
      // Keep the cursor in the text.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Svg({ d, dots, nums }: { d: string; dots?: boolean; nums?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {dots && [4, 8, 12].map((y) => <circle key={y} cx="3" cy={y} r="1.1" fill="currentColor" />)}
      {nums &&
        ['1', '2', '3'].map((n, i) => (
          <text key={n} x="1.6" y={5.6 + i * 4} fontSize="4.6" fontWeight="700" fill="currentColor">
            {n}
          </text>
        ))}
    </svg>
  );
}
