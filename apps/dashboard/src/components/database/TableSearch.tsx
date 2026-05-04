import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import type { CustomRecord, CustomField } from '../../types/custom-db'

interface TableSearchProps {
  records: CustomRecord[]
  fields: CustomField[]
  onClose: () => void
  onHighlight: (matches: SearchMatch[]) => void
}

interface SearchMatch {
  recordId: number
  fieldSlug: string
  text: string
  startIndex: number
  endIndex: number
}

export default function TableSearch({ records, fields, onClose, onHighlight }: TableSearchProps) {
  const [query, setQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          navigateToPrevious()
        } else {
          navigateToNext()
        }
      } else if (e.key === 'F3') {
        e.preventDefault()
        if (e.shiftKey) {
          navigateToPrevious()
        } else {
          navigateToNext()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [matches, currentMatchIndex])

  // Search function
  const performSearch = useCallback((searchQuery: string) => {
    if (!searchQuery.trim()) {
      setMatches([])
      onHighlight([])
      return
    }

    const searchableFields = fields.filter(f => 
      f.field_type === 'text' || 
      f.field_type === 'email' || 
      f.field_type === 'url' || 
      f.field_type === 'phone'
    )

    const foundMatches: SearchMatch[] = []
    const lowerQuery = searchQuery.toLowerCase()

    records.forEach(record => {
      searchableFields.forEach(field => {
        const value = record.data[field.slug]
        if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
          const text = value
          const lowerText = text.toLowerCase()
          let startIndex = 0

          while (true) {
            const index = lowerText.indexOf(lowerQuery, startIndex)
            if (index === -1) break

            foundMatches.push({
              recordId: record.id,
              fieldSlug: field.slug,
              text,
              startIndex: index,
              endIndex: index + lowerQuery.length,
            })

            startIndex = index + 1
          }
        }
      })
    })

    setMatches(foundMatches)
    setCurrentMatchIndex(0)
    onHighlight(foundMatches)
  }, [records, fields, onHighlight])

  // Update search when query changes
  useEffect(() => {
    performSearch(query)
  }, [query, performSearch])

  const navigateToNext = () => {
    if (matches.length === 0) return
    const nextIndex = (currentMatchIndex + 1) % matches.length
    setCurrentMatchIndex(nextIndex)
    scrollToMatch(matches[nextIndex])
  }

  const navigateToPrevious = () => {
    if (matches.length === 0) return
    const prevIndex = currentMatchIndex === 0 ? matches.length - 1 : currentMatchIndex - 1
    setCurrentMatchIndex(prevIndex)
    scrollToMatch(matches[prevIndex])
  }

  const scrollToMatch = (match: SearchMatch) => {
    // Find the cell element and scroll to it
    const cellSelector = `[data-record-id="${match.recordId}"][data-field-slug="${match.fieldSlug}"]`
    const cellElement = document.querySelector(cellSelector)
    
    if (cellElement) {
      cellElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      })
    }
  }

  return (
    <div className="fixed top-4 right-4 z-50 bg-bg-primary border border-border rounded-lg shadow-lg p-3 min-w-[300px]">
      <div className="flex items-center gap-2 mb-2">
        <Search size={16} className="text-text-muted" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek in tabel..."
          className="flex-1 h-8 text-sm"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-8 w-8 p-0"
        >
          <X size={14} />
        </Button>
      </div>

      {query && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {matches.length === 0 
              ? 'Geen resultaten' 
              : `${currentMatchIndex + 1} van ${matches.length}`
            }
          </span>
          
          {matches.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={navigateToPrevious}
                className="h-6 w-6 p-0"
                title="Vorige (Shift+Enter)"
              >
                <ChevronUp size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={navigateToNext}
                className="h-6 w-6 p-0"
                title="Volgende (Enter)"
              >
                <ChevronDown size={12} />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}