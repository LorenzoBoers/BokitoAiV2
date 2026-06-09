import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DatabaseProvider, useDatabase } from '../context/DatabaseContext'
import { useWorkspaceInit } from '../hooks/useWorkspaceInit'
import FieldEditor from '../components/database/FieldEditor'
import ViewTabs from '../components/database/ViewTabs'
import GridView from '../components/database/GridView'
import KanbanView from '../components/database/KanbanView'
import CalendarView from '../components/database/CalendarView'
import { TableBuilder } from '../components/database/TableBuilder'
import { ImportExportDialog } from '../components/database/ImportExportDialog'
import { Database, X, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import type { SemanticSearchResult } from '../types/custom-db'

export default function DatabasePage() {
  return <DatabaseInner />
}

export function DatabasePageWithProvider() {
  return (
    <DatabaseProvider>
      <DatabaseInner />
    </DatabaseProvider>
  )
}

function DatabaseInner() {
  const { tableSlug } = useParams<{ tableSlug?: string; recordId?: string }>()
  const { tables, activeTable, setActiveTableById } = useDatabase()
  const { isInitializing } = useWorkspaceInit()

  useEffect(() => {
    if (tableSlug) {
      const found = tables.find((t) => t.slug === tableSlug)
      if (found && found.id !== activeTable?.id) {
        setActiveTableById(found.id)
      }
      return
    }

    if (!activeTable && tables.length > 0) {
      setActiveTableById(tables[0].id)
    }
  }, [tableSlug, tables, activeTable, setActiveTableById])

  if (isInitializing) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col min-w-0">
        {activeTable ? <TableContent /> : <EmptyState />}
      </div>
    </div>
  )
}

function SkeletonGrid({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="p-4 space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-8 flex-1 bg-bg-hover rounded" />
          ))}
        </div>
      ))}
    </div>
  )
}

function TableContent() {
  const { activeView, fields, recordsLoading, activeTable } = useDatabase()
  const [showFieldEditorModal, setShowFieldEditorModal] = useState(false)
  const [showTableBuilder, setShowTableBuilder] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [semanticSearchResults, setSemanticSearchResults] = useState<SemanticSearchResult[]>([])

  const handleSemanticSearch = (results: SemanticSearchResult[]) => {
    setSemanticSearchResults(results)
  }

  return (
    <>
      {/* View tabs */}
      <ViewTabs
        fieldsCount={fields.length}
        onManageFields={() => setShowFieldEditorModal(true)}
        onSemanticSearch={handleSemanticSearch}
      />

      {/* Active view */}
      {recordsLoading ? (
        <div className="flex-1 p-4">
          <SkeletonGrid rows={8} cols={fields.length || 4} />
        </div>
      ) : activeView?.view_type === 'kanban' ? (
        <KanbanView />
      ) : activeView?.view_type === 'calendar' ? (
        <CalendarView />
      ) : (
        <GridView semanticSearchResults={semanticSearchResults} />
      )}

      {showFieldEditorModal && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Manage fields</CardTitle>
              <button
                type="button"
                onClick={() => setShowFieldEditorModal(false)}
                className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <X size={14} />
              </button>
            </CardHeader>
            <CardContent>
              <FieldEditor />
            </CardContent>
          </Card>
        </div>
      )}

      <TableBuilder
        isOpen={showTableBuilder}
        onClose={() => setShowTableBuilder(false)}
        tableId={activeTable?.id}
      />

      <ImportExportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        mode="import"
      />

      <ImportExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        mode="export"
      />
    </>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
          <Database size={28} className="text-accent" />
        </div>
        <h3 className="text-sm font-semibold text-text-heading mb-1">Selecteer een tabel</h3>
        <p className="text-xs text-text-muted max-w-[240px]">
          Selecteer een tabel via de linker navigatie om te beginnen met het beheren van je data.
        </p>
      </div>
    </div>
  )
}
