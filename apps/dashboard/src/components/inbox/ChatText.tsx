import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Bot,
  FolderKanban,
  MessageSquare,
  Plug,
  Settings,
  User,
  Workflow,
} from 'lucide-react'
import {
  appLinkKind,
  parseChatText,
  splitTagLedInline,
  type ChatInline,
  type ChatTagMap,
} from '../../lib/chatText'
import { HashtagMark } from '../ui/HashtagMark'
import { WebPageLinkIcon } from '../ui/DomainFavicon'
import { cn } from '../../lib/utils'

/** Same-origin app path: leading `/`, not protocol-relative `//`. */
export function isAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

/** Height/metrics come from `.md-app-link` in index.css (match @mentions). */
const APP_LINK_CLASS = 'md-app-link'

const STATUS_KEYS = new Set(['open', 'closed', 'awaiting', 'pending', 'active', 'paused'])

function LinkIcon({ href }: { href: string }) {
  const kind = appLinkKind(href)
  // Absolute em size via style so Lucide's default 24px attrs cannot grow the line.
  const props = {
    size: 12,
    className: 'md-app-link-icon',
    style: { width: '0.875em', height: '0.875em' } as const,
    'aria-hidden': true as const,
  }
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
      return <MessageSquare {...props} />
    case 'agent':
      return <Bot {...props} />
    case 'contact':
      return <User {...props} />
    default:
      return null
  }
}

function mentionHref(kind: string, id?: string): string | null {
  if (!id) return null
  if (kind === 'agent') return `/agents/${encodeURIComponent(id)}`
  if (kind === 'user' || kind === 'team') return '/team'
  return null
}

function MentionChip({ name, kind, id }: { name: string; kind: string; id?: string }) {
  // Same look as tagging in the composer: accent/AI tint + @name, no avatar.
  const href = mentionHref(kind, id)
  const label = `@${name}`
  if (href) {
    return (
      <Link
        to={href}
        className="mention-chip"
        data-mention-type={kind}
        data-testid="chat-mention-link"
      >
        {label}
      </Link>
    )
  }
  return (
    <span className="mention-chip" data-mention-type={kind}>
      {label}
    </span>
  )
}

function TagChip({ name, action }: { name: string; action: boolean }) {
  return (
    <Link
      to={`/communication/tag/${encodeURIComponent(name)}`}
      className="chat-tag-chip"
      data-tag-kind={action ? 'action_tag' : 'tag'}
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
        return <MentionChip key={index} name={node.name} kind={node.kind} id={node.id} />
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
          const kind = appLinkKind(node.href)
          return (
            <Link
              key={index}
              to={node.href}
              className={APP_LINK_CLASS}
              data-testid={
                kind === 'contact' ? 'chat-contact-link' : kind === 'agent' ? 'chat-agent-link' : undefined
              }
            >
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
              className="inline break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              <WebPageLinkIcon href={node.href} className="mr-[0.28em]" />
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

function ChatList({
  ordered,
  items,
}: {
  ordered: boolean
  items: ChatInline[][]
}) {
  const splits = items.map((item) => splitTagLedInline(item))
  const tagged = splits.length > 0 && splits.every((s) => s.tag != null)
  const ListTag = ordered ? 'ol' : 'ul'

  if (tagged) {
    return (
      <ListTag className="chat-list chat-list--tagged">
        {splits.map((split, index) => (
          <li key={index} className="chat-list-row">
            <span className="chat-list-mark">
              <TagChip name={split.tag!.name} action={split.tag!.kind === 'action_tag'} />
            </span>
            <span className="chat-list-body">
              {split.rest.length ? renderInline(split.rest) : null}
            </span>
          </li>
        ))}
      </ListTag>
    )
  }

  return (
    <ListTag className={cn('chat-list', ordered ? 'chat-list--ordered' : 'chat-list--bullet')}>
      {items.map((item, index) => (
        <li key={index} className="chat-list-row">
          <span className="chat-list-mark" aria-hidden>
            {ordered ? `${index + 1}.` : '•'}
          </span>
          <span className="chat-list-body">{renderInline(item)}</span>
        </li>
      ))}
    </ListTag>
  )
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
    <div className={cn('chat-text break-words', className)}>
      {blocks.map((block, index) => {
        if (block.type === 'gap') return <div key={index} className="chat-text-gap" aria-hidden />
        if (block.type === 'code') {
          return (
            <pre
              key={index}
              className="my-1.5 overflow-x-auto rounded-lg border border-border/40 bg-bg-elevated px-3 py-2 font-mono text-xs leading-relaxed"
            >
              {block.text}
            </pre>
          )
        }
        if (block.type === 'list') {
          return <ChatList key={index} ordered={block.ordered} items={block.items} />
        }
        return (
          <p
            key={index}
            className={cn(
              'whitespace-pre-wrap',
              block.bold && 'font-semibold text-text-heading',
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
