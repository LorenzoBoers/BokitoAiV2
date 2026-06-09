import { useState } from 'react'
import { Database, Plus, Loader2, Table2, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import { Button } from '../ui/button'
import CreateTableDialog from './CreateTableDialog'
import TableSettingsDropdown from './TableSettingsDropdown'

export default function TableListSidebar() {
  const { tables, tablesLoading, activeTable, setActiveTableById, isTrashMode } = useDatabase()
  const [showCreate, setShowCreate] = useState(false)
  const [expandedTables, setExpandedTables] = useState<Set<number>>(new Set())

  const toggleTableExpanded = (tableId: number) => {
    setExpandedTables(prev => {
      const next = new Set(prev)
      if (next.has(tableId)) {
        next.delete(tableId)
      } else {
        next.add(tableId)
      }
      return next
    })
  }

  return (
    <div className="w-[240px] flex-shrink-0 border-r border-border bg-bg-sidebar/40 flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-heading">
          <Database size={16} />
          <span className="text-sm font-semibold">Database</span>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowCreate(true)}>
          <Plus size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {tablesLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : tables.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">
            <p>No tables yet.</p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-2 text-accent hover:underline"
            >
              Maak je eerste tabel
            </button>
          </div>
        ) : (
          tables.map((table) => {
            const isExpanded = expandedTables.has(table.id)
            return (
              <div key={table.id} className="space-y-0.5">
                <div className="group relative">
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleTableExpanded(table.id)}
                      className="p-1 rounded hover:bg-bg-hover transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown size={12} className="text-text-muted" />
                      ) : (
                        <ChevronRight size={12} className="text-text-muted" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTableById(table.id, false)}
                      className={`flex-1 flex items-center gap-2 rounded-md px-2 py-2 text-left text-[12.5px] transition-colors ${
                        activeTable?.id === table.id && !isTrashMode
                          ? 'bg-accent/10 text-accent font-medium'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                      }`}
                    >
                      <Table2 size={14} className="flex-shrink-0" style={table.color ? { color: table.color } : undefined} />
                      <span className="truncate">{table.name}</span>
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <TableSettingsDropdown table={table} />
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="ml-6 mt-1">
                      <button
                        type="button"
                        onClick={() => setActiveTableById(table.id, true)}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                          activeTable?.id === table.id && isTrashMode
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
                        }`}
                      >
                        <Trash2 size={12} className="flex-shrink-0" />
                        <span>Prullenbak</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="p-2 border-t border-border">
        <Button
          size="sm"
          variant="secondary"
          className="w-full justify-start gap-2 text-xs"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={13} />
          Nieuwe tabel
        </Button>
      </div>

      {showCreate && <CreateTableDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}
