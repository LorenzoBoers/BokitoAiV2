import { RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react'
import type { CustomTable } from '../../types/custom-db'
import { Button } from '../ui/button'

interface MagicTableSyncStatusProps {
  table: CustomTable
  onManualSync: () => void
}

export default function MagicTableSyncStatus({ table, onManualSync }: MagicTableSyncStatusProps) {
  const syncStatus = table.magic_table_config?.sync_status

  if (!syncStatus) {
    return null
  }

  const renderStatus = () => {
    switch (syncStatus.state) {
      case 'syncing':
        return (
          <div className="flex items-center gap-2 text-purple-600">
            <div className="relative">
              <RefreshCw size={14} className="animate-spin" />
              <div className="absolute inset-0 bg-purple-500 rounded-full animate-pulse opacity-20" />
            </div>
            <span className="text-sm">
              {syncStatus.records_indexing ? 
                `${syncStatus.records_indexing} records indexeren...` : 
                'Synchroniseren...'
              }
            </span>
          </div>
        )

      case 'up_to_date':
        return (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle size={14} />
            <span className="text-sm">
              {syncStatus.message || 'Gesynchroniseerd'}
            </span>
          </div>
        )

      case 'stale':
        return (
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={14} />
            <span className="text-sm">
              {syncStatus.records_not_indexed ? 
                `${syncStatus.records_not_indexed} records niet geïndexeerd` : 
                'Index verouderd'
              }
            </span>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex items-center justify-between p-3 bg-bg-muted rounded-md">
      <div className="flex-1">
        <p className="text-sm font-medium text-text-primary mb-1">Sync status</p>
        {renderStatus()}
      </div>
      
      {syncStatus.state !== 'syncing' && (
        <Button
          size="sm"
          variant="outline"
          onClick={onManualSync}
          className="text-xs"
        >
          <RefreshCw size={12} className="mr-1" />
          Sync nu
        </Button>
      )}
    </div>
  )
}