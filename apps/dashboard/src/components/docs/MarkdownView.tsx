/** Minimal markdown renderer: headings, lists, code fences, inline bold/italic/code.
 * Shared by the knowledge editor preview and the public help center. */

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function MarkdownView({ content }: { content: string }) {
  const blocks: React.ReactNode[] = []
  const lines = content.split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {code.join('\n')}
        </pre>,
      )
      continue
    }
    if (/^#{1,4}\s/.test(line)) {
      const level = (line.match(/^#+/) as RegExpMatchArray)[0].length
      const text = line.replace(/^#+\s*/, '')
      const cls =
        level === 1
          ? 'text-xl font-semibold tracking-tight'
          : level === 2
            ? 'mt-2 text-lg font-semibold tracking-tight'
            : 'mt-1 text-base font-medium'
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(text)}
        </div>,
      )
      i += 1
      continue
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s/, ''))
        i += 1
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|\s*[-*]\s)/.test(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={key++} className="text-sm leading-6 text-foreground/90">
        {renderInline(para.join(' '))}
      </p>,
    )
  }
  return <div className="space-y-3">{blocks}</div>
}
