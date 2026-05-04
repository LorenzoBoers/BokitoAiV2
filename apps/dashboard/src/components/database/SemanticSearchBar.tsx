import { useState, useCallback, useRef, useEffect } from 'react'
import { Search, Sparkles, X, Loader2 } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { SemanticSearchResult } from '../../types/custom-db'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'

interface SemanticSearchBarProps {
  onResults: (results: SemanticSearchResult[]) => void
  onClear: () => void
}

export default function SemanticSearchBar({ onResults, onClear }: SemanticSearchBarProps) {
  const { activeTable, searchSemantic } = useDatabase()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [focused, setFocused] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout>()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!activeTable || !searchQuery.trim()) {
      onClear()
      return
    }

    setSearching(true)
    try {
      const results = await searchSemantic(activeTable.id, searchQuery.trim())
      onResults(results)
    } catch (error) {
      console.error('Semantic search failed:', error)
      onResults([])
    } finally {
      setSearching(false)
    }
  }, [activeTable, searchSemantic, onResults, onClear])

  const handleInputChange = (value: string) => {
    setQuery(value)
    
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(value)
    }, 300)
  }

  const handleClear = () => {
    setQuery('')
    onClear()
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClear()
      inputRef.current?.blur()
    }
  }

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  return (
    <div className="relative flex-1 max-w-md">
      <div className={`relative flex items-center transition-all ${
        focused ? 'ring-1 ring-purple-500/50' : ''
      }`}>
        <div className="absolute left-3 flex items-center gap-1">
          <Sparkles size={14} className="text-purple-500" />
          {searching && <Loader2 size={12} className="animate-spin text-purple-500" />}
        </div>
        
        <Input
          ref={inputRef}
          type="text"
          placeholder="Semantisch zoeken..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          className="pl-9 pr-8 text-sm bg-bg-elevated border-border focus:border-purple-500 focus:ring-purple-500/20"
        />
        
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {query && (
        <div className="absolute top-full left-0 right-0 mt-1 z-10">
          <div className="bg-bg-elevated border border-border rounded-md shadow-lg p-2">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Sparkles size={12} className="text-purple-500" />
              <span>AI-zoekresultaten worden getoond in de tabel</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}