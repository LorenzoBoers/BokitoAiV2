import type { ReactNode } from 'react'
import { docsIcon } from '../../lib/docs-icons'
import { headingId } from '../../lib/docs-toc'
import { isDocsAssetSrc, parseImageLine, parseItalicCaption } from '../../lib/docs-images'
import { cn } from '../../lib/utils'

/**
 * Document-scale markdown renderer shared by the Knowledge page and the
 * public help center. Hand-rolled (no dependency), covering what docs
 * actually contain: headings, bold/italic (both * and _ styles), inline
 * code, fenced code, links, ordered/unordered lists, tables, blockquotes,
 * horizontal rules, and same-origin product-help screenshots. Safe by
 * construction: only text nodes and allowlisted image srcs, never raw HTML.
 */

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|(?<![\w\\])_[^_\s][^_]*_(?!\w))/g

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
    if (token.startsWith('**') || token.startsWith('__')) {
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
      const safe = /^(https?:\/\/|mailto:|\/)/i.test(href)
      if (safe) {
        const sameTab = href.startsWith('/docs') || href.startsWith('/learn')
        nodes.push(
          <a
            key={key++}
            href={href}
            {...(sameTab
              ? {}
              : { target: '_blank', rel: 'noreferrer noopener' })}
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

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-2 text-3xl font-semibold tracking-tight text-text-heading',
  2: 'mt-12 text-docs-h2 font-semibold tracking-tight text-text-heading',
  3: 'mt-8 text-xl font-semibold text-text-heading',
  4: 'mt-6 text-base font-semibold text-text-heading',
}

export default function MarkdownView({
  content,
  className,
}: {
  content: string
  className?: string
}) {
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
          className="overflow-x-auto rounded-lg border border-border/40 bg-bg-elevated px-3.5 py-2.5 font-mono text-xs leading-relaxed text-text-primary"
        >
          {code.join('\n')}
        </pre>,
      )
      continue
    }

    // Product-help screenshot: ![alt](/api/docs/assets/...) plus optional italic caption
    const image = parseImageLine(line)
    if (image) {
      i += 1
      let caption: string | null = null
      if (i < lines.length && lines[i].trim() === '' && i + 1 < lines.length) {
        caption = parseItalicCaption(lines[i + 1])
        if (caption) i += 2
      } else {
        caption = parseItalicCaption(lines[i])
        if (caption) i += 1
      }
      if (isDocsAssetSrc(image.src)) {
        blocks.push(
          <figure key={key++} className="space-y-2">
            <img
              src={image.src}
              alt={image.alt}
              className="max-h-[min(56vh,520px)] w-full rounded-lg border border-border/40 bg-bg-elevated object-contain object-top"
            />
            {caption ? (
              <figcaption className="text-xs leading-5 text-text-muted">{caption}</figcaption>
            ) : null}
          </figure>,
        )
      }
      continue
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-2 border-border/40" />)
      i += 1
      continue
    }

    // Headings. `{icon:name}` renders the same Lucide mark as the product.
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const iconMatch = headingMatch[2].match(/^\{icon:([a-z0-9-]+)\}\s*/)
      const iconName = iconMatch?.[1] ?? null
      const title = iconMatch ? headingMatch[2].slice(iconMatch[0].length) : headingMatch[2]
      const Icon = docsIcon(iconName)
      const iconClass =
        level <= 2 ? 'size-6 shrink-0 text-text-secondary' : 'size-5 shrink-0 text-text-secondary'
      blocks.push(
        <div
          key={key++}
          id={level === 2 || level === 3 ? headingId(headingMatch[2]) : undefined}
          className={`${HEADING_CLASS[level]} flex scroll-mt-24 items-center gap-2.5`}
        >
          {Icon ? <Icon className={iconClass} aria-hidden /> : null}
          <span>{renderInline(title)}</span>
        </div>,
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
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-bg-elevated">
                {header.map((cell, idx) => (
                  <th key={idx} className="px-3 py-2 text-left font-semibold text-text-heading">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b border-border/40 last:border-b-0">
                  {header.map((_, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 align-top text-text-primary">
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
        <blockquote key={key++} className="border-l-[3px] border-[var(--docs-accent,rgb(var(--color-accent)))] pl-4 text-docs-body leading-7 text-text-secondary italic">
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
        <ul key={key++} className="list-disc space-y-2.5 pl-5 text-docs-body leading-7 text-text-primary">
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
        <ol key={key++} className="list-decimal space-y-2.5 pl-5 text-docs-body leading-7 text-text-primary">
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
      !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|\s*>|\s*(-{3,}|\*{3,}|_{3,})\s*$|!\[[^\]]*\]\()/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={key++} className="text-docs-body leading-7 text-text-primary/90">
        {renderInline(para.join(' '))}
      </p>,
    )
  }

  return <div className={cn('space-y-5', className)}>{blocks}</div>
}
