/** Lightweight markdown rendering for assistant and chat messages. */
export default function MessageMarkdown({ text }: { text: string }) {
  const html = formatMarkdown(text)
  return (
    <div
      className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap break-words [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-bg-elevated [&_code]:px-1 [&_strong]:font-semibold"
      dangerouslySetInnerHTML={{ __html: html }}
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
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return out
}
