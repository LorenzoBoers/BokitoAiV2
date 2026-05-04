import { Star, ExternalLink, FileText, Paperclip, Search } from 'lucide-react'
import type { CustomField } from '../../../types/custom-db'

export default function CellRenderer({ field, value }: { field: CustomField; value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-text-muted/40">—</span>
  }

  switch (field.field_type) {
    case 'text':
    case 'phone':
      return <span className="truncate">{String(value)}</span>

    case 'long_text':
      const text = String(value)
      const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text
      return (
        <div className="flex items-center gap-1">
          <FileText size={12} className="text-text-muted flex-shrink-0" />
          <span className="truncate text-xs">{preview}</span>
        </div>
      )

    case 'number':
      return <span className="tabular-nums">{Number(value).toLocaleString('nl-NL', { maximumFractionDigits: field.config?.decimals ?? 0 })}</span>

    case 'boolean':
      return (
        <span className="inline-flex items-center justify-center w-full">
          <input
            type="checkbox"
            checked={Boolean(value)}
            readOnly
            tabIndex={-1}
            className="h-4 w-4 rounded-sm border-border accent-status-success"
            aria-label="Boolean waarde"
          />
        </span>
      )

    case 'date':
      return (
        <span className="tabular-nums">
          {formatDate(String(value), field.config?.includeTime)}
        </span>
      )

    case 'email':
      return (
        <a href={`mailto:${value}`} className="text-accent hover:underline truncate" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      )

    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}
          <ExternalLink size={10} />
        </a>
      )

    case 'select': {
      const opt = field.config?.options?.find((o) => o.value === value)
      if (!opt) return <span className="truncate">{String(value)}</span>
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{ backgroundColor: `${opt.color}20`, color: opt.color }}
        >
          {opt.label}
        </span>
      )
    }

    case 'multi_select': {
      const vals = Array.isArray(value) ? value : [value]
      return (
        <div className="flex flex-wrap gap-1">
          {vals.map((v, i) => {
            const opt = field.config?.options?.find((o) => o.value === v)
            return (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                style={opt ? { backgroundColor: `${opt.color}20`, color: opt.color } : undefined}
              >
                {opt?.label ?? String(v)}
              </span>
            )
          })}
        </div>
      )
    }

    case 'currency': {
      const sym = field.config?.symbol ?? 'EUR'
      const dec = field.config?.decimals ?? 2
      return (
        <span className="tabular-nums">
          {sym === 'EUR' ? '€' : sym === 'USD' ? '$' : sym === 'GBP' ? '£' : sym}{' '}
          {Number(value).toLocaleString('nl-NL', { minimumFractionDigits: dec, maximumFractionDigits: dec })}
        </span>
      )
    }

    case 'rating': {
      const max = field.config?.max ?? 5
      const rating = Number(value)
      return (
        <div className="flex gap-0.5">
          {Array.from({ length: max }, (_, i) => (
            <Star key={i} size={12} className={i < rating ? 'text-amber-400 fill-amber-400' : 'text-text-muted/30'} />
          ))}
        </div>
      )
    }

    case 'attachment': {
      const files = Array.isArray(value) ? value : [value].filter(Boolean)
      if (files.length === 0) return <span className="text-text-muted/40">—</span>
      
      return (
        <div className="flex items-center gap-1">
          <Paperclip size={12} className="text-text-muted flex-shrink-0" />
          <span className="text-xs text-accent">
            {files.length === 1 ? String(files[0]).split('/').pop() : `${files.length} bestanden`}
          </span>
        </div>
      )
    }

    case 'relation':
      return <span className="text-accent text-xs">#{String(value)}</span>

    case 'lookup':
      return (
        <div className="flex items-center gap-1">
          <Search size={12} className="text-text-muted flex-shrink-0" />
          <span className="text-xs text-text-muted italic truncate">{String(value)}</span>
        </div>
      )

    case 'formula':
      return <span className="text-text-muted italic truncate">{String(value)}</span>

    default:
      return <span className="truncate">{String(value)}</span>
  }
}

function formatDate(value: string, includeTime?: boolean): string {
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }
  if (includeTime) { opts.hour = '2-digit'; opts.minute = '2-digit' }
  return d.toLocaleDateString('nl-NL', opts)
}
