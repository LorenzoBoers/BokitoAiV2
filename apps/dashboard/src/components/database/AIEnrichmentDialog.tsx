import { useState, useEffect } from 'react'
import { X, Sparkles, Loader2, Check, AlertCircle } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { CustomRecord, AIEnrichmentSuggestion } from '../../types/custom-db'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'

interface AIEnrichmentDialogProps {
  record: CustomRecord
  onClose: () => void
  onSave: (recordId: number, data: Record<string, unknown>) => void
}

export default function AIEnrichmentDialog({ record, onClose, onSave }: AIEnrichmentDialogProps) {
  const { fields, enrichRecordWithAI } = useDatabase()
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<AIEnrichmentSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set())

  // Filter fields that can be enriched (text, select, number, rating)
  const enrichableFields = fields.filter(field => 
    ['text', 'select', 'number', 'rating'].includes(field.field_type) &&
    !record.data[field.slug] // Only show empty fields
  )

  const handleFieldToggle = (fieldSlug: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldSlug) 
        ? prev.filter(f => f !== fieldSlug)
        : [...prev, fieldSlug]
    )
  }

  const handleEnrich = async () => {
    if (selectedFields.length === 0) return

    setLoading(true)
    try {
      const enrichmentSuggestions = await enrichRecordWithAI(record.id, selectedFields)
      setSuggestions(enrichmentSuggestions)
    } catch (error) {
      console.error('AI enrichment failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleSuggestionAcceptance = (fieldSlug: string) => {
    setAcceptedSuggestions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(fieldSlug)) {
        newSet.delete(fieldSlug)
      } else {
        newSet.add(fieldSlug)
      }
      return newSet
    })
  }

  const handleSave = async () => {
    const acceptedData: Record<string, unknown> = {}
    
    suggestions.forEach(suggestion => {
      if (acceptedSuggestions.has(suggestion.field_slug)) {
        acceptedData[suggestion.field_slug] = suggestion.suggested_value
      }
    })

    if (Object.keys(acceptedData).length === 0) {
      onClose()
      return
    }

    setSaving(true)
    try {
      await onSave(record.id, acceptedData)
      onClose()
    } catch (error) {
      console.error('Failed to save enriched data:', error)
    } finally {
      setSaving(false)
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50'
    if (confidence >= 0.6) return 'text-amber-600 bg-amber-50'
    return 'text-red-600 bg-red-50'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'Hoog'
    if (confidence >= 0.6) return 'Gemiddeld'
    return 'Laag'
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            <CardTitle>AI Record Verrijking</CardTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Field Selection */}
          {suggestions.length === 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-heading mb-3">
                Selecteer velden om te verrijken
              </h3>
              <p className="text-xs text-text-muted mb-4">
                Kies welke lege velden je wilt laten invullen door AI op basis van de bestaande data in dit record.
              </p>
              
              {enrichableFields.length === 0 ? (
                <div className="text-sm text-text-muted p-4 bg-bg-muted rounded-md">
                  No empty fields available to enrich
                </div>
              ) : (
                <div className="space-y-2">
                  {enrichableFields.map((field) => (
                    <label
                      key={field.id}
                      className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-bg-hover cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFields.includes(field.slug)}
                        onChange={() => handleFieldToggle(field.slug)}
                        className="rounded border-border text-purple-500 focus:ring-purple-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">{field.name}</span>
                          <Badge variant="secondary" className="text-xs">
                            {field.field_type}
                          </Badge>
                        </div>
                        {field.field_type === 'select' && field.config.options && (
                          <div className="text-xs text-text-muted mt-1">
                            Opties: {field.config.options.map(opt => opt.label).join(', ')}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" onClick={onClose}>
                  Annuleren
                </Button>
                <Button 
                  onClick={handleEnrich}
                  disabled={selectedFields.length === 0 || loading}
                  className="bg-purple-500 hover:bg-purple-600"
                >
                  {loading && <Loader2 size={14} className="animate-spin mr-2" />}
                  <Sparkles size={14} className="mr-2" />
                  Verrijk met AI
                </Button>
              </div>
            </div>
          )}

          {/* Suggestions Preview */}
          {suggestions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-heading mb-3">
                AI Suggesties
              </h3>
              <p className="text-xs text-text-muted mb-4">
                Bekijk de AI-gegenereerde suggesties en selecteer welke je wilt toepassen.
              </p>

              <div className="space-y-3">
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.field_slug}
                    className={`p-4 rounded-md border transition-colors ${
                      acceptedSuggestions.has(suggestion.field_slug)
                        ? 'border-purple-200 bg-purple-50'
                        : 'border-border bg-bg-elevated'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={acceptedSuggestions.has(suggestion.field_slug)}
                        onChange={() => toggleSuggestionAcceptance(suggestion.field_slug)}
                        className="mt-1 rounded border-border text-purple-500 focus:ring-purple-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-text-primary">
                            {suggestion.field_name}
                          </span>
                          <Badge 
                            className={`text-xs ${getConfidenceColor(suggestion.confidence)}`}
                          >
                            {getConfidenceLabel(suggestion.confidence)} ({Math.round(suggestion.confidence * 100)}%)
                          </Badge>
                        </div>
                        <div className="text-sm text-text-secondary">
                          <span className="font-medium">Suggestie:</span> {String(suggestion.suggested_value)}
                        </div>
                        {suggestion.confidence < 0.6 && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                            <AlertCircle size={12} />
                            <span>Lage betrouwbaarheid - controleer voor gebruik</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-4">
                <div className="text-xs text-text-muted">
                  {acceptedSuggestions.size} van {suggestions.length} suggesties geselecteerd
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={onClose}>
                    Annuleren
                  </Button>
                  <Button 
                    onClick={handleSave}
                    disabled={saving || acceptedSuggestions.size === 0}
                    className="bg-purple-500 hover:bg-purple-600"
                  >
                    {saving && <Loader2 size={14} className="animate-spin mr-2" />}
                    <Check size={14} className="mr-2" />
                    Toepassen ({acceptedSuggestions.size})
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}