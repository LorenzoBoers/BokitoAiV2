import { useNavigate } from 'react-router-dom'
import { isAppPath } from './ChatMarkdown'

/** Lightweight markdown rendering for assistant and chat messages. */
export default function MessageMarkdown({ text }: { text: string }) {
  const navigate = useNavigate()
  const html = formatMarkdown(text)
  return (
    <div
      className={
        'text-xs text-text-primary leading-relaxed whitespace-pre-wrap break-words ' +
        '[&_a]:text-accent [&_a:not(.md-app-link)]:underline ' +
        '[&_code]:rounded [&_code]:bg-bg-elevated [&_code]:px-1 [&_strong]:font-semibold'
      }
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest('a[data-app-link]')
        if (!(anchor instanceof HTMLAnchorElement)) return
        const href = anchor.getAttribute('href')
        if (!href || !isAppPath(href)) return
        e.preventDefault()
        navigate(href)
      }}
    />
  )
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatMarkdown(text: string): string {
  let out = escapeHtml(text)
  // Mentions first: their `@[Name](user:id)` markup would otherwise be
  // swallowed by the generic link rule below.
  out = out.replace(
    /@\[([^\]]+)\]\((user|agent):([^)]+)\)/g,
    (_, name: string, type: string) =>
      `<span class="mention-chip" data-mention-type="${type}">@${name}</span>`,
  )
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  // Label/href are already HTML-escaped from the full-string pass above.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    if (isAppPath(href)) {
      return (
        `<a href="${href}" data-app-link="1" class="md-app-link inline-flex ` +
        `items-center gap-1 rounded-md border border-border/55 bg-bg-elevated ` +
        `px-1.5 py-0.5 align-baseline text-[12px] font-medium text-accent no-underline ` +
        `transition-colors hover:border-accent/45 hover:bg-bg-hover/70">${label}</a>`
      )
    }
    if (/^(https?:\/\/|mailto:)/i.test(href)) {
      return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
    }
    return label
  })
  return out
}
