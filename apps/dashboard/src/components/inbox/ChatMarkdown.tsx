import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Standard renderer for AI-generated text in chat surfaces (assistant panel,
 * agent sessions, streaming bubbles). Lightweight hand-rolled markdown —
 * no dependency — covering what models actually emit: headings, bold/italic,
 * inline code, fenced code, links, ordered/unordered lists, tables,
 * blockquotes, and horizontal rules. Safe by construction: only text nodes,
 * never raw HTML.
 *
 * In-app paths (`/settings/...`, `/learn/...`) render as inline nav pills
 * via React Router so agents can deep-link without breadcrumb prose.
 */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g

/** Same-origin app path: leading `/`, not protocol-relative `//`. */
export function isAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

const APP_LINK_CLASS =
  'md-app-link inline-flex items-center gap-1 rounded-md border border-border/55 bg-bg-elevated px-1.5 py-0.5 align-baseline text-[12px] font-medium text-accent no-underline transition-colors hover:border-accent/45 hover:bg-bg-hover/70'

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  // Local instance: renderInline recurses (bold content), and a shared global
  // regex would have its lastIndex reset by the inner call, re-matching the
  // same token forever (OOM crash).
  const pattern = new RegExp(INLINE_PATTERN.source, 'g')
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-text-heading">
          {renderInline(token.slice(2, -2))}
        </strong>,
      )
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-bg-elevated px-1 py-px font-mono text-[0.86em] text-text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('[')) {
      const close = token.indexOf('](')
      const label = token.slice(1, close)
      const href = token.slice(close + 2, -1)
      if (isAppPath(href)) {
        nodes.push(
          <Link key={key++} to={href} className={APP_LINK_CLASS}>
            {label}
          </Link>,
        )
      } else if (/^(https?:\/\/|mailto:)/i.test(href)) {
        nodes.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {label}
          </a>,
        )
      } else {
        nodes.push(label)
      }
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.endsWith('|') && t.length > 2
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function ChatMarkdownImpl({ content, className }: { content: string; className?: string }) {
  const blocks: ReactNode[] = []
  const lines = content.split('\n')
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code
    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg border border-border/40 bg-bg-elevated px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary"
        >
          {code.join('\n')}
        </pre>,
      )
      continue
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-border/40" />)
      i += 1
      continue
    }

    // Headings (chat-scale: keep them modest)
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const cls =
        level <= 2
          ? 'text-[14.5px] font-semibold text-text-heading'
          : 'text-[13.5px] font-semibold text-text-heading'
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(headingMatch[2])}
        </p>,
      )
      i += 1
      continue
    }

    // Table
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        if (!isTableSeparator(lines[i])) rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border/40 bg-bg-elevated/60">
                {header.map((cell, idx) => (
                  <th
                    key={idx}
                    className="px-2.5 py-1.5 text-left font-semibold text-text-heading"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b border-border/40 last:border-b-0">
                  {header.map((_, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1.5 align-top text-text-primary">
                      {renderInline(row[cIdx] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 border-accent/40 pl-3 text-text-secondary"
        >
          {renderInline(quote.join(' '))}
        </blockquote>,
      )
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i += 1
      continue
    }

    // Paragraph (greedy until next structural line)
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|\s*>|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap break-words">
        {renderInline(para.join('\n'))}
      </p>,
    )
  }

  return <div className={`space-y-2 ${className ?? ''}`}>{blocks}</div>
}

/** Memoized: chat lists re-render often; parsing only re-runs when text changes. */
const ChatMarkdown = memo(ChatMarkdownImpl)
export default ChatMarkdown
