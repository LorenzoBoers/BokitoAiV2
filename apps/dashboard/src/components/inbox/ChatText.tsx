import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, FolderKanban, Inbox, Plug, Settings, Workflow } from 'lucide-react'
import {
  appLinkKind,
  parseChatText,
  type ChatInline,
  type ChatTagMap,
} from '../../lib/chatText'
import { ContactAvatar } from '../ui/ContactAvatar'
import { HashtagMark } from '../ui/HashtagMark'
import { cn } from '../../lib/utils'

/** Same-origin app path: leading `/`, not protocol-relative `//`. */
export function isAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

const APP_LINK_CLASS =
  'md-app-link inline-flex items-center gap-1 rounded-md border border-border/55 bg-bg-elevated px-1.5 py-0.5 align-baseline text-xs font-medium text-accent no-underline transition-colors hover:border-border-light hover:bg-bg-hover/70'

const STATUS_KEYS = new Set(['open', 'closed', 'awaiting', 'pending', 'active', 'paused'])

function LinkIcon({ href }: { href: string }) {
  const kind = appLinkKind(href)
  const props = { size: 11, className: 'shrink-0 opacity-80', 'aria-hidden': true as const }
  switch (kind) {
    case 'docs':
      return <BookOpen {...props} />
    case 'connections':
      return <Plug {...props} />
    case 'settings':
      return <Settings {...props} />
    case 'project':
      return <FolderKanban {...props} />
    case 'flow':
      return <Workflow {...props} />
    case 'inbox':
      return <Inbox {...props} />
    default:
      return null
  }
}

function ContactAppLink({ href, label }: { href: string; label: string }) {
  return (
    <Link to={href} className={APP_LINK_CLASS} data-testid="chat-contact-link">
      <ContactAvatar name={label} size={14} className="shrink-0" />
      {label}
    </Link>
  )
}

function MentionChip({ name, kind }: { name: string; kind: string }) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase()
  return (
    <span className="mention-chip inline-flex items-center gap-1 align-baseline" data-mention-type={kind}>
      <span
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-[9px] font-semibold text-text-muted ring-1 ring-border/50"
        aria-hidden
      >
        {initial}
      </span>
      @{name}
    </span>
  )
}

function TagChip({ name, action }: { name: string; action: boolean }) {
  return (
    <Link
      to={`/communication/tag/${encodeURIComponent(name)}`}
      className={cn(
        'inline-flex items-baseline gap-px align-baseline no-underline hover:underline',
        action ? 'text-accent' : 'text-text-secondary',
      )}
    >
      <HashtagMark category={action} />
      <span>{name}</span>
    </Link>
  )
}

function renderInline(nodes: ChatInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text
      case 'bold':
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        )
      case 'italic':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'strike':
        return <s key={index}>{renderInline(node.children)}</s>
      case 'code':
        return (
          <code key={index} className="rounded bg-bg-elevated px-1 py-px font-mono text-[0.86em]">
            {node.text}
          </code>
        )
      case 'mention':
        return <MentionChip key={index} name={node.name} kind={node.kind} />
      case 'tag':
        return <TagChip key={index} name={node.name} action={node.kind === 'action_tag'} />
      case 'status': {
        const key = STATUS_KEYS.has(node.key) ? node.key : 'other'
        return (
          <span
            key={index}
            className="inline-flex items-center rounded-md border border-border/50 bg-bg-elevated px-1.5 py-px text-[11px] font-medium text-text-muted align-baseline"
            data-status={key}
          >
            {node.label}
          </span>
        )
      }
      case 'link':
        if (node.href.startsWith('status:')) {
          return (
            <span
              key={index}
              className="inline-flex items-center rounded-md border border-border/50 bg-bg-elevated px-1.5 py-px text-[11px] font-medium text-text-muted align-baseline"
            >
              {node.label}
            </span>
          )
        }
        if (isAppPath(node.href)) {
          if (appLinkKind(node.href) === 'contact') {
            return <ContactAppLink key={index} href={node.href} label={node.label} />
          }
          return (
            <Link key={index} to={node.href} className={APP_LINK_CLASS}>
              <LinkIcon href={node.href} />
              {node.label}
            </Link>
          )
        }
        if (/^(https?:\/\/|mailto:)/i.test(node.href)) {
          return (
            <a
              key={index}
              href={node.href}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              {node.label}
            </a>
          )
        }
        return node.label
      default:
        return null
    }
  })
}

/**
 * Renderer for every chat bubble (agent, teammate, customer chat), live and
 * saved. WhatsApp-level formatting only; email HTML keeps MessageHtmlBody.
 */
function ChatTextImpl({
  content,
  streaming = false,
  className,
  tags,
}: {
  content: string
  streaming?: boolean
  className?: string
  /** Lowercase tag name -> kind for bare #name chips. */
  tags?: ChatTagMap
}) {
  const blocks = parseChatText(content, { streaming, tags })
  return (
    <div className={cn('break-words', className)}>
      {blocks.map((block, index) => {
        if (block.type === 'gap') return <div key={index} className="h-2" aria-hidden />
        if (block.type === 'code') {
          return (
            <pre
              key={index}
              className="my-1 overflow-x-auto rounded-lg border border-border/40 bg-bg-elevated px-3 py-2 font-mono text-xs leading-relaxed"
            >
              {block.text}
            </pre>
          )
        }
        return (
          <p
            key={index}
            className={cn(
              'whitespace-pre-wrap',
              block.bold && 'font-semibold',
              block.quote && 'border-l-2 border-border pl-2 text-text-secondary',
            )}
          >
            {renderInline(block.inline)}
          </p>
        )
      })}
    </div>
  )
}

const ChatText = memo(ChatTextImpl)
export default ChatText
