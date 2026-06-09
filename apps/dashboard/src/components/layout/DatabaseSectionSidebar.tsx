import { useMemo, useState } from 'react'
import { Plus, Table2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDatabase } from '../../context/DatabaseContext'
import CreateTableDialog from '../database/CreateTableDialog'
import type { CustomTable } from '../../types/custom-db'

function sectionClass(isActive: boolean) {
  return `flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary'
  }`
}

function GroupHeader({
  label,
  onAdd,
}: {
  label: string
  onAdd?: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded border border-border/60 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          aria-label="Nieuwe tabel"
          title="Nieuwe tabel"
        >
          <Plus size={12} />
        </button>
      ) : null}
    </div>
  )
}

function TableList({
  tables,
  activeTableId,
  onSelectTable,
}: {
  tables: CustomTable[]
  activeTableId: number | null
  onSelectTable: (table: CustomTable) => void
}) {
  if (tables.length === 0) {
    return <p className="px-3 py-1 text-xs text-text-muted">No tables.</p>
  }

  return (
    <div className="space-y-0.5">
      {tables.map((table) => (
        <button
          key={table.id}
          type="button"
          onClick={() => onSelectTable(table)}
          className={sectionClass(activeTableId === table.id)}
          title={table.description || table.name}
        >
          <Table2 size={14} className="shrink-0 text-text-muted" style={table.color ? { color: table.color } : undefined} />
          <span className="truncate">{table.name}</span>
        </button>
      ))}
    </div>
  )
}

export default function DatabaseSectionSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { tables, activeTable, setActiveTableById, tablesLoading } = useDatabase()
  const [showCreateTable, setShowCreateTable] = useState(false)

  const { systemTables, customTables } = useMemo(() => {
    const standard = tables.filter((table) => table.is_standard === true)
    const custom = tables.filter((table) => table.is_standard !== true)
    return { systemTables: standard, customTables: custom }
  }, [tables])

  const handleSelectTable = (table: CustomTable) => {
    setActiveTableById(table.id)
    navigate(`/database/${table.slug}`)
  }

  const resolvedActiveTableId = useMemo(() => {
    if (pathname.startsWith('/database/') && activeTable) {
      return activeTable.id
    }
    return activeTable?.id ?? null
  }, [pathname, activeTable])

  return (
    <>
      <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border/55 bg-bg-sidebar px-3 py-3">
        <h2 className="px-3 pb-3 text-[22px] font-semibold leading-none text-text-heading">Data</h2>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {tablesLoading ? (
            <p className="px-3 py-1 text-xs text-text-muted">Tabellen laden...</p>
          ) : (
            <>
              <section className="space-y-1">
                <GroupHeader label="System tables" />
                <TableList tables={systemTables} activeTableId={resolvedActiveTableId} onSelectTable={handleSelectTable} />
              </section>

              <section className="space-y-1">
                <GroupHeader label="Custom tables" onAdd={() => setShowCreateTable(true)} />
                <TableList tables={customTables} activeTableId={resolvedActiveTableId} onSelectTable={handleSelectTable} />
              </section>
            </>
          )}
        </div>
      </aside>

      {showCreateTable ? <CreateTableDialog onClose={() => setShowCreateTable(false)} /> : null}
    </>
  )
}
