import {
  Fragment,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Plus, Trash2, Loader2, Settings, X, Sparkles, ChevronRight, ChevronDown } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import ConfirmDeleteDialog from '../ui/ConfirmDeleteDialog'
import CellRenderer from './cells/CellRenderer'
import CellEditor from './cells/CellEditor'
import FieldConfigPanel from './FieldConfigPanel'
import AIEnrichmentDialog from './AIEnrichmentDialog'
import DuplicateDetectionBanner from './DuplicateDetectionBanner'
import type { CustomField, FieldConfig, GridViewConfig, SemanticSearchResult, CustomRecord, DuplicateDetection } from '../../types/custom-db'

const SELECT_COL_WIDTH = 36
const INDEX_COL_WIDTH = 40
const ACTION_COL_WIDTH = 40
const FILLER_COL_MIN_WIDTH = 0
const MIN_DATA_COL_WIDTH = 100
const MAX_DATA_COL_WIDTH = 5000

const ROW_HEIGHTS: Record<'compact' | 'standard' | 'tall', number> = {
  compact: 28,
  standard: 36,
  tall: 44,
}

export default function GridView({ semanticSearchResults }: { semanticSearchResults?: SemanticSearchResult[] }) {
  const {
    fields,
    records,
    filteredRecords,
    groupedRecords,
    recordsLoading,
    recordsPaging,
    loadRecordsPage,
    addRecord,
    editRecord,
    removeRecord,
    editField,
    removeField,
    activeView,
    editView,
    activeTable,
    checkForDuplicates,
    suppressDuplicate,
  } = useDatabase()

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const isTrashMode = false

  const gridConfig = activeView?.view_type === 'grid' ? (activeView.config as GridViewConfig) : {}
  const hiddenFields = gridConfig.hiddenFields ?? []
  const visibleFields = fields.filter((field) => !hiddenFields.includes(field.slug))
  const currentRowHeight = gridConfig.rowHeight ?? 'standard'

  const displayRecords = useMemo((): CustomRecord[] => {
    if (semanticSearchResults?.length) {
      const byId = new Map(records.map((r) => [r.id, r]))
      return semanticSearchResults.map((s) => {
        const full = byId.get(s.record_id)
        if (full) return full
        return {
          id: s.record_id,
          custom_table_id: activeTable?.id ?? 0,
          data: {},
          is_deleted: false,
          deleted_at: null,
          created_at: '',
          updated_at: '',
        }
      })
    }
    return records
  }, [semanticSearchResults, records, activeTable?.id])

  const [editingCell, setEditingCell] = useState<{ recordId: number; fieldSlug: string } | null>(null)
  const [addingRow, setAddingRow] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [draftRow, setDraftRow] = useState<Record<string, unknown>>({})
  const [selectedRecordIds, setSelectedRecordIds] = useState<number[]>([])
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [settingsField, setSettingsField] = useState<CustomField | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<CustomRecord | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; record: CustomRecord } | null>(null)
  const [enrichmentRecord, setEnrichmentRecord] = useState<CustomRecord | null>(null)
  const [duplicateDetections, setDuplicateDetections] = useState<DuplicateDetection[]>([])
  const [pendingRecord, setPendingRecord] = useState<Record<string, unknown> | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{ fieldSlug: string; startX: number; startWidth: number } | null>(null)
  const latestColumnWidthsRef = useRef<Record<string, number>>({})
  const saveTimeoutRef = useRef<number | null>(null)

  const handleCellSave = useCallback(async (recordId: number, fieldSlug: string, value: unknown) => {
    setEditingCell(null)
    try {
      await editRecord(recordId, { [fieldSlug]: value })
    } catch { /* ignore */ }
  }, [editRecord])

  const handleCellNavigate = useCallback(
    (recordId: number, fieldSlug: string, direction: 'up' | 'down' | 'left' | 'right') => {
      const rowIndex = displayRecords.findIndex((record) => record.id === recordId)
      const fieldIndex = fields.findIndex((field) => field.slug === fieldSlug)
      if (rowIndex < 0 || fieldIndex < 0) return

      let nextRow = rowIndex
      let nextField = fieldIndex
      if (direction === 'up') nextRow = Math.max(0, rowIndex - 1)
      if (direction === 'down') nextRow = Math.min(displayRecords.length - 1, rowIndex + 1)
      if (direction === 'left') nextField = Math.max(0, fieldIndex - 1)
      if (direction === 'right') nextField = Math.min(fields.length - 1, fieldIndex + 1)

      const nextRecord = displayRecords[nextRow]
      const nextFieldDef = fields[nextField]
      if (!nextRecord || !nextFieldDef) return
      setEditingCell({ recordId: nextRecord.id, fieldSlug: nextFieldDef.slug })
    },
    [displayRecords, fields],
  )

  const handleAddRow = useCallback(async () => {
    setAddingRow(true)
    try {
      const emptyData: Record<string, unknown> = {}
      fields.forEach((f) => {
        if (f.field_type === 'boolean') emptyData[f.slug] = false
        else if (f.field_type === 'number' || f.field_type === 'currency' || f.field_type === 'rating') emptyData[f.slug] = null
        else if (f.field_type === 'multi_select') emptyData[f.slug] = []
        else emptyData[f.slug] = ''
      })
      await addRecord(emptyData)
    } catch { /* ignore */ }
    setAddingRow(false)
  }, [fields, addRecord])

  const allSelected = useMemo(
    () => displayRecords.length > 0 && displayRecords.every((r) => selectedRecordIds.includes(r.id)),
    [displayRecords, selectedRecordIds],
  )

  const showRelevanceColumn = semanticSearchResults && semanticSearchResults.length > 0

  const toggleRecordSelected = (recordId: number) => {
    setSelectedRecordIds((prev) => (prev.includes(recordId) ? prev.filter((id) => id !== recordId) : [...prev, recordId]))
  }

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRecordIds([])
      setLastSelectedIndex(null)
      return
    }
    setSelectedRecordIds(displayRecords.map((r) => r.id))
  }

  const clearSelection = () => {
    setSelectedRecordIds([])
    setLastSelectedIndex(null)
  }

  const handleContextMenu = (e: ReactMouseEvent, record: CustomRecord) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      record
    })
  }

  const closeContextMenu = () => setContextMenu(null)

  const handleEnrichWithAI = (record: CustomRecord) => {
    setEnrichmentRecord(record)
    closeContextMenu()
  }

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = () => closeContextMenu()
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu])

  const handleDismissDuplicate = async (duplicateId: number) => {
    if (!activeTable || !pendingRecord) return
    
    // Create a mock record ID for the pending record
    const pendingRecordId = Date.now() // Mock ID
    await suppressDuplicate(activeTable.id, pendingRecordId, duplicateId)
    
    // Remove this duplicate from the list
    setDuplicateDetections(prev => prev.filter(d => d.possible_duplicate_id !== duplicateId))
  }

  const handleViewDuplicate = (duplicateId: number) => {
    // Find and select the duplicate record
    const duplicateRecord = displayRecords.find(r => r.id === duplicateId)
    if (duplicateRecord) {
      setSelectedRecordIds([duplicateId])
      // Scroll to the record (simplified)
      console.log('Viewing duplicate record:', duplicateId)
    }
  }

  const handleDismissAllDuplicates = async () => {
    if (!activeTable || !pendingRecord) return
    
    const pendingRecordId = Date.now() // Mock ID
    for (const duplicate of duplicateDetections) {
      await suppressDuplicate(activeTable.id, pendingRecordId, duplicate.possible_duplicate_id)
    }
    
    // Proceed with creating the record
    await proceedWithRecordCreation()
  }

  const proceedWithRecordCreation = async () => {
    if (!pendingRecord) return
    
    try {
      await addRecord(pendingRecord)
      setDraftRow({})
      setDuplicateDetections([])
      setPendingRecord(null)
    } catch {
      // ignore
    }
  }

  const handleDeleteSelected = useCallback(async () => {
    if (selectedRecordIds.length === 0) return
    setBulkDeleting(true)
    try {
      if (isTrashMode) {
        // Permanent delete in trash mode
        await Promise.all(selectedRecordIds.map((recordId) => removeRecord(recordId)))
      } else {
        // Soft delete in normal mode
        await Promise.all(selectedRecordIds.map((recordId) => removeRecord(recordId)))
      }
      clearSelection()
    } finally {
      setBulkDeleting(false)
    }
  }, [selectedRecordIds, removeRecord, isTrashMode])

  const handleRestoreSelected = useCallback(async () => {
    if (selectedRecordIds.length === 0 || !isTrashMode) return
    setBulkDeleting(true)
    try {
      // Use restore API (would need to implement this)
      await Promise.all(selectedRecordIds.map(async (recordId) => {
        // This would call api.restoreRecord(recordId)
        console.log('Restore record:', recordId)
      }))
      clearSelection()
    } finally {
      setBulkDeleting(false)
    }
  }, [selectedRecordIds, isTrashMode])

  const handleExportSelected = useCallback(() => {
    if (selectedRecordIds.length === 0) return
    
    const selectedRecords = records.filter(r => selectedRecordIds.includes(r.id))
    const csvData = selectedRecords.map(record => {
      const row: Record<string, unknown> = { id: record.id }
      fields.forEach(field => {
        row[field.name] = record.data[field.slug]
      })
      return row
    })
    
    // Simple CSV export
    const headers = ['ID', ...fields.map(f => f.name)]
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => 
        headers.map(header => {
          const value = row[header]
          return typeof value === 'string' && value.includes(',') 
            ? `"${value}"` 
            : String(value ?? '')
        }).join(',')
      )
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `records-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [selectedRecordIds, records, fields])

  const updateDraftCell = (fieldSlug: string, value: unknown) => {
    setDraftRow((prev) => ({ ...prev, [fieldSlug]: value }))
  }

  const areWidthMapsEqual = useCallback((a: Record<string, number>, b: Record<string, number>) => {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (a[key] !== b[key]) return false
    }
    return true
  }, [])

  const normalizeWidthMap = useCallback((value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object') return {}
    const result: Record<string, number> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const width = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(width)) continue
      result[key] = Math.max(MIN_DATA_COL_WIDTH, Math.min(MAX_DATA_COL_WIDTH, Math.round(width)))
    }
    return result
  }, [])

  const getServerColumnWidths = useCallback(() => {
    if (!activeView || activeView.view_type !== 'grid') return {}
    const gridConfig = (activeView.config ?? {}) as GridViewConfig
    return normalizeWidthMap(gridConfig.columnWidths)
  }, [activeView, normalizeWidthMap])

  const persistColumnWidths = useCallback(
    async (nextWidths: Record<string, number>) => {
      if (!activeView || activeView.view_type !== 'grid') return
      const normalized = normalizeWidthMap(nextWidths)
      const serverWidths = getServerColumnWidths()
      if (areWidthMapsEqual(normalized, serverWidths)) return
      try {
        await editView(activeView.id, {
          config: {
            ...(activeView.config ?? {}),
            columnWidths: normalized,
          },
        })
      } catch {
        // Keep local UI responsive even when saving fails.
      }
    },
    [activeView, editView, getServerColumnWidths, areWidthMapsEqual, normalizeWidthMap],
  )

  useEffect(() => {
    const serverWidths = getServerColumnWidths()
    setColumnWidths((prev) => (areWidthMapsEqual(prev, serverWidths) ? prev : serverWidths))
  }, [activeView, getServerColumnWidths, areWidthMapsEqual])

  useEffect(() => {
    latestColumnWidthsRef.current = columnWidths
  }, [columnWidths])

  const getColumnWidth = useCallback(
    (fieldSlug: string) => columnWidths[fieldSlug] ?? 180,
    [columnWidths],
  )

  const handleResizeStart = useCallback(
    (fieldSlug: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      resizeStateRef.current = {
        fieldSlug,
        startX: event.clientX,
        startWidth: getColumnWidth(fieldSlug),
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [getColumnWidth],
  )

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) return
      const delta = event.clientX - state.startX
      const nextWidth = Math.max(MIN_DATA_COL_WIDTH, Math.min(MAX_DATA_COL_WIDTH, state.startWidth + delta))
      setColumnWidths((prev) => {
        if (prev[state.fieldSlug] === nextWidth) return prev
        return { ...prev, [state.fieldSlug]: nextWidth }
      })
    }

    const handleMouseUp = () => {
      if (!resizeStateRef.current) return
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      void persistColumnWidths(latestColumnWidthsRef.current)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [persistColumnWidths])

  useEffect(() => {
    if (!activeView || activeView.view_type !== 'grid') return
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      void persistColumnWidths(latestColumnWidthsRef.current)
    }, 300)
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [columnWidths, activeView, persistColumnWidths])

  const commitInlineRow = useCallback(async () => {
    setAddingRow(true)
    try {
      const data: Record<string, unknown> = {}
      fields.forEach((f) => {
        const val = draftRow[f.slug]
        if (val === undefined) {
          if (f.field_type === 'boolean') data[f.slug] = false
          else if (f.field_type === 'multi_select') data[f.slug] = []
          else data[f.slug] = ''
          return
        }
        data[f.slug] = val
      })

      // Check for duplicates if Magic Table is enabled
      if (activeTable?.magic_table_config?.enabled) {
        const duplicates = await checkForDuplicates(activeTable.id, data)
        if (duplicates.length > 0) {
          setDuplicateDetections(duplicates)
          setPendingRecord(data)
          setAddingRow(false)
          return
        }
      }

      await addRecord(data)
      setDraftRow({})
    } catch {
      // ignore
    } finally {
      setAddingRow(false)
    }
  }, [fields, draftRow, addRecord, activeTable, checkForDuplicates])

  useEffect(() => {
    const node = scrollContainerRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setViewportWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(node)
    setViewportWidth(Math.floor(node.clientWidth))
    return () => observer.disconnect()
  }, [])

  const baseTableWidth = useMemo(() => {
    const dataColsWidth = visibleFields.reduce((sum, field) => sum + getColumnWidth(field.slug), 0)
    return SELECT_COL_WIDTH + INDEX_COL_WIDTH + ACTION_COL_WIDTH + dataColsWidth
  }, [visibleFields, getColumnWidth])

  const fillerColWidth = useMemo(
    () => Math.max(FILLER_COL_MIN_WIDTH, viewportWidth - baseTableWidth),
    [viewportWidth, baseTableWidth],
  )

  // Determine if we're showing grouped data
  const isGrouped = Object.keys(groupedRecords).length > 1 || !groupedRecords['All Records']

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }

  if (visibleFields.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        {fields.length === 0 
          ? "Voeg eerst velden toe om data te bekijken."
          : "Alle velden zijn verborgen. Maak velden zichtbaar via de Fields knop."
        }
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Duplicate Detection Banner */}
      {duplicateDetections.length > 0 && (
        <div className="p-4">
          <DuplicateDetectionBanner
            duplicates={duplicateDetections}
            onDismiss={handleDismissDuplicate}
            onView={handleViewDuplicate}
            onDismissAll={handleDismissAllDuplicates}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setDuplicateDetections([])
                setPendingRecord(null)
              }}
            >
              Annuleren
            </Button>
            <Button
              onClick={proceedWithRecordCreation}
              className="bg-accent hover:bg-accent/90"
            >
              Toch toevoegen
            </Button>
          </div>
        </div>
      )}
      
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <table className="text-xs border-collapse table-fixed w-max">
          <colgroup>
            <col style={{ width: SELECT_COL_WIDTH }} />
            <col style={{ width: INDEX_COL_WIDTH }} />
            {visibleFields.map((field) => {
              const width = getColumnWidth(field.slug)
              return <col key={`col-${field.id}`} style={{ width }} />
            })}
            <col style={{ width: ACTION_COL_WIDTH }} />
            <col style={{ width: fillerColWidth }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-sidebar border-b border-border">
              <th className="sticky left-0 z-20 px-2 py-2 border-r border-border text-center bg-bg-sidebar">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="rounded"
                  aria-label="Selecteer alle rijen"
                />
              </th>
              <th className="sticky left-[36px] z-20 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-text-muted border-r border-border bg-bg-sidebar">
                #
              </th>
              {visibleFields.map((field, index) => (
                (() => {
                  const isFirstColumn = index === 0
                  return (
                <th
                  key={field.id}
                  className={`group px-3 py-2 pr-10 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted border-r border-border relative ${
                    isFirstColumn ? 'sticky left-[76px] z-20 bg-bg-sidebar' : ''
                  }`}
                >
                  {field.name}
                  <button
                    type="button"
                    onClick={() => setSettingsField(field)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Veldinstellingen"
                  >
                    <Settings size={11} />
                  </button>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(event) => handleResizeStart(field.slug, event)}
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize group/resize"
                    title="Sleep om kolombreedte te wijzigen"
                  >
                    <div className="mx-auto h-full w-px bg-transparent group-hover:bg-border/50 group-hover/resize:bg-accent/70 transition-colors" />
                  </div>
                </th>
                  )
                })()
              ))}
              {showRelevanceColumn && (
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-purple-600 border-r border-border">
                  Relevantie
                </th>
              )}
              <th className="px-2 py-2 border-r border-border" />
              <th className="px-2 py-2 border-r border-border bg-bg-sidebar" />
            </tr>
          </thead>
          <tbody>
            {recordsLoading && displayRecords.length === 0 ? (
              <tr>
                <td colSpan={fields.length + (showRelevanceColumn ? 5 : 4)} className="py-12 text-center text-text-muted">
                  <Loader2 size={16} className="animate-spin inline mr-2" />
                  Records laden...
                </td>
              </tr>
            ) : isGrouped ? (
              // Render grouped records
              Object.entries(groupedRecords).map(([groupName, groupRecords]) => {
                const isCollapsed = collapsedGroups.has(groupName)
                return (
                  <Fragment key={groupName}>
                    {/* Group header */}
                    <tr className="bg-bg-sidebar/50 border-b border-border">
                      <td colSpan={visibleFields.length + 4} className="px-3 py-2">
                        <button
                          onClick={() => toggleGroup(groupName)}
                          className="flex items-center gap-2 text-sm font-medium text-text-heading hover:text-accent transition-colors"
                        >
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          {groupName}
                          <span className="text-xs text-text-muted">({groupRecords.length})</span>
                        </button>
                      </td>
                    </tr>
                    {/* Group records */}
                    {!isCollapsed && groupRecords.map((record, rowIdx) => (
                      <tr 
                        key={record.id} 
                        className="border-b border-border hover:bg-bg-hover/40 group"
                        style={{ height: ROW_HEIGHTS[currentRowHeight] }}
                      >
                        <td className="sticky left-0 z-10 px-2 py-1.5 border-r border-border text-center bg-bg-primary">
                          <input
                            type="checkbox"
                            checked={selectedRecordIds.includes(record.id)}
                            onChange={() => toggleRecordSelected(record.id)}
                            className="rounded"
                            aria-label={`Selecteer record ${record.id}`}
                          />
                        </td>
                        <td className="sticky left-[36px] z-10 px-2 py-1.5 text-text-muted tabular-nums border-r border-border text-center bg-bg-primary">
                          {rowIdx + 1}
                        </td>
                        {visibleFields.map((field, fieldIndex) => {
                          const isEditing = editingCell?.recordId === record.id && editingCell?.fieldSlug === field.slug
                          const cellValue = record.data?.[field.slug]
                          const isFirstColumn = fieldIndex === 0

                          return (
                            <td
                              key={field.id}
                              className={`px-2 py-1 border-r border-border relative cursor-pointer transition-colors hover:bg-bg-hover/70 ${
                                isFirstColumn ? 'sticky left-[76px] z-10 bg-bg-primary' : ''
                              }`}
                              onClick={() => {
                                if (field.field_type === 'formula') return
                                setEditingCell({ recordId: record.id, fieldSlug: field.slug })
                              }}
                            >
                              {isEditing ? (
                                <CellEditor
                                  field={field}
                                  value={cellValue}
                                  onSave={(v) => void handleCellSave(record.id, field.slug, v)}
                                  onCancel={() => setEditingCell(null)}
                                  onNavigate={(direction) => handleCellNavigate(record.id, field.slug, direction)}
                                />
                              ) : (
                                <div 
                                  className="flex items-center px-1"
                                  style={{ height: ROW_HEIGHTS[currentRowHeight] - 8 }}
                                >
                                  <CellRenderer field={field} value={cellValue} />
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-1 py-1 border-r border-border">
                          <button
                            type="button"
                            onClick={() => void removeRecord(record.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-status-error transition-opacity rounded"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                        <td className="border-r border-border" />
                      </tr>
                    ))}
                  </Fragment>
                )
              })
            ) : (
              displayRecords.map((record, rowIdx) => (
                <tr 
                  key={record.id} 
                  className="border-b border-border hover:bg-bg-hover/40 group"
                  onContextMenu={(e) => handleContextMenu(e, record)}
                >
                  <td className="px-2 py-1.5 border-r border-border text-center">
                    <input
                      type="checkbox"
                      checked={selectedRecordIds.includes(record.id)}
                      onChange={() => toggleRecordSelected(record.id)}
                      className="rounded"
                      aria-label={`Selecteer record ${record.id}`}
                    />
                  </td>
                  <td className="sticky left-[36px] z-10 px-2 py-1.5 text-text-muted tabular-nums border-r border-border text-center bg-bg-primary">
                    {rowIdx + 1}
                  </td>
                  {visibleFields.map((field, fieldIndex) => {
                    const isEditing = editingCell?.recordId === record.id && editingCell?.fieldSlug === field.slug
                    const cellValue = record.data?.[field.slug]
                    const isFirstColumn = fieldIndex === 0

                    return (
                      <td
                        key={field.id}
                        className={`px-2 py-1 border-r border-border relative cursor-pointer transition-colors hover:bg-bg-hover/70 ${
                          isFirstColumn ? 'sticky left-[76px] z-10 bg-bg-primary' : ''
                        }`}
                        onClick={() => {
                          if (field.field_type === 'formula') return
                          setEditingCell({ recordId: record.id, fieldSlug: field.slug })
                        }}
                      >
                        {isEditing ? (
                          <CellEditor
                            field={field}
                            value={cellValue}
                            onSave={(v) => void handleCellSave(record.id, field.slug, v)}
                            onCancel={() => setEditingCell(null)}
                            onNavigate={(direction) => handleCellNavigate(record.id, field.slug, direction)}
                          />
                        ) : (
                          <div 
                            className="flex items-center px-1"
                            style={{ height: ROW_HEIGHTS[currentRowHeight] - 8 }}
                          >
                            <CellRenderer field={field} value={cellValue} />
                          </div>
                        )}
                      </td>
                    )
                  })}
                  {showRelevanceColumn && (
                    <td className="px-3 py-1 border-r border-border text-center">
                      <div className="inline-flex items-center gap-1">
                        <span className="text-xs font-medium text-purple-600">
                          {Math.round((record as SemanticSearchResult).relevance_score * 100)}%
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="px-1 py-1 border-r border-border">
                    <button
                      type="button"
                      onClick={() => void removeRecord(record.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-status-error transition-opacity rounded"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                  <td className="border-r border-border" />
                </tr>
              ))
            )}
            <tr 
              className="border-b border-border bg-bg-sidebar/20"
              style={{ height: ROW_HEIGHTS[currentRowHeight] }}
            >
              <td className="sticky left-0 z-10 px-2 py-1.5 border-r border-border text-center bg-bg-sidebar/20" />
              <td className="sticky left-[36px] z-10 px-2 py-1.5 border-r border-border text-center bg-bg-sidebar/20">
                <button
                  type="button"
                  onClick={() => void commitInlineRow()}
                  disabled={addingRow}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-accent hover:text-accent/80 disabled:opacity-50 transition-colors"
                  title="Rij toevoegen"
                >
                  {addingRow ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                </button>
              </td>
              {visibleFields.map((field, fieldIndex) => {
                const isFirstColumn = fieldIndex === 0
                return (
                  <td
                    key={field.id}
                    className={`px-2 py-1 border-r border-border hover:bg-bg-hover/70 transition-colors ${
                      isFirstColumn ? 'sticky left-[76px] z-10 bg-bg-sidebar/20' : ''
                    }`}
                  >
                    <InlineCreateCell
                      fieldType={field.field_type}
                      value={draftRow[field.slug]}
                      onChange={(value) => updateDraftCell(field.slug, value)}
                      onEnter={() => void commitInlineRow()}
                    />
                  </td>
                )
              })}
              {showRelevanceColumn && (
                <td className="px-2 py-1 border-r border-border" />
              )}
              <td className="px-1 py-1 border-r border-border">
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => void commitInlineRow()}
                    disabled={addingRow}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-accent hover:text-accent/80 disabled:opacity-50 transition-colors"
                    title="Rij toevoegen"
                  >
                    {addingRow ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  </button>
                </div>
              </td>
              <td className="border-r border-border" />
            </tr>
            {displayRecords.length === 0 && !recordsLoading && !semanticSearchResults && (
              <tr>
                <td colSpan={fields.length + (showRelevanceColumn ? 5 : 4)} className="py-6 text-center text-text-muted text-xs">
                  Lege tabel. Vul bovenstaande rij in om je eerste item inline toe te voegen.
                </td>
              </tr>
            )}
            {semanticSearchResults && semanticSearchResults.length === 0 && (
              <tr>
                <td colSpan={fields.length + 5} className="py-6 text-center text-text-muted text-xs">
                  Geen zoekresultaten gevonden voor je zoekopdracht.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with add row + pagination */}
      <div className="sticky bottom-0 z-20 border-t border-border bg-bg-sidebar/60 backdrop-blur-sm">
        {selectedRecordIds.length > 0 ? (
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center px-2 py-1 rounded bg-accent/10 text-accent font-medium">
                {selectedRecordIds.length} record{selectedRecordIds.length !== 1 ? 's' : ''} geselecteerd
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={handleExportSelected}
                disabled={bulkDeleting}
              >
                <Download size={12} />
                Exporteer
              </Button>
              {!isTrashMode && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowBulkUpdateDialog(true)}
                  disabled={bulkDeleting}
                >
                  <Edit3 size={12} />
                  Bulk wijzig
                </Button>
              )}
              {isTrashMode && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={() => void handleRestoreSelected()}
                  disabled={bulkDeleting}
                >
                  <RotateCcw size={12} />
                  Herstel
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={clearSelection}
                disabled={bulkDeleting}
              >
                Deselecteer
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs gap-1"
                onClick={() => void handleDeleteSelected()}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Verwijderen...
                  </>
                ) : (
                  <>
                    <Trash2 size={12} />
                    {isTrashMode ? 'Permanent verwijder' : 'Verwijder'}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleAddRow} disabled={addingRow}>
              {addingRow ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Rij toevoegen
            </Button>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span>
                {displayRecords.length} 
                {displayRecords.length !== records.length && ` of ${records.length}`} 
                records
              </span>
              {recordsPaging.total > recordsPaging.perPage && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => loadRecordsPage(recordsPaging.page - 1)}
                    disabled={recordsPaging.page <= 1}
                    className="px-2 py-0.5 rounded border border-border disabled:opacity-30 hover:bg-bg-hover"
                  >
                    ←
                  </button>
                  <span className="px-1">Pagina {recordsPaging.page}</span>
                  <button
                    type="button"
                    onClick={() => loadRecordsPage(recordsPaging.page + 1)}
                    disabled={recordsPaging.page * recordsPaging.perPage >= recordsPaging.total}
                    className="px-2 py-0.5 rounded border border-border disabled:opacity-30 hover:bg-bg-hover"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {settingsField && (
        <FieldSettingsDialog
          field={settingsField}
          onClose={() => setSettingsField(null)}
          onSave={async (payload) => {
            await editField(settingsField.id, payload)
            setSettingsField(null)
          }}
          onDelete={async () => {
            await removeField(settingsField.id)
            setSettingsField(null)
          }}
        />
      )}

      {selectedRecord && (
        <RecordDrawer
          record={selectedRecord}
          fields={fields}
          onClose={() => setSelectedRecord(null)}
          onUpdate={async (data) => {
            await editRecord(selectedRecord.id, data);
            setSelectedRecord({ ...selectedRecord, data: { ...selectedRecord.data, ...data } });
          }}
        />
      )}
    </div>
  )
}

function FieldSettingsDialog({
  field,
  onClose,
  onSave,
  onDelete,
}: {
  field: CustomField
  onClose: () => void
  onSave: (payload: { name?: string; required?: boolean; config?: FieldConfig }) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(field.name)
  const [required, setRequired] = useState(Boolean(field.required))
  const [config, setConfig] = useState<FieldConfig>(field.config ?? {})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave({ name: name.trim(), required, config })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[85vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Veldinstellingen</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Veldnaam</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            </div>

            <div className="text-xs text-text-muted">
              Type: <strong className="text-text-primary">{field.field_type}</strong>
            </div>

            <FieldConfigPanel fieldType={field.field_type} config={config} onChange={setConfig} />

            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={required}
                onChange={(event) => setRequired(event.target.checked)}
                className="rounded"
              />
              Verplicht veld
            </label>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
              >
                {deleting ? 'Verwijderen...' : 'Verwijderen'}
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={saving || deleting}>
                  Annuleren
                </Button>
                <Button type="submit" disabled={saving || deleting || !name.trim()}>
                  {saving ? 'Opslaan...' : 'Opslaan'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      {confirmDelete ? (
        <ConfirmDeleteDialog
          title="Veld verwijderen?"
          itemLabel="het veld"
          itemName={field.name}
          impactText="Records verliezen de data in dit veld. Deze wijziging kan niet ongedaan worden gemaakt."
          isDeleting={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setDeleting(true)
            try {
              await onDelete()
              setConfirmDelete(false)
            } finally {
              setDeleting(false)
            }
          }}
        />
      ) : null}

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-bg-elevated shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {activeTable?.magic_table_config?.enabled && (
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              onClick={() => handleEnrichWithAI(contextMenu.record)}
            >
              <Sparkles size={12} className="text-purple-500" />
              Verrijk met AI
            </button>
          )}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-status-error hover:bg-status-error/10"
            onClick={() => {
              void removeRecord(contextMenu.record.id)
              closeContextMenu()
            }}
          >
            <Trash2 size={12} />
            Verwijderen
          </button>
        </div>
      )}

      {/* AI Enrichment Dialog */}
      {enrichmentRecord && (
        <AIEnrichmentDialog
          record={enrichmentRecord}
          onClose={() => setEnrichmentRecord(null)}
          onSave={async (recordId, data) => {
            await editRecord(recordId, data)
            // Add activity log entry (mock)
            console.log(`AI enrichment applied to record ${recordId} by user`)
          }}
        />
      )}
    </div>
  )
}

function InlineCreateCell({
  fieldType,
  value,
  onChange,
  onEnter,
}: {
  fieldType: string
  value: unknown
  onChange: (value: unknown) => void
  onEnter: () => void
}) {
  if (fieldType === 'boolean') {
    return (
      <span
        className="inline-flex h-8 w-full items-center px-1 text-text-muted"
        onClick={() => onChange(false)}
      >
        ...
      </span>
    )
  }

  if (fieldType === 'number' || fieldType === 'currency' || fieldType === 'rating') {
    return (
      <Input
        type="number"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onEnter()
          }
        }}
        className="h-8 text-xs border border-transparent bg-transparent px-1 focus:border-border/50 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
      />
    )
  }

  if (fieldType === 'date') {
    return (
      <Input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onEnter()
          }
        }}
        className="h-8 text-xs border border-transparent bg-transparent px-1 focus:border-border/50 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
      />
    )
  }

  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onEnter()
        }
      }}
      className="h-8 text-xs border border-transparent bg-transparent px-1 focus:border-border/50 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
      placeholder="..."
    />
  )
}

function BulkUpdateDialog({
  fields,
  selectedCount,
  onClose,
  onUpdate,
}: {
  fields: CustomField[]
  selectedCount: number
  onClose: () => void
  onUpdate: (fieldSlug: string, value: unknown) => Promise<void>
}) {
  const [selectedField, setSelectedField] = useState<string>('')
  const [value, setValue] = useState<string>('')
  const [updating, setUpdating] = useState(false)

  const selectedFieldDef = fields.find(f => f.slug === selectedField)
  const editableFields = fields.filter(f => f.field_type !== 'formula')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedField || !selectedFieldDef) return

    setUpdating(true)
    try {
      let processedValue: unknown = value

      // Process value based on field type
      if (selectedFieldDef.field_type === 'number' || selectedFieldDef.field_type === 'currency' || selectedFieldDef.field_type === 'rating') {
        processedValue = value === '' ? null : Number(value)
      } else if (selectedFieldDef.field_type === 'boolean') {
        processedValue = value === 'true'
      } else if (selectedFieldDef.field_type === 'multi_select') {
        processedValue = value ? value.split(',').map(v => v.trim()) : []
      }

      await onUpdate(selectedField, processedValue)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Bulk wijzigen</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-text-muted">
              Wijzig een veld voor {selectedCount} geselecteerde record{selectedCount !== 1 ? 's' : ''}.
            </p>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">
                Veld
              </label>
              <Select value={selectedField} onValueChange={setSelectedField}>
                <SelectTrigger>
                  <SelectValue placeholder="Kies een veld..." />
                </SelectTrigger>
                <SelectContent>
                  {editableFields.map(field => (
                    <SelectItem key={field.id} value={field.slug}>
                      {field.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedField && selectedFieldDef && (
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Nieuwe waarde
                </label>
                {selectedFieldDef.field_type === 'boolean' ? (
                  <Select value={value} onValueChange={setValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kies een waarde..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Waar</SelectItem>
                      <SelectItem value="false">Onwaar</SelectItem>
                    </SelectContent>
                  </Select>
                ) : selectedFieldDef.field_type === 'select' && selectedFieldDef.config.options ? (
                  <Select value={value} onValueChange={setValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kies een optie..." />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedFieldDef.config.options.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={
                      selectedFieldDef.field_type === 'multi_select' 
                        ? 'Komma-gescheiden waarden...'
                        : 'Voer nieuwe waarde in...'
                    }
                    type={
                      selectedFieldDef.field_type === 'number' || 
                      selectedFieldDef.field_type === 'currency' || 
                      selectedFieldDef.field_type === 'rating' 
                        ? 'number' 
                        : selectedFieldDef.field_type === 'date' 
                        ? 'date' 
                        : 'text'
                    }
                  />
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={updating}>
                Annuleren
              </Button>
              <Button 
                type="submit" 
                disabled={!selectedField || updating}
              >
                {updating ? (
                  <>
                    <Loader2 size={12} className="animate-spin mr-1" />
                    Wijzigen...
                  </>
                ) : (
                  'Wijzig records'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function HighlightedCellRenderer({
  field,
  value,
  recordId,
  searchMatches,
}: {
  field: CustomField
  value: unknown
  recordId: number
  searchMatches: Array<{
    recordId: number
    fieldSlug: string
    startIndex: number
    endIndex: number
  }>
}) {
  const matches = searchMatches.filter(m => 
    m.recordId === recordId && m.fieldSlug === field.slug
  )

  if (matches.length === 0 || typeof value !== 'string') {
    return <CellRenderer field={field} value={value} />
  }

  // Create highlighted text
  const text = value
  const parts: Array<{ text: string; highlighted: boolean }> = []
  let lastIndex = 0

  // Sort matches by start index
  const sortedMatches = matches.sort((a, b) => a.startIndex - b.startIndex)

  sortedMatches.forEach(match => {
    // Add text before the match
    if (match.startIndex > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.startIndex),
        highlighted: false
      })
    }

    // Add the highlighted match
    parts.push({
      text: text.slice(match.startIndex, match.endIndex),
      highlighted: true
    })

    lastIndex = match.endIndex
  })

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      highlighted: false
    })
  }

  return (
    <span>
      {parts.map((part, index) => (
        <span
          key={index}
          className={part.highlighted ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100' : ''}
        >
          {part.text}
        </span>
      ))}
    </span>
  )
}
