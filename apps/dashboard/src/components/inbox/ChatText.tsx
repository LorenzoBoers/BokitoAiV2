import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { parseChatText, type ChatInline } from '../../lib/chatText'
import { cn } from '../../lib/utils'

/** Same-origin app path: leading `/`, not protocol-relative `//`. */
export function isAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

const APP_LINK_CLASS =
  'md-app-link inline-flex items-center gap-1 rounded-md border border-border/55 bg-bg-elevated px-1.5 py-0.5 align-baseline text-xs font-medium text-accent no-underline transition-colors hover:border-border-light hover:bg-bg-hover/70'

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
        return (
          <span key={index} className="mention-chip" data-mention-type={node.kind}>
            @{node.name}
          </span>
        )
      case 'link':
        if (isAppPath(node.href)) {
          return (
            <Link key={index} to={node.href} className={APP_LINK_CLASS}>
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
}: {
  content: string
  streaming?: boolean
  className?: string
}) {
  const blocks = parseChatText(content, { streaming })
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
