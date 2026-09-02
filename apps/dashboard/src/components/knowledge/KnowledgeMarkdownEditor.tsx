import { useEffect, useMemo, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { Bold, Heading2, Italic, List, ListOrdered } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown || '', { async: false })
  return typeof html === 'string' ? html : ''
}

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html || '').trimEnd()
}

type EditorMode = 'write' | 'markdown'

type Props = {
  value: string
  onChange: (markdown: string) => void
  className?: string
  minHeightClassName?: string
  writeLabel?: string
  markdownLabel?: string
}

/**
 * Knowledge / project doc editor. Persist always as markdown; Write mode is
 * TipTap WYSIWYG, Markdown mode is the raw textarea.
 */
export function KnowledgeMarkdownEditor({
  value,
  onChange,
  className,
  minHeightClassName = 'min-h-96',
  writeLabel = 'Write',
  markdownLabel = 'Markdown',
}: Props) {
  const [mode, setMode] = useState<EditorMode>('write')
  const initialHtml = useMemo(() => markdownToHtml(value), []) // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none focus:outline-none px-3 py-2 text-sm text-text-primary',
          minHeightClassName,
        ),
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(htmlToMarkdown(ed.getHTML()))
    },
  })

  // Sync external value into TipTap when switching back to Write, or when
  // parent resets draft (e.g. load another doc) while staying in Write mode.
  useEffect(() => {
    if (!editor || mode !== 'write') return
    const current = htmlToMarkdown(editor.getHTML())
    if (current === (value || '').trimEnd()) return
    editor.commands.setContent(markdownToHtml(value), { emitUpdate: false })
  }, [editor, mode, value])

  return (
    <div className={cn('rounded-lg border border-border/60 bg-bg-surface', className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-2 py-1.5">
        <div className="flex rounded-md border border-border/50 p-0.5">
          <button
            type="button"
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              mode === 'write' ? 'bg-bg-hover font-medium text-text-heading' : 'text-text-muted',
            )}
            onClick={() => setMode('write')}
          >
            {writeLabel}
          </button>
          <button
            type="button"
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              mode === 'markdown' ? 'bg-bg-hover font-medium text-text-heading' : 'text-text-muted',
            )}
            onClick={() => setMode('markdown')}
          >
            {markdownLabel}
          </button>
        </div>
        {mode === 'write' && editor ? (
          <div className="ml-1 flex items-center gap-0.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title="Heading"
            >
              <Heading2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet list"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="Numbered list"
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      {mode === 'write' ? (
        <EditorContent editor={editor} />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0',
            minHeightClassName,
          )}
        />
      )}
    </div>
  )
}
