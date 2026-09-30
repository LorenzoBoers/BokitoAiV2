import { marked } from 'marked'
import { useMemo } from 'react'

import { cn } from '@/lib/cn'

marked.setOptions({ gfm: true, breaks: true })

function sanitize(html: string): string {
  // Minimal: strip scripts, event handlers and javascript: URLs. Bodies come from
  // our own API (agents, colleagues, customers) and are rendered in the operator UI.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/href="javascript:[^"]*"/gi, 'href="#"')
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => sanitize(marked.parse(text ?? '', { async: false }) as string), [text])
  return <div className={cn('prose-bokito text-sm', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
