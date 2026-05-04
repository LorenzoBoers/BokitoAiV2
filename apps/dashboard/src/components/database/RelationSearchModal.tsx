import { useState, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import type { CustomField, CustomTable, CustomRecord } from '../../types/custom-db'
import * as api from '../../lib/custom-db-api'

interface RelationSearchModalProps {
  field: CustomField
  relatedTable: CustomTable
  value: unknown
  onSelect: (recordId: number | number[]) => void
  onClose: () => void
}

export default function RelationSearchModal({
  field,
  relatedTable,
  value,
  onSelect,
  onClose,
}: RelationSearchModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [records, setRecords] = useState<CustomRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    if (field.config.relationType === 'many_to_many') {
      return Array.isArray(value) ? value.map(Number) : []
    } else {
      return value ? [Number(value)] : []
    }
  })

  const isMultiSelect = field.config.relationType === 'many_to_many'
  const displayField = field.config.displayField || 'name'

  useEffect(() => {
    loadRecords()
  }, [relatedTable.id])

  const loadRecords = async () => {
    setLoading(true)
    try {
      const result = await api.listRecords(relatedTable.id, 1, 100)
      const recordList = Array.isArray(result) ? result : result.items
      setRecords(recordList)
    } catch (error) {
      console.error('Failed to load records:', error)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  const filteredRecords = useMemo(() => {
    if (!searchTerm) return records
    
    return records.filter(record => {
      const displayValue = record.data[displayField]
      return String(displayValue || '').toLowerCase().includes(searchTerm.toLowerCase())
    })
  }, [records, searchTerm, displayField])

  const handleRecordClick = (recordId: number) => {
    if (isMultiSelect) {
      setSelectedIds(prev => 
        prev.includes(recordId) 
          ? prev.filter(id => id !== recordId)
          : [...prev, recordId]
      )
    } else {
      setSelectedIds([recordId])
    }
  }

  const handleConfirm = () => {
    if (isMultiSelect) {
      onSelect(selectedIds)
    } else {
      onSelect(selectedIds[0] ?? 0)
    }
  }

  const getRecordDisplay = (record: CustomRecord): string => {
    const displayValue = record.data[displayField]
    return String(displayValue || `Record #${record.id}`)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[80vh] flex flex-col">
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              {isMultiSelect ? 'Selecteer records' : 'Selecteer record'} - {relatedTable.name}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-text-muted" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Zoeken..."
              className="pl-8 text-xs"
            />
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto space-y-1">
            {loading ? (
              <div className="text-center py-8 text-text-muted text-xs">
                Records laden...
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-xs">
                {searchTerm ? 'Geen records gevonden' : 'Geen records beschikbaar'}
              </div>
            ) : (
              filteredRecords.map((record) => (
                <div
                  key={record.id}
                  onClick={() => handleRecordClick(record.id)}
                  className={`p-2 rounded-md border cursor-pointer transition-colors text-xs ${
                    selectedIds.includes(record.id)
                      ? 'border-accent bg-accent/8 text-accent'
                      : 'border-border hover:border-border-hover hover:bg-bg-hover'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isMultiSelect && (
                      <div className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${
                        selectedIds.includes(record.id) 
                          ? 'bg-accent border-accent text-white' 
                          : 'border-border'
                      }`}>
                        {selectedIds.includes(record.id) && '✓'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{getRecordDisplay(record)}</div>
                      <div className="text-text-muted text-[10px]">ID: {record.id}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="flex-shrink-0 flex justify-end gap-2 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Annuleren
            </Button>
            <Button 
              size="sm" 
              onClick={handleConfirm}
              disabled={selectedIds.length === 0}
            >
              {isMultiSelect 
                ? `${selectedIds.length} selecteren`
                : 'Selecteren'
              }
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}