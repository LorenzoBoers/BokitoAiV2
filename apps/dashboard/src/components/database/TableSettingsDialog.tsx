import { useState, useEffect } from 'react'
import { X, Settings, Wand2, RefreshCw, Trash2, Database } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { CustomTable, MagicTableConfig } from '../../types/custom-db'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import MagicTableSyncStatus from './MagicTableSyncStatus'

interface TableSettingsDialogProps {
  table: CustomTable
  onClose: () => void
}

export default function TableSettingsDialog({ table, onClose }: TableSettingsDialogProps) {
  const { fields, updateMagicTableConfig, syncMagicTable } = useDatabase()
  const [magicTableEnabled, setMagicTableEnabled] = useState(table.magic_table_config?.enabled || false)
  const [selectedFields, setSelectedFields] = useState<string[]>(table.magic_table_config?.indexed_fields || [])
  const [saving, setSaving] = useState(false)

  // Filter text fields that can be indexed
  const indexableFields = fields.filter(field => 
    field.field_type === 'text' || 
    field.field_type === 'email' || 
    field.field_type === 'url'
  )

  const handleToggleMagicTable = async (enabled: boolean) => {
    setSaving(true)
    try {
      const config: Partial<MagicTableConfig> = {
        enabled,
        indexed_fields: enabled ? selectedFields : [],
        sync_status: enabled ? { state: 'stale', records_not_indexed: 0 } : { state: 'stale' }
      }
      await updateMagicTableConfig(table.id, config)
      setMagicTableEnabled(enabled)
      
      // Auto-sync if enabling and fields are selected
      if (enabled && selectedFields.length > 0) {
        setTimeout(() => {
          syncMagicTable(table.id)
        }, 500)
      }
    } catch (error) {
      console.error('Failed to update magic table config:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleFieldToggle = async (fieldSlug: string) => {
    const newSelectedFields = selectedFields.includes(fieldSlug)
      ? selectedFields.filter(f => f !== fieldSlug)
      : [...selectedFields, fieldSlug]
    
    setSelectedFields(newSelectedFields)
    
    if (magicTableEnabled) {
      setSaving(true)
      try {
        await updateMagicTableConfig(table.id, {
          indexed_fields: newSelectedFields,
          sync_status: { state: 'stale', records_not_indexed: 0 }
        })
      } catch (error) {
        console.error('Failed to update indexed fields:', error)
      } finally {
        setSaving(false)
      }
    }
  }

  const handleManualSync = () => {
    if (magicTableEnabled && selectedFields.length > 0) {
      syncMagicTable(table.id)
    }
  }

  const handleRebuildIndex = async () => {
    if (!magicTableEnabled) return
    
    setSaving(true)
    try {
      await updateMagicTableConfig(table.id, {
        sync_status: { state: 'syncing', records_indexing: 0 },
        indexed_record_count: 0
      })
      
      // Simulate rebuild
      setTimeout(() => {
        syncMagicTable(table.id)
      }, 1000)
    } catch (error) {
      console.error('Failed to rebuild index:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleClearIndex = async () => {
    if (!magicTableEnabled) return
    
    setSaving(true)
    try {
      await updateMagicTableConfig(table.id, {
        sync_status: { state: 'stale', records_not_indexed: 0 },
        indexed_record_count: 0,
        estimated_size: '0KB'
      })
    } catch (error) {
      console.error('Failed to clear index:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-text-muted" />
            <CardTitle>Tabel instellingen</CardTitle>
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
          {/* Basic table info */}
          <div>
            <h3 className="text-sm font-medium text-text-heading mb-2">Algemeen</h3>
            <div className="text-sm text-text-secondary">
              <p><span className="font-medium">Naam:</span> {table.name}</p>
              <p><span className="font-medium">Description:</span> {table.description || 'No description'}</p>
              <p><span className="font-medium">Aangemaakt:</span> {new Date(table.created_at).toLocaleDateString('nl-NL')}</p>
            </div>
          </div>

          {/* Magic Table Section */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Wand2 size={18} className="text-purple-500" />
              <h3 className="text-sm font-medium text-text-heading">Magic Table</h3>
            </div>
            
            <div className="space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">AI-indexering inschakelen</p>
                  <p className="text-xs text-text-muted">
                    Schakel semantisch zoeken en AI-functies in voor deze tabel
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleMagicTable(!magicTableEnabled)}
                  disabled={saving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    magicTableEnabled ? 'bg-purple-500' : 'bg-bg-muted'
                  } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      magicTableEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Field selector */}
              {magicTableEnabled && (
                <div>
                  <p className="text-sm font-medium text-text-primary mb-2">Te indexeren velden</p>
                  <p className="text-xs text-text-muted mb-3">
                    Selecteer welke tekstvelden geïndexeerd moeten worden voor semantisch zoeken
                  </p>
                  
                  {indexableFields.length === 0 ? (
                    <div className="text-xs text-text-muted p-3 bg-bg-muted rounded-md">
                      No text fields available to index
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {indexableFields.map((field) => (
                        <label
                          key={field.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedFields.includes(field.slug)}
                            onChange={() => handleFieldToggle(field.slug)}
                            className="rounded border-border text-purple-500 focus:ring-purple-500"
                          />
                          <span className="text-text-primary">{field.name}</span>
                          <span className="text-xs text-text-muted">({field.field_type})</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Sync status */}
              {magicTableEnabled && (
                <div>
                  <MagicTableSyncStatus 
                    table={table} 
                    onManualSync={handleManualSync}
                  />
                </div>
              )}

              {/* Index Management */}
              {magicTableEnabled && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-medium text-text-heading mb-3">Index beheer</h4>
                  
                  <div className="space-y-3">
                    <div className="text-xs text-text-secondary space-y-1">
                      <p>
                        <span className="font-medium">Geïndexeerde records:</span>{' '}
                        {table.magic_table_config?.indexed_record_count || 0}
                      </p>
                      <p>
                        <span className="font-medium">Laatste sync:</span>{' '}
                        {table.magic_table_config?.last_sync_at 
                          ? new Date(table.magic_table_config.last_sync_at).toLocaleString('nl-NL')
                          : 'Nog niet gesynchroniseerd'
                        }
                      </p>
                      <p>
                        <span className="font-medium">Geschatte grootte:</span>{' '}
                        {table.magic_table_config?.estimated_size || '0KB'}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRebuildIndex}
                        disabled={saving || selectedFields.length === 0}
                        className="text-xs"
                      >
                        <RefreshCw size={12} className="mr-1" />
                        Index opnieuw opbouwen
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearIndex}
                        disabled={saving}
                        className="text-xs text-status-error hover:text-status-error"
                      >
                        <Trash2 size={12} className="mr-1" />
                        Index wissen
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}