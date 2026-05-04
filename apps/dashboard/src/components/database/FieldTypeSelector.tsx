import {
  Type, Hash, CheckSquare, Calendar, Clock, Mail, Link, Phone, List,
  ListChecks, Paperclip, DollarSign, Star, Link2, Calculator,
  AlignLeft, Braces, Search, File,
} from 'lucide-react'
import { FIELD_TYPES, FIELD_TYPE_META, type FieldType } from '../../types/custom-db'

const ICON_MAP: Record<string, React.ElementType> = {
  Type, Hash, CheckSquare, Calendar, Clock, Mail, Link, Phone, List,
  ListChecks, Paperclip, DollarSign, Star, Link2, Calculator,
  AlignLeft, Braces, Search, File,
}

export default function FieldTypeSelector({
  value,
  onChange,
}: {
  value?: FieldType
  onChange: (type: FieldType) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {FIELD_TYPES.map((ft) => {
        const meta = FIELD_TYPE_META[ft]
        if (!meta) return null
        const Icon = ICON_MAP[meta.icon] ?? Type
        const selected = value === ft
        return (
          <button
            key={ft}
            type="button"
            onClick={() => onChange(ft)}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
              selected
                ? 'border-accent bg-accent/8 text-accent'
                : 'border-border bg-bg-primary hover:border-border-hover hover:bg-bg-hover text-text-secondary'
            }`}
          >
            <Icon size={14} className="flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-medium truncate">{meta.label}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
