import { useState } from 'react'
import { AlertTriangle, X, Eye } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { DuplicateDetection } from '../../types/custom-db'
import { Button } from '../ui/button'

interface DuplicateDetectionBannerProps {
  duplicates: DuplicateDetection[]
  onDismiss: (duplicateId: number) => void
  onView: (duplicateId: number) => void
  onDismissAll: () => void
}

export default function DuplicateDetectionBanner({ 
  duplicates, 
  onDismiss, 
  onView, 
  onDismissAll 
}: DuplicateDetectionBannerProps) {
  const [dismissing, setDismissing] = useState<Set<number>>(new Set())

  if (duplicates.length === 0) return null

  const handleDismiss = async (duplicateId: number) => {
    setDismissing(prev => new Set(prev).add(duplicateId))
    try {
      await onDismiss(duplicateId)
    } finally {
      setDismissing(prev => {
        const newSet = new Set(prev)
        newSet.delete(duplicateId)
        return newSet
      })
    }
  }

  return (
    <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-md">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-medium text-amber-800 mb-2">
            Mogelijke duplicaten gevonden
          </h3>
          <p className="text-sm text-amber-700 mb-3">
            We hebben {duplicates.length} record{duplicates.length > 1 ? 's' : ''} gevonden die mogelijk duplicaten zijn:
          </p>
          
          <div className="space-y-2">
            {duplicates.map((duplicate) => (
              <div 
                key={duplicate.possible_duplicate_id}
                className="flex items-center justify-between p-2 bg-white rounded border border-amber-200"
              >
                <div className="flex-1">
                  <span className="text-sm font-medium text-text-primary">
                    {duplicate.possible_duplicate_name}
                  </span>
                  <span className="ml-2 text-xs text-text-muted">
                    ({Math.round(duplicate.similarity_score * 100)}% gelijkenis)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onView(duplicate.possible_duplicate_id)}
                    className="text-xs h-7"
                  >
                    <Eye size={12} className="mr-1" />
                    Bekijk
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDismiss(duplicate.possible_duplicate_id)}
                    disabled={dismissing.has(duplicate.possible_duplicate_id)}
                    className="p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded transition-colors disabled:opacity-50"
                    title="Negeren"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismissAll}
              className="text-xs text-amber-700 hover:text-amber-800"
            >
              Alle negeren
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}